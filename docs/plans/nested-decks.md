# Nested decks (deck hierarchy)

Implementation-ready spec. Assumes no prior context — read the "Decisions" section first, then implement in the rollout order at the bottom (API → web → mobile).

## Goal

Today decks are a flat list. Add a hierarchy so the user can organise interview-prep material like:

```
Frontend                 (12 due)
├─ JS Fundamentals       (5 due)
├─ React                 (7 due)
│  └─ Hooks              (3 due)
└─ Performance
System Design
LeetCode
```

## Decisions (already made — do not re-litigate)

| Topic | Decision |
|---|---|
| Model | **Nested decks.** Any deck may contain sub-decks *and* its own cards (Anki-style). No separate "folder" entity. Implemented as a nullable `parentId` on `Deck`. Arbitrary depth. |
| Study/Test a parent | Includes **its own cards plus all descendants'** cards. A leaf deck behaves exactly as today. |
| Scope | Web (`flashy`), API (`flashy-api`), mobile (`flashy-mobile`) — full feature in all three. |
| Seeding | **None.** No pre-built category tree; the user creates decks. |
| Deleting a parent | Cascades to the **whole subtree** (every descendant deck + their cards + test history), behind a confirmation that states the counts. |
| Card ownership | A card still belongs to exactly one deck (`Card.deckId`). No multi-parent / tags. |
| Server FK on `parentId` | **None** (plain nullable string + index). Sync pushes decks in arbitrary order and a child may reference a parent the server hasn't seen yet. |
| Cycles / orphans | Server does **not** validate tree shape. Clients prevent cycles on local moves and render defensively (see "Tree invariants"). |

## Data model

`Deck` (public domain type, in `flashy/src/lib/types.ts` and `flashy-mobile/src/lib/types.ts`):

```ts
export interface Deck {
  id: string;
  ownerId: string;
  name: string;
  /** null = top-level deck. Points at another Deck.id of the same owner. */
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

`parentId` is **content** — it's reconciled with the rest of the deck row by last-writer-wins on `updatedAt`, exactly like `name`. Moving a deck = updating `parentId` + bumping `updatedAt`.

### Tree invariants (enforced by clients, tolerated when violated)

Sync is LWW per deck row, so concurrent edits on two devices can produce states no single client would create. The tree builder must handle all of these without crashing or hiding data:

1. **Orphan** — `parentId` points at a deck that doesn't exist locally or is tombstoned (e.g. device A deleted "Frontend" while offline device B created "Frontend/Hooks"). → Render the orphan as a **top-level** deck. Don't rewrite its `parentId` (no write on read).
2. **Cycle** — e.g. device A moves X under Y, device B moves Y under X, both win LWW on their own row. → When building the tree, detect the cycle and break it by treating the deck(s) in the cycle with the **smallest `id`** as top-level. Deterministic so all devices render the same tree.
3. **Cross-owner parent** — server nulls these on push (see API section); clients treat as orphan if one ever appears.
4. **Self-parent** (`parentId === id`) — treat as top-level.

Local moves must be rejected (repository throws) when the target is the deck itself or any of its descendants.

## Shared tree helpers (new, pure, unit-tested)

Create `flashy/src/lib/decks/tree.ts` and an identical copy at `flashy-mobile/src/lib/decks/tree.ts` (hand-mirrored, like `wire.ts` — note this in both CLAUDE.md files). No Dexie/SQLite imports; operate on `Deck[]`.

```ts
export interface DeckNode {
  deck: Deck;
  children: DeckNode[];   // sorted by name, case-insensitive (localeCompare, sensitivity "base")
  depth: number;          // 0 for roots
}

/** Builds the forest, applying the orphan/cycle/self-parent rules above. Roots sorted by name. */
export function buildDeckTree(decks: Deck[]): DeckNode[];

/** Effective parent after applying invariants (null if treated as root). */
export function effectiveParentId(decks: Deck[], id: string): string | null;

/** id plus every descendant id (using effective parents). Order: pre-order. */
export function subtreeIds(decks: Deck[], id: string): string[];

/** Ancestors from root down to (excluding) id — for breadcrumbs. */
export function ancestors(decks: Deck[], id: string): Deck[];

/** True if setting deck `id`'s parent to `newParentId` would create a cycle (includes newParentId === id). null is always valid. */
export function wouldCreateCycle(decks: Deck[], id: string, newParentId: string | null): boolean;
```

Implement `buildDeckTree` by computing effective parents first (walk up from each deck with a visited set; on revisiting, a cycle is found — mark the smallest id in the cycle as root; on missing parent, root), then grouping. O(n·depth) is fine — deck counts are small.

Tests (`tree.test.ts`, vitest on web / jest on mobile): flat list; 3-level nesting; orphan → root; 2-cycle and 3-cycle → smallest id becomes root, others hang beneath it; self-parent; `subtreeIds` on leaf/root; `wouldCreateCycle` for self, child, grandchild, unrelated, null; sort order.

## API — `flashy-api`

1. **Prisma** (`prisma/schema.prisma`, `model Deck`): add `parentId String?` and `@@index([parentId])`. No `@relation`. Create migration `npx prisma migrate dev --name add_deck_parent_id`. Existing rows get `NULL` = top-level — no backfill.
2. **Push schema** (`src/sync/sync.schema.ts`, `pushDeckSchema`): add `parentId: z.string().min(1).nullable().optional()`. Comment it like `keyPoints`: *absent = old client that doesn't know the field → leave unchanged; `null` = explicitly top-level.*
3. **Wire type** (`src/sync/sync.types.ts`, `WireDeck`): add `parentId: string | null` (always sent on pull).
4. **`SyncService.applyDeck`** (`src/sync/sync.service.ts`):
   - Resolve the incoming parent: if `d.parentId` is a string, look it up; if it exists **and** belongs to a different owner, or equals `d.id`, coerce to `null`. If it doesn't exist (yet), keep it — it may arrive later in this or a future push.
   - **Create:** `parentId: resolved ?? null`.
   - **Update** (only when incoming `updatedAt` wins, as today): include `parentId` in `data` **only if `d.parentId !== undefined`**.
   - Do **not** cascade deletes to child decks server-side. Clients tombstone the whole subtree themselves; each tombstoned deck already triggers the existing per-deck `cascadeDeleteDeck` (cards + test runs). An offline-created child of a deleted parent simply becomes an orphan (rendered top-level) — non-destructive by design.
5. **`toWireDeck`**: add `parentId: d.parentId`.
6. **Tests**: extend `src/sync/sync.schema.spec.ts` — push deck with `parentId` string / `null` / absent all parse; empty string rejected. If there's a service spec harness, add: create with parent, update with absent parentId keeps existing value, cross-owner parent coerced to null, self-parent coerced to null.
7. Update `flashy-api/CLAUDE.md` sync section to mention `Deck.parentId` (content field, LWW, absent-means-unchanged, no FK, no server-side subtree cascade).

## Web — `flashy`

### Wire + sync
- `src/lib/sync/wire.ts`: `WireDeck` add `parentId?: string | null` (optional in the client mirror so a not-yet-deployed server's pull — which omits it — still type-checks; same pattern as `WireCard.keyPoints`).
- `src/lib/sync/SyncEngine.ts`:
  - `toWireDeckPush`: always send `parentId: d.parentId ?? null`.
  - `applyDeck`: `parentId: wire.parentId !== undefined ? wire.parentId : (local?.parentId ?? null)` — never wipe a local parent because an old server omitted the field.
  - Extend `src/lib/sync/SyncEngine.test.ts` for both cases.

### Storage
- `src/lib/db/index.ts`: **no Dexie version bump** — `parentId` is not indexed (the whole tree is built in memory from `getAll(ownerId)`), and per the existing comment in that file, non-indexed fields need no `.version()`. Existing rows simply lack the property; normalise on read (below). Add a line to the version-history comment noting this.
- `src/lib/repositories/interfaces.ts`:
  - `DeckRepository.create(deck: Omit<Deck, "id" | "createdAt" | "updatedAt">)` — now includes `parentId` (callers pass `null` for top-level).
  - `DeckRepository.update(id, patch: Partial<Pick<Deck, "name" | "parentId">>)` — throws `Error("Cannot move a deck into itself or one of its sub-decks")` if `wouldCreateCycle`; throws if the new parent doesn't exist / is deleted.
  - `DeckRepository.delete(id)` — doc comment: cascades to the whole subtree.
  - `CardRepository`: add `getByDecks(deckIds: string[]): Promise<Card[]>` and `getDueCardsInDecks(deckIds: string[], now: Date): Promise<Card[]>`. Keep `getByDeck`/`getDueCards` unchanged (still used for a deck's *own* cards).
- `src/lib/repositories/DexieDeckRepository.ts`:
  - Normalise every returned row with `parentId: row.parentId ?? null` (old rows have no property).
  - `create` / `update` as above; `update` loads `getAll(ownerId)` to run `wouldCreateCycle`.
  - `delete(id)`: compute `subtreeIds(allDecks, id)` and, inside the existing single transaction, run the current per-deck cascade (`cardRepo.deleteByDeck`, `testRunRepo.deleteByDeck`, tombstone deck) for **every** id in the subtree. One `notifyDirty()` at the end.
- `src/lib/repositories/DexieCardRepository.ts`: implement the two new methods with `db.cards.where("deckId").anyOf(deckIds)`; due filter mirrors `getDueCards`.

### UI
- **`DeckList.tsx` (`/`)**: render `buildDeckTree` as an indented, collapsible tree. Each row: name, due count **rolled up** (own + descendants), total card count rolled up. Collapse state per deck in `localStorage` (`flashy_deck_collapsed`, wrapped in try/catch; default: expanded). "New deck" still creates a top-level deck. Keep `useReloadOnSync(load)`.
- **`DeckDetail.tsx` (`/decks/[deckId]`)**:
  - Breadcrumb from `ancestors()` (each crumb links to that deck), above the title.
  - **Sub-decks** section above the cards list: child decks with rolled-up due/total counts, plus an **"Add sub-deck"** inline form → `decks.create({ name, ownerId, parentId: deck.id })`.
  - **"Move to…"** control next to rename: a `<select>` of "Top level" + every deck **except** `subtreeIds(deck.id)`, shown with indentation by depth. Calls `decks.update(id, { parentId })`.
  - Cards list, add/edit card, import/export JSON, Generate: unchanged — operate on the deck's **own** cards only.
  - Header counts: "N cards · M due" for own cards, plus "(X cards · Y due including sub-decks)" when the deck has descendants.
  - Study / Test buttons: enabled if the **subtree** has cards (due cards for Study).
  - Delete confirmation: when the deck has descendants, the dialog must say e.g. *"Delete 'Frontend', its 6 sub-decks, 143 cards and all their test history?"*.
- **`StudySession.tsx`**: load `subtreeIds(allDecks, deckId)` once at session start, then `cards.getDueCardsInDecks(ids, now)` (and `getByDecks` wherever it currently uses `getByDeck`). Still loads once per session — **do not** add `useReloadOnSync` (see CLAUDE.md for why).
- **`TestSession.tsx`**: same subtree loading. The resulting `TestRun.deckId` is the deck the test was started from (the parent). `TestRunQuestion` rows still reference real `cardId`s, so per-card stats keep working unchanged.
- **`TestHistory.tsx` / `TestRunDetail.tsx`**: show runs whose `deckId` is this deck (runs started from here) — unchanged behaviour. In `TestRunDetail`, resolve question cards with `getByDecks(subtreeIds(...))` instead of `getByDeck` so a parent's run can find descendant cards for edit links; snapshots already cover deleted cards.
- **`StatsPanel.tsx`**: uses `getDueCards(null, …)` (all decks) — unchanged.
- Update `flashy/CLAUDE.md`: data model (`Deck.parentId`), routes section (sub-decks, move, subtree study/test), the hand-mirrored `src/lib/decks/tree.ts`, and the subtree delete cascade.

## Mobile — `flashy-mobile`

Mirror the web changes; file names differ:

- `src/lib/types.ts`: `Deck.parentId: string | null`.
- `src/lib/db/schema.ts`: add `MIGRATION_2`:
  ```sql
  ALTER TABLE decks ADD COLUMN parentId TEXT;
  CREATE INDEX decks_parent ON decks(parentId);
  ```
  Append to `MIGRATIONS`. Existing rows → `NULL` (top-level), **not** marked dirty (server already has them as `NULL`).
- `src/lib/db/rows.ts`: `DeckRow.parentId: string | null`; `rowToDeck` maps it.
- `src/lib/sync/wire.ts`: `WireDeck.parentId?: string | null` (optional, same rollout reasoning as web).
- `src/lib/sync/merge.ts` `mergeDeck`: `parentId: wire.parentId !== undefined ? wire.parentId : (local?.parentId ?? null)`. Extend `merge.test.ts`.
- `src/lib/sync/SyncEngine.ts`: push includes `parentId`; the SQL that writes merged decks includes the column.
- `src/lib/decks/tree.ts` + `tree.test.ts`: copy of the web file.
- `src/lib/repositories/interfaces.ts`, `SqliteDeckRepository.ts`, `SqliteCardRepository.ts`: same API changes as web (`create`/`update` with `parentId` + cycle check, subtree-cascading `delete` in the existing `withExclusiveTransactionAsync`, `getByDecks` / `getDueCardsInDecks` using `WHERE deckId IN (…)` with bound placeholders).
- Screens: `DeckList.tsx` (indented collapsible tree, rolled-up counts; persist collapse state in the same storage the app already uses for prefs, or keep it in memory if none), `DeckDetail.tsx` (breadcrumb, sub-decks list + add sub-deck, move-to picker excluding the subtree, subtree-aware delete confirm via `InlineConfirm`), `StudySession.tsx` / `TestSession.tsx` (subtree loading, once per session), `TestRunDetail.tsx` (subtree card lookup).
- Update `flashy-mobile/CLAUDE.md`/`AGENTS.md` where the data model and mirrored files are listed.
- Ships as a **JS-only change** (no native modules) → can go out via `npx eas-cli update --channel <preview|production> --environment <same>`. Always pass `--environment`, otherwise the update is built from the local `.env`, which has no `EXPO_PUBLIC_API_URL`, and the release build crashes at startup.

## Rollout order (important)

1. **API first.** Deploy the migration + schema. Old web/mobile clients keep working: they never send `parentId` (absent → unchanged) and ignore it on pull.
2. **Web.** Push to `main` → Vercel deploys.
3. **Mobile.** EAS update (see above).

Between steps 1 and 3, an old mobile client may rename a deck that has a parent; its push omits `parentId`, which the server leaves unchanged — the hierarchy survives. The client-side `wire.parentId !== undefined` guard covers the reverse case (new client, old server).

## Verification

- `flashy-api`: `npm test`; `npx prisma migrate dev` applies cleanly on a DB with existing decks.
- `flashy`: `npm test`, `npm run lint`, `npx tsc --noEmit`. Manual with `npm run dev` + local API:
  1. Create Frontend → JS Fundamentals, React → Hooks. Tree renders, collapse persists across reload.
  2. Add cards to Hooks and Frontend itself. Frontend's rolled-up counts include Hooks; Study on Frontend shows cards from both; Study on Hooks shows only Hooks.
  3. Move React to top level and back. Move Frontend into Hooks → rejected with the error message (option shouldn't even be offered).
  4. Test on Frontend → history entry under Frontend; run detail resolves descendant cards.
  5. Delete Frontend → confirmation shows sub-deck/card counts; everything in the subtree disappears.
  6. Two browsers (or browser + phone) signed in to the same account: create/move/delete on one, confirm the other converges after sync.
  7. Orphan: on device A delete a parent while device B (offline) adds a sub-deck under it; after both sync, the new sub-deck shows as top-level on both.
- `flashy-mobile`: `npm test`, `npx tsc --noEmit`, lint; repeat the manual checks 1–6 on a device/emulator; confirm a pre-existing install migrates (decks still listed, all top-level).
