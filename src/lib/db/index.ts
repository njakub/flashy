import Dexie, { type Table } from "dexie";
import type { Card, Deck } from "@/lib/types";

/**
 * FlashyDB — the single Dexie database instance.
 *
 * Indexes:
 *   cards  — by deckId (card list) and by dueAt (due-card queries).
 *   decks  — by ownerId (future multi-user queries).
 *
 * Phase 2: Add a sync-metadata table here; repositories stay the same.
 */
class FlashyDB extends Dexie {
  cards!: Table<Card, string>;
  decks!: Table<Deck, string>;

  constructor() {
    super("flashy-db");

    this.version(1).stores({
      // Primary key is id; additional indexes follow
      cards: "id, deckId, [deckId+scheduling.dueAt], ownerId",
      decks: "id, ownerId",
    });
  }
}

// Singleton — safe because this module is only ever imported in client code.
export const db = new FlashyDB();
