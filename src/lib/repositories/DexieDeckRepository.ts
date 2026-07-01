import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import type { Deck } from "@/lib/types";
import type { DeckRepository } from "./interfaces";
import { DexieCardRepository } from "./DexieCardRepository";
import { DexieTestRunRepository } from "./DexieTestRunRepository";

export class DexieDeckRepository implements DeckRepository {
  private cardRepo = new DexieCardRepository();
  private testRunRepo = new DexieTestRunRepository();

  async getAll(ownerId: string): Promise<Deck[]> {
    return db.decks.where("ownerId").equals(ownerId).toArray();
  }

  async getById(id: string): Promise<Deck | undefined> {
    return db.decks.get(id);
  }

  async create(
    deck: Omit<Deck, "id" | "createdAt" | "updatedAt">,
  ): Promise<Deck> {
    const now = new Date().toISOString();
    const newDeck: Deck = {
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      ...deck,
    };
    await db.decks.add(newDeck);
    return newDeck;
  }

  async update(id: string, patch: Partial<Pick<Deck, "name">>): Promise<Deck> {
    const updatedAt = new Date().toISOString();
    await db.decks.update(id, { ...patch, updatedAt });
    const updated = await db.decks.get(id);
    if (!updated) throw new Error(`Deck ${id} not found`);
    return updated;
  }

  /** Cascade: deletes cards, test history, then the deck. */
  async delete(id: string): Promise<void> {
    await db.transaction(
      "rw",
      [db.decks, db.cards, db.testRuns, db.testRunQuestions],
      async () => {
        await this.cardRepo.deleteByDeck(id);
        await this.testRunRepo.deleteByDeck(id);
        await db.decks.delete(id);
      },
    );
  }
}
