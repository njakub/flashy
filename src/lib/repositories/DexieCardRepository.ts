import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import type { Card } from "@/lib/types";
import { DEFAULT_SCHEDULING_STATE } from "@/lib/scheduler";
import type { CardRepository } from "./interfaces";

export class DexieCardRepository implements CardRepository {
  async getByDeck(deckId: string): Promise<Card[]> {
    return db.cards.where("deckId").equals(deckId).toArray();
  }

  async getDueCards(deckId: string | null, now: Date): Promise<Card[]> {
    const nowIso = now.toISOString();
    const all =
      deckId !== null
        ? await db.cards.where("deckId").equals(deckId).toArray()
        : await db.cards.toArray();
    return all.filter((c) => c.scheduling.dueAt <= nowIso);
  }

  async getById(id: string): Promise<Card | undefined> {
    return db.cards.get(id);
  }

  async create(
    card: Omit<Card, "id" | "createdAt" | "updatedAt">,
  ): Promise<Card> {
    const now = new Date().toISOString();
    const newCard: Card = {
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      ...card,
      scheduling: card.scheduling ?? DEFAULT_SCHEDULING_STATE(),
    };
    await db.cards.add(newCard);
    return newCard;
  }

  async update(
    id: string,
    patch: Partial<Pick<Card, "front" | "back" | "scheduling">>,
  ): Promise<Card> {
    const updatedAt = new Date().toISOString();
    await db.cards.update(id, { ...patch, updatedAt });
    const updated = await db.cards.get(id);
    if (!updated) throw new Error(`Card ${id} not found`);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await db.cards.delete(id);
  }

  async deleteByDeck(deckId: string): Promise<void> {
    await db.cards.where("deckId").equals(deckId).delete();
  }
}
