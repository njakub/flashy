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

Flashy is a **fully offline, local-first** spaced-repetition flashcard app (Next.js App Router + Dexie/IndexedDB + on-device embeddings via `@xenova/transformers`). No backend, no API keys, no accounts — this is "Phase 1" of a two-phase plan, and the codebase is deliberately structured around four seams so that Phase 2 (server sync, real auth, LLM grading) can be dropped in without touching component code.

### The four seams

1. **Storage port** — `src/lib/repositories/`
   - `interfaces.ts` defines `CardRepository`, `DeckRepository`, `TestRunRepository` — the *only* storage API components are allowed to see.
   - `DexieCardRepository.ts` / `DexieDeckRepository.ts` / `DexieTestRunRepository.ts` are the concrete IndexedDB implementations.
   - `src/lib/db/index.ts` holds the single Dexie schema (`FlashyDB`) — this is the one place to add tables/indexes/migrations. Bump the Dexie `version()` and add an `.upgrade()` hook rather than mutating an existing version.
   - Components never construct repositories directly — they go through `useRepositories()` (`src/components/providers/RepositoryProvider.tsx`), which hands out singleton instances via React context. Phase 2 swaps the singletons here for a hybrid local+remote implementation.

2. **Grading port** — `src/lib/grading/`
   - `Grader.ts` defines the `Grader` interface: `grade(front, correct, user) → Promise<GradeResult>`.
   - `EmbeddingGrader.ts` is the only implementation: on-device embeddings (`Xenova/all-MiniLM-L6-v2`, 384-dim, ~23MB quantized WASM), lazy-loaded on first use and cached for the session. Cosine similarity ≥ 0.85 → auto-correct, ≤ 0.60 → auto-incorrect, in between → user self-grades.
   - `TestSession.tsx` holds the active grader in a ref; Phase 2 swaps in an `LlmGrader implements Grader` there. The UI already has a disabled "AI grade (Phase 2)" button placeholder.

3. **`ownerId`** — every `Card` and `Deck` carries an `ownerId`, defaulting to `LOCAL_USER_ID = "local-user"` (`src/lib/constants.ts`). Phase 2 replaces this with the authenticated user's ID — no schema migration needed since the field already exists.

4. **SRS scheduler** — `src/lib/scheduler/index.ts` exports a `Scheduler` interface (`review(state, rating) → SchedulingState`), an active `scheduler` singleton (current algorithm: SM-2), and `DEFAULT_SCHEDULING_STATE()` for new cards. Phase 2 (e.g. FSRS, or a server-side scheduler) replaces the `scheduler` export only.

When making changes, keep new code behind the relevant interface rather than reaching directly into a Dexie table, a specific grader, or a hardcoded owner id from a component/page.

### Data model (`src/lib/types.ts`)

- `Deck` / `Card` — `Card.scheduling: SchedulingState` holds the SM-2 state (`easeFactor`, `intervalDays`, `dueAt`, `reps`, `lapses`). `Card.alternateAnswers` are extra accepted phrasings used only for grading, not shown as the canonical answer.
- `TestRun` / `TestRunQuestion` — test-mode history. `TestRunQuestion` snapshots the card's front/back at attempt time so history stays accurate if the card is later edited/deleted. `outcome` is always resolved (`"correct" | "incorrect"`) before persisting — `"ambiguous"` (from `GradeResult`) is never written; the user must self-grade first.
- `CardStats` is derived (attempts/correct per card), computed from `TestRunQuestion` rows via `TestRunRepository.getStatsByCards` — never stored, and implemented as one grouped query rather than N per-card queries.

### Routes / functional areas

- `/` — list and create decks (`DeckList.tsx`).
- `/decks/[deckId]` — deck detail: list/add/edit/delete cards, rename/delete deck (`DeckDetail.tsx`). Deck deletion cascades to cards and test history, with a confirmation dialog.
- `/decks/[deckId]/cards/new`, `/decks/[deckId]/cards/[cardId]/edit` — card create/edit form (`CardForm.tsx`).
- `/decks/[deckId]/study` — flashcard (Study) mode (`StudySession.tsx`): shows due cards (due ≤ now), reveal-answer flow, rate Again/Hard/Good/Easy → SM-2 → persisted scheduling state.
- `/decks/[deckId]/test` — Test mode (`TestSession.tsx`): free-text answer graded by the embedding grader (see seam 2 above).

### Design decisions worth knowing before changing behavior

| Decision | Choice |
|---|---|
| Recall scale | Again / Hard / Good / Easy, mapped to SM-2 grades 0/1/3/5 |
| Embedding model | `Xenova/all-MiniLM-L6-v2` (384-dim, ~23MB quantized WASM) |
| Grading thresholds | cosine ≥ 0.85 pass, ≤ 0.60 fail, else self-grade |
| SM-2 intervals | reps 0→1 day, 1→6 days, n≥2→`round(prev × ease)` |
| Min ease factor | 1.3 (SM-2 standard) |

### Turbopack / WASM notes (`next.config.ts`, `src/lib/node-browser-shim.ts`)

- COOP/COEP headers are intentionally **not** set: `@xenova/transformers` uses single-threaded quantized WASM and doesn't need `SharedArrayBuffer`, and those headers would block cross-origin model/WASM downloads from HuggingFace/JSDelivr CDNs.
- `node-browser-shim.ts` is an empty-object stub for Node built-ins (`fs`, etc.) that `@xenova/transformers` imports but never calls in-browser. It exists because Turbopack resolves `"browser": {"fs": false}` in `package.json` as `undefined` rather than an empty-object stub (which webpack provides), and the library's `isEmpty(fs)` check throws on `undefined`.
