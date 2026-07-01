import Dexie, { type Table } from "dexie";
import type { Card, Deck, TestRun, TestRunQuestion } from "@/lib/types";

/**
 * FlashyDB — the single Dexie database instance.
 *
 * Version history:
 *   v1 — cards, decks
 *   v2 — adds alternateAnswers + labels to cards (upgrade hook);
 *         adds testRuns + testRunQuestions tables
 *
 * Phase 2: Add a sync-metadata table here; repositories stay the same.
 */
class FlashyDB extends Dexie {
  cards!: Table<Card, string>;
  decks!: Table<Deck, string>;
  testRuns!: Table<TestRun, string>;
  testRunQuestions!: Table<TestRunQuestion, string>;

  constructor() {
    super("flashy-db");

    this.version(1).stores({
      cards: "id, deckId, [deckId+scheduling.dueAt], ownerId",
      decks: "id, ownerId",
    });

    this.version(2)
      .stores({
        cards: "id, deckId, [deckId+scheduling.dueAt], ownerId",
        decks: "id, ownerId",
        testRuns: "id, deckId, ownerId, startedAt",
        // cardId index enables O(1) per-card stat queries
        testRunQuestions: "id, runId, cardId",
      })
      .upgrade((tx) => {
        // Back-fill new fields on all existing cards so no card is ever missing
        // alternateAnswers or labels.
        return tx
          .table("cards")
          .toCollection()
          .modify((card) => {
            if (!Array.isArray(card.alternateAnswers))
              card.alternateAnswers = [];
            if (!Array.isArray(card.labels)) card.labels = [];
          });
      });
  }
}

// Singleton — safe because this module is only ever imported in client code.
export const db = new FlashyDB();
