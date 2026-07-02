import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import type { StoredDeck } from "@/lib/db";
import type { Deck } from "@/lib/types";
import { notifyDirty } from "@/lib/sync/dirtyBus";
import type { DeckRepository } from "./interfaces";
import { DexieCardRepository } from "./DexieCardRepository";
import { DexieTestRunRepository } from "./DexieTestRunRepository";

const notDeleted = (d: StoredDeck) => d.deletedAt === null;

export class DexieDeckRepository implements DeckRepository {
  private cardRepo = new DexieCardRepository();
  private testRunRepo = new DexieTestRunRepository();

  async getAll(ownerId: string): Promise<Deck[]> {
    const rows = await db.decks.where("ownerId").equals(ownerId).toArray();
    return rows.filter(notDeleted);
  }

  async getById(id: string): Promise<Deck | undefined> {
    const row = await db.decks.get(id);
    return row && notDeleted(row) ? row : undefined;
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

  async update(id: string, patch: Partial<Pick<Deck, "name">>): Promise<Deck> {
    const updatedAt = new Date().toISOString();
    await db.decks.update(id, { ...patch, updatedAt, dirty: 1 });
    const updated = await db.decks.get(id);
    if (!updated) throw new Error(`Deck ${id} not found`);
    notifyDirty();
    return updated;
  }

  /**
   * Soft-delete cascade: tombstones the deck plus its cards and test
   * history locally, so every tombstone is pushed to the server on next
   * sync (the server also cascades defensively — see flashy-api
   * SyncService.cascadeDeleteDeck — but the client cascades too so a
   * device that's offline for a while still converges correctly).
   */
  async delete(id: string): Promise<void> {
    await db.transaction(
      "rw",
      [db.decks, db.cards, db.testRuns, db.testRunQuestions],
      async () => {
        await this.cardRepo.deleteByDeck(id);
        await this.testRunRepo.deleteByDeck(id);
        await db.decks.update(id, {
          deletedAt: new Date().toISOString(),
          dirty: 1,
        });
      },
    );
    notifyDirty();
  }
}
