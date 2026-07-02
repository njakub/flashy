# Flashy — Local-first Flashcard / SRS App

A local-first spaced-repetition study app built with Next.js, Dexie, and on-device embeddings via transformers.js. Works fully offline out of the box; sign in to sync decks, cards, and test history across devices via the companion `flashy-api` backend.

## Quick start

### Offline only (no backend)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No API keys, no backend, no account required — everything lives in IndexedDB on this device.

### With cross-device sync

Sync needs the sibling [`flashy-api`](../flashy-api) project (NestJS + Prisma + Postgres) running alongside this one.

```bash
# 1. Start flashy-api (from ../flashy-api) — see its own setup, in short:
docker compose up -d postgres   # local Postgres on :5433
npm install
npx prisma migrate dev
npm run start:dev               # listens on :3001

# 2. Point this app at it
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:3001

# 3. Run this app as usual
npm run dev
```

Then sign in (or register) at `/login`. Any decks/cards created before signing in are re-stamped to your account and pushed on first sign-in.

---

## Architecture seams

### 1. Storage port (`src/lib/repositories/`)

| File | Purpose |
|---|---|
| `interfaces.ts` | `CardRepository`, `DeckRepository`, `TestRunRepository` — the only storage API components see |
| `DexieCardRepository.ts` / `DexieDeckRepository.ts` / `DexieTestRunRepository.ts` | Concrete IndexedDB/Dexie implementations. Deletes are soft (tombstoned + `dirty: 1`), not hard, so they can sync; every read filters tombstoned rows back out. |
| `src/lib/db/index.ts` | Dexie schema (one place to update for migrations). `StoredCard`/`StoredDeck`/`StoredTestRun`/`StoredTestRunQuestion` extend the public types with sync-only `deletedAt`/`dirty` fields components never see. |

Components obtain repositories through `useRepositories()` (`RepositoryProvider`) — never by constructing them directly.

**Sync** is not a per-call network wrapper around these repositories (that would break offline reads/writes). Instead `SyncEngine` (`src/lib/sync/`) is a **sibling** that shares the same Dexie tables: it reads dirty rows, pushes them to `flashy-api`'s `POST /sync`, and writes back whatever the server returns as authoritative. See [Sync](#sync) below.

### 2. Grading port (`src/lib/grading/`)

| File | Purpose |
|---|---|
| `Grader.ts` | `Grader` interface: `grade(front, correct, user) → Promise<GradeResult>` |
| `EmbeddingGrader.ts` | Local-embedding implementation using `Xenova/all-MiniLM-L6-v2` (WASM) |

**Future:** implement `LlmGrader implements Grader`. In `TestSession.tsx`, a `grader` ref holds the active implementation — swap the constructed value. The "AI grade" button placeholder is already in the UI, marked disabled.

### 3. `ownerId` / auth

Every `Card`, `Deck`, and `TestRun` carries `ownerId`. Components source it from `useAuth().ownerId` (`src/components/providers/AuthProvider.tsx`) — the real signed-in user's id, or `LOCAL_USER_ID = "local-user"` (`src/lib/constants.ts`) when signed out. There is no separate offline mode to opt into: signed-out is just `ownerId = LOCAL_USER_ID`, and it works identically to before auth existed.

Auth is email/password against `flashy-api`: a short-lived JWT access token (15 min) plus a rotating refresh token (30 days, stored in `localStorage`; access token kept in memory). On first sign-in, `bootstrapLocalUserData()` (`src/lib/auth/bootstrap.ts`) re-stamps any existing `LOCAL_USER_ID`-owned rows to the real user id and marks them dirty so they push on the next sync.

### 4. SRS scheduler (`src/lib/scheduler/index.ts`)

| Export | Purpose |
|---|---|
| `Scheduler` interface | `review(state, rating) → SchedulingState` |
| `scheduler` | Active instance — swap to change algorithm |
| `DEFAULT_SCHEDULING_STATE()` | Initial state for new cards (due immediately) |

**Future:** implement FSRS or a server-side scheduler. Replace the `scheduler` export — no component changes. `SchedulingState.lastReviewedAt` (stamped by the scheduler on every review) is what sync uses to reconcile scheduling independently from card content — see below.

---

## Sync

`SyncEngine` (`src/lib/sync/SyncEngine.ts`) does one push+pull round trip against `flashy-api`'s `POST /sync`:

1. **Push** every locally-dirty row (`dirty: 1` in Dexie).
2. **Pull** everything changed on the server since this device's last-seen revision cursor (`db.syncState`, one row per table).
3. Apply pulled rows back into Dexie, race-safely — if a row was edited locally again while the round trip was in flight, the newer local edit wins and stays `dirty: 1` for the next cycle instead of being clobbered.

**Conflict handling:**
- `TestRun` / `TestRunQuestion` (history) are append-only — union merge, no conflicts. `CardStats` is never synced; each device recomputes it locally from `TestRunQuestion` rows.
- `Card`/`Deck` content (front, back, labels, name, …) is last-writer-wins by `updatedAt`.
- `Card.scheduling` is reconciled **independently** from content, keyed on `lastReviewedAt` — so a label edit on one device can never clobber a study review recorded on another, or vice versa.
- Deletes are tombstones (`deletedAt`), not hard deletes, so they propagate. Deleting a deck cascades tombstones to its cards and test runs, both client-side and defensively server-side.

**Sync triggers:** on sign-in/app open, every 45s while signed in, and ~2s after any local write (debounced via `src/lib/sync/dirtyBus.ts`). Components that display synced data (deck list, deck detail, test history) re-fetch automatically when a background sync pulls new rows, via `useReloadOnSync` (`src/lib/sync/syncEvents.ts`) — Study/Test session screens deliberately don't, so a background sync can't yank the due-card queue out from under an in-progress session.

The backend (`../flashy-api`) is a separate NestJS + Prisma + Postgres project — see its own README/CLAUDE.md for the server-side schema, auth, and conflict-resolution implementation.

---

## Functional overview

### Auth
- **`/login`**: register or sign in. Toggling between the two is a client-side mode switch on one form.

### CRUD
- **Home** (`/`): list and create decks.
- **Deck detail** (`/decks/[deckId]`): list, add, edit, delete cards; rename or delete deck; export/import cards as JSON. Deck deletion **cascades** — all cards and test history are removed, with a confirmation warning.
- **Card form** (`/decks/[deckId]/cards/new`, `.../cards/[cardId]/edit`): create or edit a card, including alternate answers and labels.

### Study (card/flashcard) mode — `/decks/[deckId]/study`
- Shows due cards (due date ≤ now). Display front → tap "Reveal answer" → show back.
- Rate recall: **Again / Hard / Good / Easy** → SM-2 → persists scheduling state (and stamps `lastReviewedAt`).

### Test mode — `/decks/[deckId]/test`
- User types a free-text answer.
- **Local embedding grader** (on-device, no network):
  - cosine ≥ 0.85 → auto-correct; cosine ≤ 0.60 → auto-incorrect; between → self-grade.
  - Model lazy-loaded on first use (~10 s, cached for session).
- Each completed run is saved to history (`/decks/[deckId]/history`), viewable per-run or aggregated by label.

---

## Design decisions

| Decision | Choice |
|---|---|
| Deck delete | Cascade with confirmation dialog; tombstoned (soft-deleted) locally and on the server so it syncs |
| Recall scale | Again / Hard / Good / Easy (SM-2 grades 0/1/3/5) |
| Embedding model | `Xenova/all-MiniLM-L6-v2` (384-dim, ~23 MB quantized WASM) |
| Pass threshold | 0.85 cosine similarity |
| Fail threshold | 0.60 cosine similarity |
| SM-2 intervals | reps 0→1 d, 1→6 d, n≥2→round(prev×ease) |
| Min ease factor | 1.3 (SM-2 standard) |
| Sync mechanism | Local-first; push/pull delta sync against a per-table server revision cursor, not real-time |
| Sync conflict resolution | Content = last-writer-wins by `updatedAt`; scheduling = independent, keyed on `lastReviewedAt`; history = append-only union merge |
| Auth | Email/password, JWT access token (15 min) + rotating refresh token (30 days) |
