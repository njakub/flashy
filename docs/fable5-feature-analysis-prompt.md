# Fable5 Prompt — Flashy: Feature Analysis & Architecture

You are an expert product engineer and software architect. Your job is to deeply analyse the **Flashy** codebase and produce a structured feature-suggestion and architecture report. Read every file you need before writing any recommendations.

---

## 1. Context

Flashy is a **local-first, offline-capable spaced-repetition flashcard app** built with:

- **Next.js 16 (App Router, Turbopack)** — React 19, TypeScript 5
- **Dexie 4 / IndexedDB** — local storage, soft deletes, dirty-flag sync
- **SM-2 scheduler** — `src/lib/scheduler/index.ts`
- **`@huggingface/transformers` v4** — on-device `Xenova/all-MiniLM-L6-v2` (384-dim, ~23 MB quantised WASM) for free-text grading
- **JWT auth + cross-device sync** against a sibling NestJS + Prisma + Postgres backend (`../flashy-api`)
- **Tailwind CSS v4**

### Key seams (don't break these)

1. **Storage port** — components use `useRepositories()` only; never touch Dexie directly.
2. **Grader port** — `src/lib/grading/Grader.ts` interface: `grade(front, correctAnswers[], userAnswer) → Promise<GradeResult>`.
3. **`ownerId`** — every record carries `ownerId`; use `useAuth().ownerId` (not a hardcoded constant) everywhere.
4. **SRS scheduler** — `src/lib/scheduler/index.ts` exports a `Scheduler` interface + `scheduler` singleton (SM-2).

### Current data model (relevant excerpt)

```ts
interface Card {
  id;
  ownerId;
  deckId;
  front: string; // question
  back: string; // primary answer
  alternateAnswers: string[]; // extra accepted gradings
  labels: string[]; // tags
  createdAt;
  updatedAt;
  scheduling: SchedulingState; // SM-2
}
interface TestRun {
  id;
  ownerId;
  deckId;
  startedAt;
  completedAt;
  questionCount;
  correctCount;
}
interface TestRunQuestion {
  id;
  runId;
  cardId;
  cardFrontSnapshot;
  cardBackSnapshot; // immutable at capture time
  userAnswer: string;
  outcome: "correct" | "incorrect";
  similarity?: number; // cosine score from embedding grader
}
interface CardStats {
  cardId;
  attempts;
  correct;
} // derived, never stored
```

### Current routes

| Route                                         | Component                      | Purpose                                      |
| --------------------------------------------- | ------------------------------ | -------------------------------------------- |
| `/`                                           | `DeckList`                     | List + create decks                          |
| `/decks/[id]`                                 | `DeckDetail`                   | Cards list, stats, export/import             |
| `/decks/[id]/cards/new` · `.../[cardId]/edit` | `CardForm`                     | Create / edit card                           |
| `/decks/[id]/study`                           | `StudySession`                 | Flashcard reveal → rate Again/Hard/Good/Easy |
| `/decks/[id]/test`                            | `TestSession`                  | Select count → free-text quiz → results      |
| `/decks/[id]/history` · `.../[runId]`         | `TestHistory`, `TestRunDetail` | Run history + per-run detail                 |
| `/login`                                      | `LoginPage`                    | Register / sign-in                           |

### Grading flow

1. User types free-text answer.
2. `EmbeddingGrader` embeds question + all accepted answers + user answer; takes **max cosine** across accepted answers.
3. ≥ 0.85 → `"correct"` auto; ≤ 0.60 → `"incorrect"` auto; else → `"ambiguous"` → user self-grades.
4. Resolved outcome persisted to `TestRunQuestion`; `"ambiguous"` is never stored.
5. On incorrect or ambiguous screens, user can add the answer they typed as a new `alternateAnswer`.

---

## 2. Your Task

Work through the following analysis areas **in order**. For each, read the relevant source files in `src/` before writing recommendations. Produce a detailed Markdown report.

---

### A. Current Flow Review

Analyse the end-to-end UX and code flows for:

- Deck creation → card authoring → Study session → Test session → History review
- The grading pipeline (submit → embed → compare → self-grade → persist)
- Sync lifecycle (dirty → debounce → push/pull → apply)

For each flow, identify:

- Friction points or missing feedback (loading states, empty states, error recovery)
- Performance risks (e.g. re-embed on every keystroke, model cold-start, large decks)
- Data integrity edge-cases (e.g. card edited mid-session, deck deleted during sync)

---

### B. Code Snippets as Card Content

**Goal**: Card `front` and `back` should support syntax-highlighted code alongside prose.

Investigate and propose:

1. **Storage**: Should `front`/`back` remain plain strings with an embedded format (e.g. Markdown with fenced code blocks), or should the schema add a `contentType: "plain" | "markdown" | "mixed"` field? Consider sync implications.
2. **Rendering**: Evaluate `react-syntax-highlighter`, `shiki` (zero-runtime tokeniser, can run server-side or in a worker), and `prism-react-renderer`. Which fits a local-first Turbopack app best?
3. **Authoring UX**: Propose a card editor upgrade — a split plain-text + live-preview pane, or a block-based editor (e.g. Tiptap with a code block extension). Describe how this plugs into the existing `CardForm` component.
4. **Grading impact**: When a question or answer contains code, the current cosine-similarity grader may underperform. Propose a mitigation (e.g. strip code before embedding, add a dedicated code-equality check, or fall back to self-grade when `contentType` includes code).
5. **Test session display**: How should `cardFrontSnapshot` / `cardBackSnapshot` in `TestRunQuestion` handle code content? The snapshots are immutable — propose a versioned content envelope.

---

### C. Text-to-Speech (Answer Read-Out)

**Goal**: User can press a button to have the card's answer (or question) read aloud.

Investigate and propose:

1. **API choice**: Web Speech API `SpeechSynthesis` vs. a third-party TTS (ElevenLabs, Azure Cognitive, OpenAI TTS). Evaluate offline capability, latency, cost, and browser support (Firefox is primary).
2. **Architecture**: A `Speaker` interface (`speak(text: string): void; cancel(): void; isSpeaking: boolean`) analogous to `Grader`, with a `WebSpeechSpeaker` implementation. Where should the singleton live (context, hook, module-level)?
3. **Integration points**: Which screens benefit most — Study reveal, Test result, Test ambiguous self-grade? Propose button placement in each component.
4. **Code content handling**: When `back` contains a fenced code block, propose stripping or summarising the code before passing to TTS (e.g. "code block omitted").
5. **Accessibility**: How does this interact with screen readers that already use the Speech API? Propose a user preference toggle (stored in `localStorage` or a new `UserSettings` table in Dexie).

---

### D. Voice Input (Microphone → Text Answer)

**Goal**: User can answer a test question by speaking rather than typing.

Investigate and propose:

1. **API choice**: Web Speech API `SpeechRecognition` (continuous vs. single-shot) vs. on-device Whisper via `@huggingface/transformers` (same pipeline pattern already used for embeddings) vs. a cloud STT API. Evaluate offline capability, Firefox support (SpeechRecognition is **not supported in Firefox** — critical constraint), latency, and accuracy.
2. **Fallback strategy**: Since Firefox lacks `SpeechRecognition`, propose a graceful degradation path — detect support on mount, hide the mic button if unavailable, show a tooltip explaining why.
3. **Architecture**: A `Transcriber` interface (`transcribe(): Promise<string>; isListening: boolean`) with a `WebSpeechTranscriber` (Chrome/Safari) and a `WhisperTranscriber` (on-device, cross-browser). The `TestSession` would use a `useTranscriber()` hook that selects the available implementation.
4. **UX flow**: Mic button → recording indicator → interim transcript shown live → confirm/re-record → submits to existing grading pipeline unchanged. Propose the state machine (idle → recording → processing → done).
5. **Model loading**: If using Whisper on-device, the model is large (~75–150 MB). Propose a lazy-load strategy consistent with how `EmbeddingGrader` already lazy-loads its model (dynamic `import()` + cached pipeline ref). Should both models share a `ModelCache` singleton?
6. **Privacy**: All processing stays on-device for both STT options. Note any server-side fallback that would require explicit user consent and a privacy notice.

---

### E. Additional Feature Suggestions

Read the full codebase, then propose **at least 5 additional features** that would meaningfully improve the learning experience or developer ergonomics. For each, include:

- **What**: One-sentence description.
- **Why**: User value.
- **How**: Concrete implementation sketch (which files change, what new interfaces/components are needed, rough complexity: small/medium/large).

Suggested areas to consider (you may discover others):

- Deck import/export improvements (currently JSON — consider Anki `.apkg` import)
- Label/tag filtering in Study and Test modes (labels are stored but not yet used for filtering)
- Streak / retention dashboard (aggregate stats across all decks)
- Deck sharing / public links (read-only deck export URL, no backend account required — use a URL-encoded payload)
- Keyboard-only navigation for power users (Study mode hotkeys: Space = reveal, 1/2/3/4 = Again/Hard/Good/Easy)
- Configurable grading thresholds (currently hardcoded: 0.85 / 0.60)
- Card flagging / "needs review" marker
- Bulk card import from CSV or plain text (one line per card, `front|back` format)

---

### F. Architecture & Refactoring Observations

1. Identify any current violations of the four seams (storage port, grader port, ownerId, scheduler).
2. Flag any components that import from Dexie or `db/index.ts` directly (they shouldn't).
3. Note any TypeScript `any` or unsafe casts that could be tightened.
4. Propose a testing strategy: which layer is highest-value to unit-test first (repositories, grader, scheduler), and what test infrastructure (Vitest + fake-indexeddb) would fit this stack.

---

## 3. Output Format

Produce a single Markdown document structured as:

```
# Flashy — Feature Analysis & Architecture Report

## Executive Summary
(3–5 bullet point highlights)

## A. Current Flow Review
...

## B. Code Snippets as Card Content
...

## C. Text-to-Speech
...

## D. Voice Input
...

## E. Additional Feature Suggestions
...

## F. Architecture Observations
...

## Appendix: Prioritised Roadmap
(Table: Feature | Effort | Impact | Recommended order)
```

Be specific. Reference actual file paths, function names, and interface names from the codebase. Where you propose new code, include illustrative TypeScript sketches (not full implementations — just enough to show the shape of the change). Do **not** invent file names or function signatures that don't exist; check first.
