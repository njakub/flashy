# Flashy — Feature Analysis & Architecture Report

> Deliverable for the "Feature Analysis & Architecture" prompt (docs/fable5-feature-analysis-prompt.md).
> On approval this report will be saved to `docs/feature-analysis-report.md` (no code changes).

## Executive Summary

- **The four seams are healthy.** No component or page imports `db/index.ts` or Dexie directly; `ownerId` always comes from `useAuth()`; graders are behind `Grader`; scheduling is behind `Scheduler`. The only violations found are housekeeping-level (a dead `@xenova/transformers` dependency, an unreferenced `node-browser-shim.ts`, and unvalidated `res.json() as X` casts on network payloads).
- **One real bug:** `StudySession` loads the *entire deck* (`cards.getByDeck`, `src/components/StudySession.tsx:38`) instead of `getDueCards`, so the "Study · N due" button on DeckDetail advertises a due-card session the component doesn't deliver. The SM-2 scheduler is effectively bypassed as a queue filter.
- **Code-snippet cards:** keep `front`/`back` as plain strings containing Markdown fenced code blocks (zero schema/wire/sync change — snapshots and old clients inherit it for free), render with `prism-react-renderer` behind a shared `<CardContent>` component, and guard grading with a "code present → normalized exact-match or self-grade" rule.
- **TTS via Web Speech `SpeechSynthesis`** (offline, free, Firefox-supported) behind a `Speaker` port mirroring `Grader`; **voice input via on-device Whisper** through `@huggingface/transformers` (Firefox has no `SpeechRecognition`, and Chrome's implementation ships audio to Google — both disqualifying for a local-first app), behind a `Transcriber` port sharing a pipeline cache with `EmbeddingGrader`.
- **Highest-value testing target:** `SyncEngine.applyCard`'s field-group conflict matrix, plus the pure modules (`scheduler`, `testHistory`, `importExport`) — Vitest + `fake-indexeddb` fits with near-zero infrastructure.

---

## A. Current Flow Review

### A1. Deck → card → Study → Test → History

**Study mode ignores due dates (bug).**
`StudySession.load()` (`src/components/StudySession.tsx:36-44`) calls `cards.getByDeck(deckId)` — the local variable is even named `due` — while `DeckDetail` (`src/components/DeckDetail.tsx:46-47`) computes the advertised count from `cards.getDueCards(deckId, new Date())`. Consequences:

- A user who taps "Study · 3 due" reviews all N cards, including ones scheduled weeks out.
- Reviewing not-yet-due cards re-runs SM-2 on them (`handleRate` → `scheduler.review`), churning `easeFactor`/`intervalDays` and resetting `dueAt`, so intervals never grow the way SM-2 intends.
- The "Restart" button on the done screen reloads the same full deck, allowing unbounded same-day re-reviews that inflate `reps`.

Fix is one line (`getDueCards(deckId, new Date())`) plus a decision about an explicit "study ahead / study all" override for when nothing is due. The queue is also unordered — worth sorting by `scheduling.dueAt` (most overdue first) or shuffling deliberately, rather than inheriting Dexie index order.

**Test mode blocks small decks.** The pick screen requires ≥ 5 cards (`TestSession.tsx:449`, `QUIZ_SIZES = [5, 10, 15, 20]`). A 3-card starter deck can't be quizzed at all. An "All (N)" option for `pool.length < 5` removes the dead end.

**Abandoning a test run loses history but keeps scheduling side-effects.** `persistGrade` updates each card's scheduling *immediately* per question (`TestSession.tsx:327-346`), but `questionLog` is only flushed in `finishRun`. Navigating away mid-run (the ever-present "← Back to deck" link) means: scheduling mutated for answered cards, zero `TestRun`/`TestRunQuestion` rows. Either flush partial runs on unmount (mark them, or accept partial `questionCount`), or warn before leaving mid-run.

**Test mode silently mutates SRS state.** The `correct → "good"`, `incorrect → "again"` mapping in `persistGrade` is reasonable, but it means a Test run *is* a review session — a card studied this morning and quizzed tonight gets double-scheduled. This is a product decision worth making explicit (CLAUDE.md doesn't mention it); if intended, fine; if not, gate it behind a setting.

**DeckList has an N+1 count query.** `load()` (`DeckList.tsx:29-40`) fetches every deck's full card rows just to count them. Harmless at 10 decks; at 50 decks × 500 cards it's real work on every sync-triggered reload (`useReloadOnSync`). A `CardRepository.countByDeck(deckIds: string[])` grouped method (mirroring `getStatsByCards`'s "one grouped query" pattern) fixes it without breaking the storage seam.

**CardForm gaps.**
- No duplicate-front check — import enforces "cards shouldn't share front text" (`DeckDetail.tsx:133-141`) but manual authoring doesn't. A soft warning on blur would align them.
- `catch { setError("Failed to save card.") }` (`CardForm.tsx:95-98`) swallows the actual failure; surface `err.message` like the login form does.
- No unsaved-changes guard; Cancel discards silently.

**Import performance.** `handleImportFile` awaits `cards.create` serially per row (`DeckDetail.tsx:137-153`) — each an individual Dexie transaction plus `notifyDirty()` (debounced, so sync is fine). For 500-card files, add a `CardRepository.bulkCreate(cards[])` that wraps one `bulkAdd` transaction.

**TestRunDetail over-fetches.** It loads the whole deck's cards (`TestRunDetail.tsx:27`) only to resolve labels for the handful of cards in one run. Fine now; `getByIds(cardIds)` would be the targeted fix if decks grow.

### A2. Grading pipeline (submit → embed → compare → self-grade → persist)

The pipeline is in good shape: every entry point (local submit, AI button, ambiguous tiebreaker, cascade) funnels through `submitAnswer`/`runCascade` → `resolveGrade` → `persistGrade`, errors degrade to the self-grade band rather than dead-ending, and `"ambiguous"` never persists. Specific observations:

- **Model cold-start has copy but no progress.** `preloadEmbeddingModel()` fires on mount (good), but the ~23 MB download shows only a static "~10 s" sentence (`TestSession.tsx:607-612`) — and that sentence claims "first time" even on warm invocations. `pipeline()` accepts a `progress_callback`; thread it through `getPipeline()` to drive a real progress bar in the pick/question screens.
- **`cardFront` is embedded into the signature but ignored** (`EmbeddingGrader.grade(_cardFront, …)`). Deliberate, but worth noting: similarity is answer↔answer only, so a correct-but-question-contextual answer ("the second one") scores poorly. The cascade already compensates for signed-in users.
- **Short-answer penalty is known and documented** (comment at `TestSession.tsx:255-264`) — cosine against long explanatory answers systematically under-scores terse correct answers. The cascade mitigates it; for signed-out users the ambiguous band is the safety net. Per-card/per-deck threshold overrides (the `EmbeddingGrader` constructor already takes them, `EmbeddingGrader.ts:79-85`) are the local-only mitigation.
- **Unbounded alternate growth.** The cascade auto-appends every LLM-confirmed answer to `alternateAnswers`. Over months a popular card accumulates dozens of alternates, each embedded (cached per session, but the first grade of a card embeds all of them serially in one `Promise.all`). Not urgent; a cap or dedupe-by-similarity would keep it tidy.

### A3. Sync lifecycle (dirty → debounce → push/pull → apply)

The engine itself (`SyncEngine.ts`) is careful: current-value race checks, field-group scheduling reconciliation, dirty retention on skipped fields, tombstone cascades. Findings are all at the *trigger* layer in `AuthProvider`:

- **No concurrency guard on `runSync`.** The 45 s interval, the 2 s post-write debounce, and the sign-in kick-off can overlap: nothing prevents two `syncOnce()` calls in flight simultaneously. Both would read the same dirty rows and push twice (server-idempotent, probably harmless), but the two *pulls* apply and write `db.syncState` cursors in an interleaved order — a stale cursor overwrite can re-pull or, worse, skip a revision window. Fix is small: keep an in-flight promise ref in `runSync` and return it instead of starting a second cycle.
- **Missing wake-up triggers.** No `window.addEventListener("online", …)` or `visibilitychange` sync — a laptop waking from sleep waits up to 45 s to converge. Two listeners in the same `AuthProvider` effect that owns the interval.
- **Deck deleted on device B while device A is mid-test.** Device A's `cards.update(...scheduling)` writes into a tombstoned row without clearing `deletedAt`, and `saveRun` creates a run for a dead deck — both push, the server's defensive cascade keeps the deletion authoritative, the client re-tombstones on pull. Converges correctly; the only UX gap is device A silently finishing a test for a deck that vanishes when it navigates back (DeckDetail's `load()` redirects home — acceptable).
- **Refresh token in `localStorage`** is a documented tradeoff (30-day rotating token, XSS-readable). Fine for this app's threat model; note it stays a conscious decision if deck-sharing or anything multi-tenant lands later.
- **`bootstrapLocalUserData` doesn't re-stamp `testRunQuestions`** — correct, since they carry no `ownerId`, but worth the comment it already has; no action.

---

## B. Code Snippets as Card Content

### B1. Storage — Markdown-in-string, no schema change (recommended)

Keep `Card.front`/`Card.back` as plain strings and adopt **GitHub-style fenced code blocks** (```` ```ts … ``` ````) as the embedded format. Rationale, in order of weight:

1. **Sync cost of the alternative is high.** A `contentType` field touches: `src/lib/types.ts`, `src/lib/sync/wire.ts` *and* flashy-api's `sync.schema.ts`/Prisma schema in lockstep (the wire mirror is hand-maintained by design), a Dexie `version(4).upgrade()`, and the push/pull serializers in `SyncEngine.ts`. Markdown-in-string touches none of these — the strings already flow through push (`toWireCardPush`), pull (`applyCard`), LWW conflict resolution, and `TestRunQuestion` snapshots unmodified.
2. **Backward/forward compatible by construction.** Plain text is valid Markdown (fence detection on legacy cards simply finds nothing), and a device running old code renders a fenced card as readable monospace-ish text rather than crashing on an unknown `contentType`.
3. **Detection is cheap at render time** — `hasCodeFence(text)` is a regex; no persisted flag needed.

If a persisted discriminator is ever genuinely required, add it the way `answerJustifications` was added: an *optional, additive* `contentFormat?: "markdown"` on `Card` and the wire types, defaulting absent — never a mandatory envelope migration.

### B2. Rendering — `prism-react-renderer`

| | `prism-react-renderer` | `shiki` | `react-syntax-highlighter` |
|---|---|---|---|
| Bundle | ~20 KB + per-language grammars, all bundled | Larger; TextMate grammars + (optionally) Oniguruma WASM; async highlighter init | Heaviest of the three; wraps whole Prism/hljs |
| Offline / local-first | ✅ fully bundled, synchronous | ✅ possible but needs careful bundling of grammar/theme assets | ✅ bundled |
| Rendering model | Synchronous React render-prop — ideal for client components reading from IndexedDB | Async, shines in server/build-time rendering — but cards render **client-side from Dexie**, so the SSR advantage never applies | React components, dated API |
| Theming | JS theme objects → can be generated from `src/lib/theme.ts` tokens directly | JSON themes | CSS themes |

**Recommendation: `prism-react-renderer`.** The decisive point is that Flashy's card content never exists at build/server time — it lives in the user's IndexedDB — so shiki's zero-runtime strength is unusable here, leaving only its weight. `prism-react-renderer`'s JS theme object also slots naturally into the existing `theme.ts` dark/light palettes (`colorsDark`/`colorsLight`).

**Markdown handling:** don't add `react-markdown` for this. Only two constructs are needed (prose + fenced code), so a ~40-line splitter is enough:

```ts
// src/lib/content/markdown.ts
export interface ContentSegment {
  kind: "prose" | "code";
  text: string;
  lang?: string; // from the fence info string
}
export function splitFences(text: string): ContentSegment[] { /* regex over ```lang\n…\n``` */ }
export function hasCodeFence(text: string): boolean;
export function speakableText(text: string): string; // fences → "code block omitted" (used by C4)
export function normalizeCode(code: string): string; // strip comments/collapse whitespace (used by B4)
```

```tsx
// src/components/CardContent.tsx
export function CardContent({ text, className }: { text: string; className?: string }) {
  // prose segments keep the current `whitespace-pre-wrap` behavior exactly;
  // code segments render <Highlight> from prism-react-renderer in a
  // `overflow-x-auto rounded-control` block using the mono font token.
}
```

Swap-in points (all currently render raw `{text}` in a `whitespace-pre-wrap` `<p>`): `StudySession.tsx:112-124` (front + back), `TestSession.tsx:553-557`, `624-627`, `739-743` (question card in question/ambiguous/result phases) and the result answer line, `TestRunDetail.tsx:92-109` (snapshots), and optionally the truncated card list rows in `DeckDetail.tsx:361` (probably strip fences to one-line preview there instead).

### B3. Authoring UX — split write/preview in `CardForm`, not a block editor

Upgrade `CardForm` minimally: keep the existing `<textarea>`s as the source of truth and add a **Write / Preview** segmented toggle per field (the segmented-control pattern already exists in `TestHistory.tsx:101-120`), where Preview renders `<CardContent text={front} />`. On `md:` widths, side-by-side panes instead of a toggle. Add an "Insert code block" button that wraps the selection in ```` ``` ```` fences with a language picker.

**Tiptap rejected** for now: it stores a block document (JSON/HTML), which would either force a storage-format migration (see B1) or a lossy serialize-to-markdown round trip; it's a large dependency; and the grading pipeline (`acceptedAnswers` as plain strings fed to embeddings) assumes plain text. A plain textarea + live preview delivers 90% of the value at ~5% of the cost.

### B4. Grading impact — code-aware pre-check, then self-grade

MiniLM embeddings are trained on natural language; two semantically identical snippets (`for` loop vs `while` loop) or two near-identical snippets differing in one token can score arbitrarily. Policy, implemented as a thin wrapper so the seam stays clean:

```ts
// src/lib/grading/CodeAwareGrader.ts
export class CodeAwareGrader implements Grader {
  constructor(private inner: Grader) {}
  async grade(front, correctAnswers, userAnswer) {
    if (!correctAnswers.some(hasCodeFence) && !hasCodeFence(userAnswer))
      return this.inner.grade(front, correctAnswers, userAnswer);
    // 1. normalized exact match on code content → "correct"
    // 2. otherwise → { outcome: "ambiguous" }  (never auto-"incorrect" on code)
  }
}
```

`TestSession` wraps `embeddingGrader` in it; the ambiguous band (self-grade + "Let AI grade this instead") already handles the fall-through, and the LLM cascade — which *is* competent at code equivalence — remains the quality path for signed-in users. This mirrors the existing principle at `TestSession.tsx:259-264`: a single embedding score is never trusted to mark an answer wrong.

### B5. Snapshots in `TestRunQuestion`

`cardFrontSnapshot`/`cardBackSnapshot` are plain strings, so with B1 the markdown travels through `saveRun`, the wire (`WireTestRunQuestion`), and pulls with **zero changes** — the snapshot faithfully preserves the fences as authored at attempt time, which is exactly the immutability contract. Render them via `<CardContent>` in `TestRunDetail`.

A versioned content envelope (`{ v: 1, format: "markdown", body }`) is **not recommended**: it would break every existing stored/synced snapshot (they'd need a migration the server would also have to understand), whereas the markdown string is self-describing — the fence syntax *is* the version marker, and its absence means plain text. If a future format ever isn't a superset of plain text, add an optional additive `contentFormat?` column then, and only for rows written after that point.

---

## C. Text-to-Speech (Answer Read-Out)

### C1. API choice — Web Speech `SpeechSynthesis`

| | `SpeechSynthesis` | ElevenLabs / Azure / OpenAI TTS |
|---|---|---|
| Offline | ✅ OS-local voices (macOS/Windows/Linux espeak) | ❌ network round trip |
| Cost | $0 | per-character billing, needs a proxied key in flashy-api |
| Latency | ~instant | 300 ms–2 s + streaming plumbing |
| Firefox | ✅ supported (voice quality depends on OS voices) | ✅ but online-only |

`SpeechSynthesis` is the only option compatible with "works fully offline with no account." Voice quality is OS-dependent but acceptable for study material. The `Speaker` port (C2) leaves room for a future `ApiSpeaker` proxied through flashy-api (same pattern as `LlmGrader` → `POST /grade`) as a signed-in enhancement — not now.

Caveats to handle in the implementation: `getVoices()` populates asynchronously (listen to `voiceschanged`); Chrome pauses long utterances after ~15 s in some versions (chunk by sentence); always `cancel()` before a new `speak()`.

### C2. Architecture — module singleton + hook, like `scheduler`

```ts
// src/lib/speech/Speaker.ts
export interface Speaker {
  speak(text: string): void;
  cancel(): void;
  readonly speaking: boolean;
  readonly supported: boolean;
}
// src/lib/speech/WebSpeechSpeaker.ts — wraps window.speechSynthesis
```

Placement: **module-level singleton + a thin `useSpeaker()` hook**, not a context provider. `speechSynthesis` is already a global singleton with no per-user state, and no component needs to observe another component's speech — so the `scheduler`-style module export fits better than the `RepositoryProvider` pattern. The hook's only job is React-facing: subscribe to utterance start/end events to expose a reactive `speaking` boolean and `supported` flag, and `cancel()` on unmount.

### C3. Integration points

1. **Study reveal** (highest value — the canonical "read the answer to me"): a 🔊 icon button beside the revealed back text, `StudySession.tsx:118-125`.
2. **Test result card**: beside the "Answer …" line, `TestSession.tsx:778-780` — hearing the accepted answer after a miss reinforces it.
3. **Test ambiguous band**: beside "Accepted …", `TestSession.tsx:657-660`.
4. Optional: speak the *question* on the Study front for eyes-free review.

All buttons are user-initiated (`onClick={() => speaker.speak(speakableText(text))}`) with `aria-pressed`/`aria-label` and a visible speaking state. Cancel speech in `advance()`/`handleRate()` so audio never outlives its card.

### C4. Code content

Reuse `speakableText()` from `src/lib/content/markdown.ts` (B2): fenced blocks → the phrase "code block omitted", inline backticks stripped. Reading code aloud token-by-token is noise; the prose around it is the valuable part. If a card's back is *only* a code block, disable the button with a tooltip.

### C5. Accessibility & preference

- Never auto-speak — button-initiated only, so screen-reader users (whose SR may share the same OS TTS engine) don't get double audio they didn't request.
- Preference: a "Read-aloud buttons: show/hide" toggle plus rate/voice selection. **Store device-locally in `localStorage`** (via a small extension to `SettingsProvider` or a standalone `useSpeechPrefs` hook) — voices are per-device (a voice chosen on macOS doesn't exist on Windows), so unlike `gradingDefault` this should *not* sync through `/users/me`. No Dexie table needed; this is UI preference, not domain data.

---

## D. Voice Input (Microphone → Text Answer)

### D1. API choice — on-device Whisper (recommended primary)

| | Web Speech `SpeechRecognition` | Whisper via `@huggingface/transformers` | Cloud STT |
|---|---|---|---|
| Firefox | ❌ **not implemented** (primary browser — disqualifying as the only path) | ✅ | ✅ |
| Offline | ❌ Chrome streams audio to Google servers | ✅ fully on-device | ❌ |
| Privacy | audio leaves the device (Chrome) | on-device | audio leaves the device |
| Latency | live interim results | none live; 1–4 s after stop (tiny/base, WASM; WebGPU much faster where available) | streaming |
| Cost | free | free after ~40–80 MB one-time model download | metered |

**Recommendation: `WhisperTranscriber` as the primary (and initially only) implementation** — `onnx-community/whisper-tiny.en` (~40 MB q8) or `whisper-base` for multilingual decks. It is the only option that works in Firefox *and* honors local-first privacy, and it reuses the exact `pipeline()` pattern `EmbeddingGrader` already established. A `WebSpeechTranscriber` for Chrome/Safari live-interim UX can be added behind the same interface later, clearly labeled as sending audio to the browser vendor (D6).

### D2. Fallback strategy

Capability check on mount: `navigator.mediaDevices?.getUserMedia` + `WebAssembly` present → show mic button; otherwise hide it entirely (a tooltip on a disabled button is acceptable, but a hidden control plus a one-line note in the profile page is cleaner than a permanently dead button). Runtime failures (mic permission denied, model download failed) degrade to the typed path with an inline message — same graceful-degradation shape as `gradeError` → self-grade.

### D3. Architecture

```ts
// src/lib/speech/Transcriber.ts
export type TranscriberState = "idle" | "requesting" | "recording" | "transcribing";
export interface Transcriber {
  start(): Promise<void>;               // getUserMedia + MediaRecorder start
  stop(): Promise<string>;              // stop, decode → 16 kHz mono Float32Array, run ASR
  cancel(): void;
  readonly state: TranscriberState;
  readonly supported: boolean;
}
// src/lib/speech/WhisperTranscriber.ts   — implementation above
// src/lib/speech/useTranscriber.ts      — hook: instantiates the best available
//                                          implementation, exposes reactive state
```

`TestSession` consumes `useTranscriber()`; on a completed transcription it does `setUserAnswer(text)` — the grading pipeline (`handleFormSubmit` → cascade/embedding) is **entirely unchanged**, which is the point of the seam.

### D4. UX flow / state machine

```
idle ──tap mic──▶ requesting ──granted──▶ recording ──tap stop──▶ transcribing ──▶ review
  ▲                   │ denied                 │ (elapsed timer,        │            │
  │                   ▼                        │  pulsing indicator)    ▼            ▼
  └────── error toast ┴──────── cancel ◀───────┘                 error → idle   text lands in the
                                                                                 textarea (editable);
                                                                                 [Use it] keeps it, [Re-record] → recording,
                                                                                 submit → existing grading pipeline
```

With Whisper there is no live interim transcript — show the elapsed-time recording indicator and a "Transcribing…" spinner instead (set expectations honestly rather than faking streaming). The transcript lands in the existing `answerRef` textarea so the user can correct mishearings before grading — important because a transcription error would otherwise unfairly fail the embedding check.

### D5. Model loading — shared pipeline cache

Extract `EmbeddingGrader`'s module-level `pipelinePromise` pattern (`EmbeddingGrader.ts:25-48`) into a shared keyed cache:

```ts
// src/lib/models/pipelineCache.ts
export function getPipeline(
  task: "feature-extraction" | "automatic-speech-recognition",
  modelId: string,
  onProgress?: (p: { progress?: number; file?: string }) => void,
): Promise<PipelineFn>;
// Map<`${task}:${modelId}`, Promise<…>>; deletes the entry on rejection so
// callers can retry — identical semantics to the current implementation.
```

`EmbeddingGrader` refactors onto it (behavior-neutral), `WhisperTranscriber` uses it, and both gain the `progress_callback` plumbing that A2 wants for the embedding download UI. **Do not preload Whisper** the way `preloadEmbeddingModel()` runs on test-mount — 40–80 MB is too much to pull speculatively; load on first mic tap with a visible download progress bar, then it's cached (browser cache / transformers.js cache) for subsequent sessions. Yes to a shared cache module; no to a shared eager loader.

### D6. Privacy

Both recommended paths (Whisper, and audio capture generally) stay on-device; state this in the mic tooltip ("transcribed on your device — audio never leaves your browser"). If `WebSpeechTranscriber` is ever added for Chrome's live UX, it must be opt-in with an explicit note that Chrome processes the audio on Google servers. Any future cloud STT (through flashy-api) needs explicit user consent and a privacy notice before first use — same bar as sign-in-gated AI grading, which already models "cloud features are opt-in and labeled."

---

## E. Additional Feature Suggestions

### E1. Due-only Study queue + label-filtered Study/Test *(small, fixes the A1 bug)*
- **What:** Study sessions draw from `getDueCards`; both Study and Test gain label filter chips.
- **Why:** Restores the SRS contract ("Study · N due" currently lies), and `Card.labels` is authored + aggregated in history but unusable for *selecting what to practice* — the most requested-shaped gap in the data model.
- **How:** `StudySession.load()` → `cards.getDueCards(deckId, new Date())` sorted by `dueAt`, with a "Nothing due — study anyway?" fallback using `getByDeck`. Add a chip row (labels from `distinctLabels(pool)` in `src/lib/testHistory.ts:25`) to the Study entry and the Test pick screen; filter the pool client-side before `sample()`. No repository changes needed.

### E2. Keyboard-first review *(small)*
- **What:** Study: `Space` = reveal, `1/2/3/4` = Again/Hard/Good/Easy; Test: `Enter` = next on the result screen.
- **Why:** Reviewing 30 cards is a keyboard rhythm activity; mouse round trips per card dominate session time for power users.
- **How:** One `useEffect` keydown listener in `StudySession` switching on `revealed` (guard `e.target` not being an input), same in `TestSession` for the result phase (the answer form already submits on Enter). Show the digits as small kbd hints inside the existing `RATINGS` buttons. ~40 lines total.

### E3. Cross-deck dashboard: due today, streak, retention *(medium)*
- **What:** A stats panel on `/` above the deck list — cards due today across all decks, review streak (consecutive days with ≥1 run/review), 30-day accuracy trend.
- **Why:** All data exists but no view aggregates across decks; a streak is the single strongest retention mechanic in this category of app.
- **How:** `getDueCards(null, now)` (the cross-deck path already implemented at `DexieCardRepository.ts:24-31` and currently *unused*), plus a `TestRunRepository.getRunsByOwner(ownerId)` addition for run dates/accuracy. New `StatsPanel.tsx` rendered by `DeckList`, wrapped in `useReloadOnSync`. Streak from distinct local-dates of `TestRun.startedAt` ∪ `scheduling.lastReviewedAt`. Derived only — no schema change, honoring the `CardStats` "never stored" precedent.

### E4. CSV / plain-text bulk import *(small; defer `.apkg`)*
- **What:** Import `front|back` (or CSV `front,back,alternates;…,labels;…`) text files alongside the JSON envelope.
- **Why:** The fastest authoring path is pasting 50 lines from notes; JSON round-tripping is developer-shaped, not learner-shaped.
- **How:** Add `parseDelimited(raw): ImportParseOutcome` to `src/lib/importExport.ts` reusing `ImportRowError`/two-tier validation and the existing duplicate-front rule in `DeckDetail.handleImportFile` (which needs no changes beyond dispatching on file extension — extend the input's `accept`). Anki `.apkg` (zip + SQLite via sql.js, media, HTML content) is **large** and pulls in a WASM SQLite — worth a separate effort only if real demand appears.

### E5. Card flagging via a reserved label *(small)*
- **What:** A ⚑ toggle on Study/Test result screens marking a card "needs review", plus a flagged filter in `DeckDetail` and E1's chips.
- **Why:** "This one felt shaky, come back to it" is the most common mid-session impulse and currently requires leaving the session to edit labels.
- **How:** Reserve a label constant (`FLAGGED_LABEL = "flagged"` in `constants.ts`) and toggle it via the existing `cards.update(id, { labels })` — **zero schema, wire, or server change**, it syncs as ordinary content, and it appears in the existing label history views for free. UI: small flag button on the Study answer card and Test result card; chip styling distinct from user labels.

### E6. Configurable grading thresholds *(small–medium)*
- **What:** Expose pass/fail cosine thresholds (currently `0.85`/`0.60` in `constants.ts`) as a user setting with a "stricter ↔ lenient" slider.
- **Why:** The right band is content-dependent — vocabulary decks want strict, essay-style decks want lenient; the short-answer penalty (A2) makes one global band always wrong for someone.
- **How:** `EmbeddingGrader`'s constructor already takes both thresholds (`EmbeddingGrader.ts:79-85`) — the grader needs zero changes. Follow the `gradingDefault` pattern exactly: extend `ProfileResponseBody`/`UpdateProfileRequestBody` in `src/lib/settings/wire.ts` (+ flashy-api's users schema, hand-mirrored) and `SettingsProvider`, then `TestSession` constructs `new EmbeddingGrader(pass, fail)` from `useSettings()`. Local-only variant (localStorage) avoids the server change if cross-device consistency isn't worth it.

### E7. Deck sharing via URL-encoded payload *(medium)*
- **What:** "Share deck" produces a link like `flashy.app/share#<base64url(gzip(ExportFile))>`; opening it shows a read-only preview with "Import into my decks" — no account or server storage involved.
- **Why:** The only current sharing path is emailing a JSON file; a link is the difference between "study tool" and "study tool my classmates use."
- **How:** Reuse `buildExportFile`/`parseImportFile` unchanged (the envelope already excludes ids/owners/scheduling — exactly right for sharing). Compress with the native `CompressionStream("gzip")`, base64url-encode into the fragment (never sent to any server — privacy-preserving by construction). New `/share` route + `SharedDeckImport.tsx` that previews and then loops `cards.create` (or E-A1's `bulkCreate`) under the current `ownerId`. Constraint to surface in the UI: ~50–100 text cards fit comfortably; past a few hundred KB, fall back to "download the file instead."

### E8. Sync robustness: wake-up triggers + in-flight guard *(small)*
- **What:** Sync on `online` and `visibilitychange`, and serialize concurrent `runSync` calls.
- **Why:** Closes the A3 race (interleaved cursor writes) and the "laptop wakes, UI stale for 45 s" gap — cheap wins for perceived sync quality.
- **How:** In `AuthProvider`: an `inFlightRef: Promise<void> | null` checked at the top of `runSync`; two `window` listeners in the effect that owns the interval (`AuthProvider.tsx:164-169`).

---

## F. Architecture & Refactoring Observations

### F1. Seam violations — none material

Audited every import of `db`, graders, `scheduler`, and owner ids:

- **Storage port:** `db` is imported only by the three `Dexie*Repository` classes, `SyncEngine.ts`, and `auth/bootstrap.ts` — all sanctioned siblings per CLAUDE.md. No component or page touches Dexie. ✅
- **ownerId:** every write site (`DeckList`, `DeckDetail` import, `CardForm`, `TestSession.finishRun`) sources `useAuth().ownerId`; `LOCAL_USER_ID` appears only in `AuthProvider` and `bootstrap.ts`. ✅
- **Scheduler:** consumed only via the `scheduler` singleton in `StudySession`/`TestSession`; `DEFAULT_SCHEDULING_STATE()` used at creation sites. ✅
- **Grader:** both graders used behind the interface. **Soft spot:** the *cascade policy* (embedding-first, escalate-unless-confident, auto-accept on LLM-correct) lives inside `TestSession.runCascade` (`TestSession.tsx:266-316`) rather than behind `Grader`. It's ~80 lines of grading strategy in a UI component, and the B4 `CodeAwareGrader` will want to compose with it. Recommended refactor: a `CascadeGrader implements Grader` composing the two, with the auto-accept side effect surfaced via the existing `matchedAnswer`/`rationale` fields on `GradeResult` so `resolveGrade` keeps owning persistence. Small, behavior-neutral.
- Also policy-in-component (acceptable, but name it): the test-outcome → SM-2 rating mapping (`"good"`/`"again"`) in `persistGrade` — if A1's "should Test mutate scheduling?" question is ever revisited, this is the single line to gate.

### F2. Direct Dexie/db imports

Only the sanctioned five files listed above. Additionally: **`src/lib/node-browser-shim.ts` is referenced by nothing** — no `browser` field in `package.json`, no `turbopack.resolveAlias` in `next.config.ts` — and **`@xenova/transformers` (v2) is a dead dependency**: the only runtime import is `@huggingface/transformers` (v4) in `EmbeddingGrader.ts:30`; the string `"Xenova/all-MiniLM-L6-v2"` is just a HuggingFace org-scoped model id, not a package reference. Remove the dependency and the shim (and the stale comments in `next.config.ts`/the shim referencing the old setup) after a `npm run build` + one manual grade to confirm v4 needs neither.

### F3. TypeScript tightening

No `any` in the codebase (strict mode on). Remaining unsafe spots, in priority order:

1. **Unvalidated network casts:** `res.json() as SyncResponseBody` (`SyncEngine.ts:95`), `as GradeResponseBody` (`LlmGrader.ts:51`), `res.json() as Promise<T>` (`AuthClient.ts:31`, `UserClient.ts:29`). The server is a trusted sibling, but a version-skewed deploy (the wire files are hand-mirrored *by design*) would surface as undefined-field corruption written into Dexie rather than a clear error. A ~30-line hand-rolled guard for `SyncResponseBody` (the one that writes to storage), in the style `importExport.parseImportFile` already establishes, is the highest-value check. Zod isn't currently a dependency; it isn't needed for four shapes.
2. **Pipeline cast** in `EmbeddingGrader.ts:42-47` (`Promise<unknown>` cast to a function type) — inherent to transformers.js's loose typing; the D5 `pipelineCache` refactor is the natural place to centralize and document it once.
3. **Dexie upgrade callbacks** (`db/index.ts:79-133`) modify rows as implicitly-`any` objects — inherent to migrations over pre-schema rows; fine as-is.
4. `StoredCard` returned as `Card` (repositories, documented at `DexieCardRepository.ts:9-15`) — deliberate structural widening; keep.

### F4. Testing strategy

There is no test suite; `noEmit` typecheck is the only gate. Recommended stack: **Vitest + `fake-indexeddb` + `happy-dom`** — Vitest for native TS/ESM under the same `@/*` paths (one `vite-tsconfig-paths` plugin), `fake-indexeddb/auto` in a setup file makes the real Dexie code run unmodified, `happy-dom` only once hook/component tests appear. Add `"test": "vitest"` to `package.json`.

Priority order (value ÷ effort):

1. **Pure modules — start here, zero infrastructure:** `scheduler` (SM-2 grade mapping, lapse reset, `MIN_EASE` floor, interval progression 1→6→round(×ease), `lastReviewedAt` stamping), `testHistory.ts` (label attribution rules, `runListForLabel` rescoring, deleted-card behavior), `importExport.ts` (two-tier validation matrix).
2. **`SyncEngine` conflict logic — highest absolute value:** `applyCard`'s four-quadrant matrix (content newer local × scheduling newer local), dirty-retention on partial skips, tombstone application, `applyTestRunQuestion` immutability — this is the subtlest code in the repo and the costliest to break (silent data loss). Testable today with `fake-indexeddb` + a mocked `fetch`/`getAccessToken`; extracting the `applyX` functions' current export shape needs no refactor since they're module-level already.
3. **Repositories:** the invariants CLAUDE.md promises — every read filters tombstones, deletes are soft + `dirty:1`, deck delete cascades to cards/runs/questions, `getStatsByCards` grouping.
4. **Grader/component tests last:** `EmbeddingGrader` threshold branching with an injected fake pipeline (the D5 cache refactor makes injection trivial); Testing Library smoke tests for `TestSession` phases only if regressions actually appear there.

---

## Appendix: Prioritised Roadmap

| # | Feature | Effort | Impact | Notes |
|---|---|---|---|---|
| 1 | Fix Study due-queue bug (E1 core) | S | **High** | One-line bug with SRS-corrupting effect; do first |
| 2 | Remove `@xenova/transformers` + shim (F2) | S | Med | Dead weight; verify build after |
| 3 | Vitest + pure-module tests, then SyncEngine matrix (F4) | M | **High** | Protects the subtlest code before feature work piles on |
| 4 | Sync in-flight guard + wake triggers (E8) | S | Med | Closes the cursor race |
| 5 | Keyboard review hotkeys (E2) | S | Med | Cheap daily-use win |
| 6 | Label filtering in Study/Test (E1 rest) + flagging (E5) | S | Med | Zero schema change; makes labels load-bearing |
| 7 | Code cards: markdown util + `CardContent` + prism-react-renderer + CardForm preview + `CodeAwareGrader` (B) | M–L | **High** | Land B2 rendering first; grader guard second; editor last |
| 8 | TTS `Speaker` + Study/Test buttons (C) | S–M | Med | Small, self-contained after the B2 markdown util exists |
| 9 | CSV / plain-text import (E4) | S | Med | Extends `importExport.ts` in place |
| 10 | Cross-deck dashboard + streak (E3) | M | Med | Uses the already-built `getDueCards(null)` path |
| 11 | Configurable thresholds (E6) | S–M | Low–Med | Grader already parameterized; server mirror is the only cost |
| 12 | Voice input via Whisper (`Transcriber` + `pipelineCache`) (D) | L | Med–High | Do the `pipelineCache` extraction with #7/#8 era work; model UX needs the progress plumbing anyway |
| 13 | Deck share links (E7) | M | Med | Pure client feature; reuses export envelope |
| 14 | Anki `.apkg` import | L | Low–Med | Only on demand; sql.js + zip + media handling |
