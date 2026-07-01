# Flashy — Local-first Flashcard / SRS App (Phase 1)

A fully offline, zero-cost spaced-repetition study app built with Next.js, Dexie, and on-device embeddings via transformers.js.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

No API keys, no backend, no account required.

---

## Architecture seams

### 1. Storage port (`src/lib/repositories/`)

| File | Purpose |
|---|---|
| `interfaces.ts` | `CardRepository` and `DeckRepository` interfaces — the only storage API components see |
| `DexieCardRepository.ts` | Concrete IndexedDB/Dexie implementation |
| `DexieDeckRepository.ts` | Concrete IndexedDB/Dexie implementation (cascades card deletes) |
| `src/lib/db/index.ts` | Dexie schema (one place to update for migrations) |

**Phase 2:** Implement `HybridCardRepository` satisfying the same interface. Swap it in `src/components/providers/RepositoryProvider.tsx` — no component changes needed.

### 2. Grading port (`src/lib/grading/`)

| File | Purpose |
|---|---|
| `Grader.ts` | `Grader` interface: `grade(front, correct, user) → Promise<GradeResult>` |
| `EmbeddingGrader.ts` | Local-embedding implementation using `Xenova/all-MiniLM-L6-v2` (WASM) |

**Phase 2:** Implement `LlmGrader implements Grader`. In `TestSession.tsx`, a `grader` ref holds the active implementation — swap the constructed value. The "AI grade (Phase 2)" button placeholder is already in the UI, marked disabled.

### 3. `ownerId` field

Every `Card` and `Deck` carries `ownerId`, defaulting to `LOCAL_USER_ID = "local-user"` (`src/lib/constants.ts`).

**Phase 2:** Replace with the authenticated user's ID. No schema migration needed.

### 4. SRS scheduler (`src/lib/scheduler/index.ts`)

| Export | Purpose |
|---|---|
| `Scheduler` interface | `review(state, rating) → SchedulingState` |
| `scheduler` | Active instance — swap to change algorithm |
| `DEFAULT_SCHEDULING_STATE()` | Initial state for new cards (due immediately) |

**Phase 2:** Implement FSRS or a server-side scheduler. Replace the `scheduler` export — no component changes.

---

## Functional overview

### CRUD
- **Home** (`/`): list and create decks.
- **Deck detail** (`/decks/[deckId]`): list, add, edit, delete cards; rename or delete deck. Deck deletion **cascades** — all cards are deleted with a confirmation warning.
- **Card form** (`/decks/[deckId]/cards/new`, `.../cards/[cardId]/edit`): create or edit a card.

### Study (card/flashcard) mode — `/decks/[deckId]/study`
- Shows due cards (due date ≤ now). Display front → tap "Reveal answer" → show back.
- Rate recall: **Again / Hard / Good / Easy** → SM-2 → persists scheduling state.

### Test mode — `/decks/[deckId]/test`
- User types a free-text answer.
- **Local embedding grader** (on-device, no network):
  - cosine ≥ 0.85 → auto-correct; cosine ≤ 0.60 → auto-incorrect; between → self-grade.
  - Model lazy-loaded on first use (~10 s, cached for session).
- "AI grade (Phase 2)" button present but **disabled**.

---

## Design decisions

| Decision | Choice |
|---|---|
| Deck delete | Cascade with confirmation dialog |
| Recall scale | Again / Hard / Good / Easy (SM-2 grades 0/1/3/5) |
| Embedding model | `Xenova/all-MiniLM-L6-v2` (384-dim, ~23 MB quantized WASM) |
| Pass threshold | 0.85 cosine similarity |
| Fail threshold | 0.60 cosine similarity |
| SM-2 intervals | reps 0→1 d, 1→6 d, n≥2→round(prev×ease) |
| Min ease factor | 1.3 (SM-2 standard) |
