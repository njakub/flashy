# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server (Turbopack) at http://localhost:3000
npm run build    # production build
npm run start    # run the production build
npm run lint     # eslint (eslint-config-next core-web-vitals + typescript)
```

There is no test suite in this repo yet. Type checking is not run as a separate script — use the TypeScript language service / `tsc --noEmit` if you need to check types manually (`noEmit: true` is already set in `tsconfig.json`).

## Architecture

Flashy is a **local-first** spaced-repetition flashcard app (Next.js App Router + Dexie/IndexedDB + on-device embeddings via `@xenova/transformers`). It works fully offline with no account; signing in adds cross-device sync against a sibling backend, **`../flashy-api`** (NestJS + Prisma + Postgres — see that project's own CLAUDE.md for the server side). The codebase is structured around four seams; two of them (storage, `ownerId`) now have their sync/auth implementation in place, the other two (grading, scheduler) are still single-implementation placeholders for future work.

### The four seams

1. **Storage port** — `src/lib/repositories/`
   - `interfaces.ts` defines `CardRepository`, `DeckRepository`, `TestRunRepository` — the *only* storage API components are allowed to see. These interfaces are unchanged by sync.
   - `DexieCardRepository.ts` / `DexieDeckRepository.ts` / `DexieTestRunRepository.ts` are the concrete IndexedDB implementations. Deletes are **soft** (`deletedAt` set + `dirty: 1`), not hard `.delete()` — every read method filters `deletedAt !== null` rows back out, so a delete looks the same to callers either way, but the tombstone survives to sync. Every write (create/update/delete) calls `notifyDirty()` (`src/lib/sync/dirtyBus.ts`) to trigger a debounced sync.
   - `src/lib/db/index.ts` holds the single Dexie schema (`FlashyDB`) — this is the one place to add tables/indexes/migrations. Bump the Dexie `version()` and add an `.upgrade()` hook rather than mutating an existing version. `StoredCard`/`StoredDeck`/`StoredTestRun`/`StoredTestRunQuestion` extend the public `Card`/`Deck`/`TestRun`/`TestRunQuestion` types with sync-only `deletedAt`/`dirty` fields — these never appear on the public interfaces above, only inside the Dexie repository implementations and `SyncEngine`. `syncState` is a one-row table holding the per-table server revision cursor.
   - Components never construct repositories directly — they go through `useRepositories()` (`src/components/providers/RepositoryProvider.tsx`), which hands out singleton instances via React context.
   - **Sync itself is not a per-call network wrapper** around the repositories — that would break offline reads/writes. `SyncEngine` (`src/lib/sync/SyncEngine.ts`) is a **sibling** that shares the same Dexie tables directly (including the sync-only fields the repository interfaces hide): it reads dirty rows, does one push+pull round trip against `flashy-api`'s `POST /sync`, and writes the server's authoritative response back into Dexie. It's race-safe — if a row is edited again locally while a round trip is in flight, the newer local edit wins and stays `dirty: 1` for the next cycle rather than being overwritten. See "Sync" below.

2. **Grading port** — `src/lib/grading/`
   - `Grader.ts` defines the `Grader` interface: `grade(front, correct, user) → Promise<GradeResult>`.
   - `EmbeddingGrader.ts` is the only implementation: on-device embeddings (`Xenova/all-MiniLM-L6-v2`, 384-dim, ~23MB quantized WASM), lazy-loaded on first use and cached for the session. Cosine similarity ≥ 0.85 → auto-correct, ≤ 0.60 → auto-incorrect, in between → user self-grades.
   - `TestSession.tsx` holds the active grader in a ref; a future `LlmGrader implements Grader` swaps in there. The UI already has a disabled "AI grade" button placeholder.

3. **`ownerId` / auth** — every `Card`, `Deck`, and `TestRun` carries an `ownerId`. Components source it from `useAuth().ownerId` (`src/components/providers/AuthProvider.tsx`), not from a hardcoded constant — it's the real signed-in user's id, or `LOCAL_USER_ID = "local-user"` (`src/lib/constants.ts`) when signed out. Signed-out isn't a separate mode; it's just `ownerId = LOCAL_USER_ID`, identical to pre-auth behavior.
   - Auth is email/password against `flashy-api`: JWT access token (15 min, kept in memory) + rotating refresh token (30 days, `localStorage`). `AuthClient` (`src/lib/auth/AuthClient.ts`) wraps the HTTP calls; `AuthProvider` owns the session, the sync loop (see below), and calls `bootstrapLocalUserData()` (`src/lib/auth/bootstrap.ts`) on every sign-in — idempotent re-stamp of any `LOCAL_USER_ID`-owned rows to the real user id, marking them dirty so pre-auth local data survives and pushes on the next sync.
   - `/login` (`src/app/login/page.tsx`) is a single form that toggles between register/sign-in. `AuthBar` (`src/components/AuthBar.tsx`), mounted in the root layout, shows sign-in status and a live sync indicator.

4. **SRS scheduler** — `src/lib/scheduler/index.ts` exports a `Scheduler` interface (`review(state, rating) → SchedulingState`), an active `scheduler` singleton (current algorithm: SM-2), and `DEFAULT_SCHEDULING_STATE()` for new cards. A future FSRS or server-side scheduler replaces the `scheduler` export only. `SchedulingState.lastReviewedAt` is stamped on every review — sync uses it to reconcile scheduling independently from card content (see "Sync").

When making changes, keep new code behind the relevant interface rather than reaching directly into a Dexie table, a specific grader, or a hardcoded owner id from a component/page.

### Sync

`SyncEngine.syncOnce()` does one push+pull round trip against `flashy-api`'s `POST /sync`:
1. Push every row with `dirty: 1` across all four tables.
2. Pull everything server-side changed since this device's cursor (`db.syncState`, per-table revisions, not wall-clock time — immune to client clock skew).
3. Apply pulled rows into Dexie. Per row, compare the server's timestamp against the **current local** value (not a pre-push snapshot) before overwriting — if local has moved on since the push was sent, keep the local value and leave `dirty: 1` so the real latest edit re-pushes next cycle. Never silently loses a same-device concurrent edit.

Conflict handling mirrors the server (`flashy-api`'s `SyncService`) by design: `TestRun`/`TestRunQuestion` are append-only (union merge, no conflicts — `CardStats` is never synced, each device recomputes it locally from `TestRunQuestion` rows via `getStatsByCards`); `Card`/`Deck` content is last-writer-wins by `updatedAt`; `Card.scheduling` is reconciled as an **independent field-group** keyed on `lastReviewedAt`, so a content edit on one device can never clobber a review recorded on another, or vice versa. Deletes are tombstones (`deletedAt`), and deck deletion cascades tombstones to its cards/runs both client-side (`DexieDeckRepository.delete`) and defensively server-side.

Sync triggers, all in `AuthProvider`:
- On sign-in / app open.
- Every 45s while signed in (`SYNC_INTERVAL_MS`).
- ~2s after any local write, debounced (`src/lib/sync/dirtyBus.ts`'s `notifyDirty()`/`onDirty()`, subscribed in `AuthProvider`).

There is no real-time push — a background sync's pulled rows won't appear in the UI unless something re-fetches. `src/lib/sync/syncEvents.ts` (`notifySyncApplied()`, fired by `SyncEngine` after applying a non-empty pull) plus the `useReloadOnSync(load)` hook (`src/lib/sync/useReloadOnSync.ts`) is how DeckList/DeckDetail/TestHistory/TestRunDetail pick up changes pulled from another device without a manual refresh. **`StudySession`/`TestSession` deliberately don't use this hook** — re-fetching the due-card queue mid-session on a background sync would yank cards out from under an in-progress review, so those two intentionally only load once per session.

`src/lib/sync/wire.ts` is a hand-written mirror of `flashy-api`'s `src/sync/sync.schema.ts` / `sync.types.ts` wire protocol — the two projects deploy independently, so this must be changed by hand in both places if the protocol changes.

### Data model (`src/lib/types.ts`)

- `Deck` / `Card` — `Card.scheduling: SchedulingState` holds the SM-2 state (`easeFactor`, `intervalDays`, `dueAt`, `reps`, `lapses`, `lastReviewedAt`). `lastReviewedAt` is stamped by the scheduler on every review and used only by sync (reconciles scheduling independently from content — see "Sync" above); it's `null` until the card's first review. `Card.alternateAnswers` are extra accepted phrasings used only for grading, not shown as the canonical answer.
- `TestRun` / `TestRunQuestion` — test-mode history. `TestRunQuestion` snapshots the card's front/back at attempt time so history stays accurate if the card is later edited/deleted. `outcome` is always resolved (`"correct" | "incorrect"`) before persisting — `"ambiguous"` (from `GradeResult`) is never written; the user must self-grade first.
- `CardStats` is derived (attempts/correct per card), computed from `TestRunQuestion` rows via `TestRunRepository.getStatsByCards` — never stored, and implemented as one grouped query rather than N per-card queries.
- Sync-only fields (`deletedAt`, `dirty`) live on `StoredCard`/`StoredDeck`/`StoredTestRun`/`StoredTestRunQuestion` in `src/lib/db/index.ts`, not on these public types — see seam 1 above.

### Routes / functional areas

- `/login` — register or sign in (`src/app/login/page.tsx`); one form, toggles mode client-side.
- `/` — list and create decks (`DeckList.tsx`).
- `/decks/[deckId]` — deck detail: list/add/edit/delete cards, rename/delete deck, export/import cards as JSON (`DeckDetail.tsx`). Deck deletion cascades to cards and test history, with a confirmation dialog.
- `/decks/[deckId]/cards/new`, `/decks/[deckId]/cards/[cardId]/edit` — card create/edit form (`CardForm.tsx`).
- `/decks/[deckId]/study` — flashcard (Study) mode (`StudySession.tsx`): shows due cards (due ≤ now), reveal-answer flow, rate Again/Hard/Good/Easy → SM-2 → persisted scheduling state.
- `/decks/[deckId]/test` — Test mode (`TestSession.tsx`): free-text answer graded by the embedding grader (see seam 2 above).
- `/decks/[deckId]/history`, `/decks/[deckId]/history/[runId]` — test history (`TestHistory.tsx`, `TestRunDetail.tsx`): runs list (overall or grouped by label) and per-run question detail.

### Design decisions worth knowing before changing behavior

| Decision | Choice |
|---|---|
| Recall scale | Again / Hard / Good / Easy, mapped to SM-2 grades 0/1/3/5 |
| Embedding model | `Xenova/all-MiniLM-L6-v2` (384-dim, ~23MB quantized WASM) |
| Grading thresholds | cosine ≥ 0.85 pass, ≤ 0.60 fail, else self-grade |
| SM-2 intervals | reps 0→1 day, 1→6 days, n≥2→`round(prev × ease)` |
| Min ease factor | 1.3 (SM-2 standard) |
| Sync mechanism | Local-first; push/pull delta against a per-table server revision cursor, not real-time |
| Sync conflict resolution | Content = last-writer-wins by `updatedAt`; scheduling = independent, keyed on `lastReviewedAt`; history = append-only union merge |
| Auth | Email/password against `flashy-api`; JWT access token (15 min) + rotating refresh token (30 days) |

### Turbopack / WASM notes (`next.config.ts`, `src/lib/node-browser-shim.ts`)

- COOP/COEP headers are intentionally **not** set: `@xenova/transformers` uses single-threaded quantized WASM and doesn't need `SharedArrayBuffer`, and those headers would block cross-origin model/WASM downloads from HuggingFace/JSDelivr CDNs.
- `node-browser-shim.ts` is an empty-object stub for Node built-ins (`fs`, etc.) that `@xenova/transformers` imports but never calls in-browser. It exists because Turbopack resolves `"browser": {"fs": false}` in `package.json` as `undefined` rather than an empty-object stub (which webpack provides), and the library's `isEmpty(fs)` check throws on `undefined`.
