import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import type { StoredDeck } from "@/lib/db";
import type { Deck } from "@/lib/types";
import { notifyDirty } from "@/lib/sync/dirtyBus";
import { subtreeIds, wouldCreateCycle } from "@/lib/decks/tree";
import type { DeckRepository } from "./interfaces";
import { DexieCardRepository } from "./DexieCardRepository";
import { DexieTestRunRepository } from "./DexieTestRunRepository";

const notDeleted = (d: StoredDeck) => d.deletedAt === null;
/** Rows written before deck nesting have no parentId property at all. */
const normalise = (d: StoredDeck): StoredDeck => ({
  ...d,
  parentId: d.parentId ?? null,
});

export class DexieDeckRepository implements DeckRepository {
  private cardRepo = new DexieCardRepository();
  private testRunRepo = new DexieTestRunRepository();

  async getAll(ownerId: string): Promise<Deck[]> {
    const rows = await db.decks.where("ownerId").equals(ownerId).toArray();
    return rows.filter(notDeleted).map(normalise);
  }

  async getById(id: string): Promise<Deck | undefined> {
    const row = await db.decks.get(id);
    return row && notDeleted(row) ? normalise(row) : undefined;
  }

  async create(
    deck: Omit<Deck, "id" | "createdAt" | "updatedAt">,
  ): Promise<Deck> {
    const now = new Date().toISOString();
    const newDeck: StoredDeck = {
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      ...deck,
      deletedAt: null,
      dirty: 1,
    };
    await db.decks.add(newDeck);
    notifyDirty();
    return newDeck;
  }

  async update(
    id: string,
    patch: Partial<Pick<Deck, "name" | "parentId">>,
  ): Promise<Deck> {
    if (patch.parentId !== undefined) {
      const deck = await this.getById(id);
      if (!deck) throw new Error(`Deck ${id} not found`);
      const all = await this.getAll(deck.ownerId);
      if (patch.parentId !== null && !all.some((d) => d.id === patch.parentId)) {
        throw new Error(`Parent deck ${patch.parentId} not found`);
      }
      if (wouldCreateCycle(all, id, patch.parentId)) {
        throw new Error(
          "Cannot move a deck into itself or one of its sub-decks",
        );
      }
    }
    const updatedAt = new Date().toISOString();
    await db.decks.update(id, { ...patch, updatedAt, dirty: 1 });
    const updated = await db.decks.get(id);
    if (!updated) throw new Error(`Deck ${id} not found`);
    notifyDirty();
    return normalise(updated);
  }

  /**
   * Soft-delete cascade: tombstones the deck and every descendant deck,
   * plus all their cards and test history locally, so every tombstone is pushed to the server on next
   * sync (the server also cascades defensively — see flashy-api
   * SyncService.cascadeDeleteDeck — but the client cascades too so a
   * device that's offline for a while still converges correctly).
   */
  async delete(id: string): Promise<void> {
    const deck = await this.getById(id);
    if (!deck) return;
    // Server doesn't cascade to child decks — the client tombstones the
    // whole subtree so each tombstone syncs (and triggers the server's
    // per-deck card/run cascade).
    const ids = subtreeIds(await this.getAll(deck.ownerId), id);
    const deletedAt = new Date().toISOString();
    await db.transaction(
      "rw",
      [db.decks, db.cards, db.testRuns, db.testRunQuestions],
      async () => {
        for (const deckId of ids) {
          await this.cardRepo.deleteByDeck(deckId);
          await this.testRunRepo.deleteByDeck(deckId);
          await db.decks.update(deckId, { deletedAt, dirty: 1 });
        }
      },
    );
    notifyDirty();
  }
}
