import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import type { StoredCard } from "@/lib/db";
import type { Card } from "@/lib/types";
import { DEFAULT_SCHEDULING_STATE } from "@/lib/scheduler";
import { notifyDirty } from "@/lib/sync/dirtyBus";
import type { CardRepository } from "./interfaces";

/**
 * Stored rows carry sync bookkeeping (deletedAt, dirty) beyond the public
 * Card type — returned as-is (typed as Card) rather than stripped, since no
 * caller enumerates keys and the extra fields are harmless to hold.
 * Every read filters out soft-deleted rows so a delete looks the same to
 * callers whether it's been synced away or is still a local tombstone.
 */
const notDeleted = (c: StoredCard) => c.deletedAt === null;

export class DexieCardRepository implements CardRepository {
  async getByDeck(deckId: string): Promise<Card[]> {
    const rows = await db.cards.where("deckId").equals(deckId).toArray();
    return rows.filter(notDeleted);
  }

  async getDueCards(deckId: string | null, now: Date): Promise<Card[]> {
    const nowIso = now.toISOString();
    const all =
      deckId !== null
        ? await db.cards.where("deckId").equals(deckId).toArray()
        : await db.cards.toArray();
    return all.filter((c) => notDeleted(c) && c.scheduling.dueAt <= nowIso);
  }

  async getById(id: string): Promise<Card | undefined> {
    const row = await db.cards.get(id);
    return row && notDeleted(row) ? row : undefined;
  }

  async create(
    card: Omit<Card, "id" | "createdAt" | "updatedAt">,
  ): Promise<Card> {
    const now = new Date().toISOString();
    const newCard: StoredCard = {
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      ...card,
      scheduling: card.scheduling ?? DEFAULT_SCHEDULING_STATE(),
      deletedAt: null,
      dirty: 1,
    };
    await db.cards.add(newCard);
    notifyDirty();
    return newCard;
  }

  async update(
    id: string,
    patch: Partial<
      Pick<
        Card,
        | "front"
        | "back"
        | "alternateAnswers"
        | "answerJustifications"
        | "labels"
        | "scheduling"
      >
    >,
  ): Promise<Card> {
    const updatedAt = new Date().toISOString();
    await db.cards.update(id, { ...patch, updatedAt, dirty: 1 });
    const updated = await db.cards.get(id);
    if (!updated) throw new Error(`Card ${id} not found`);
    notifyDirty();
    return updated;
  }

  /** Soft delete: tombstoned locally, pushed to the server on next sync. */
  async delete(id: string): Promise<void> {
    await db.cards.update(id, {
      deletedAt: new Date().toISOString(),
      dirty: 1,
    });
    notifyDirty();
  }

  async deleteByDeck(deckId: string): Promise<void> {
    const deletedAt = new Date().toISOString();
    await db.cards
      .where("deckId")
      .equals(deckId)
      .modify({ deletedAt, dirty: 1 });
    notifyDirty();
  }
}
