import Dexie, { type Table } from "dexie";
import type { Card, Deck, TestRun, TestRunQuestion } from "@/lib/types";

/**
 * Sync bookkeeping bolted onto the stored row shape, kept OUT of the public
 * domain types in src/lib/types.ts — components and the repository
 * interfaces never see these fields. Only the Dexie*Repository
 * implementations and SyncEngine (a sibling that shares this store) read or
 * write them directly.
 *
 * deletedAt: soft-delete tombstone. Repositories filter deletedAt-set rows
 *   out of every read, so a soft delete looks identical to a hard delete to
 *   the rest of the app — but the tombstone can be pushed to the server and
 *   pulled by other devices instead of vanishing untraceably.
 * dirty: set on every local create/update/delete; cleared by SyncEngine once
 *   the server has acknowledged the row (win or lose any conflict — see
 *   flashy-api's SyncService.pullSince).
 */
interface SyncMeta {
  deletedAt: string | null;
  dirty: 0 | 1;
}

export type StoredDeck = Deck & SyncMeta;
export type StoredCard = Card & SyncMeta;
export type StoredTestRun = TestRun & SyncMeta;
/** Immutable — no deletedAt of its own; only ever removed via a TestRun cascade. */
export type StoredTestRunQuestion = TestRunQuestion & { dirty: 0 | 1 };

/** Single-row table holding the per-table server revision cursor for sync. */
export interface SyncCursorRow {
  id: "cursor";
  decks: string;
  cards: string;
  testRuns: string;
  testRunQuestions: string;
}

export function defaultSyncCursor(): Omit<SyncCursorRow, "id"> {
  return { decks: "0", cards: "0", testRuns: "0", testRunQuestions: "0" };
}

/**
 * FlashyDB — the single Dexie database instance.
 *
 * Version history:
 *   v1 — cards, decks
 *   v2 — adds alternateAnswers + labels to cards (upgrade hook);
 *         adds testRuns + testRunQuestions tables
 *   v3 — sync: adds deletedAt (tombstone) + dirty to cards/decks/testRuns,
 *         dirty to testRunQuestions, adds lastReviewedAt to Card.scheduling,
 *         adds the syncState cursor table. Repositories stay the same
 *         (CardRepository/DeckRepository/TestRunRepository are unchanged);
 *         only the Dexie implementations and SyncEngine read the new fields.
 */
class FlashyDB extends Dexie {
  cards!: Table<StoredCard, string>;
  decks!: Table<StoredDeck, string>;
  testRuns!: Table<StoredTestRun, string>;
  testRunQuestions!: Table<StoredTestRunQuestion, string>;
  syncState!: Table<SyncCursorRow, string>;

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

    this.version(3)
      .stores({
        cards: "id, deckId, [deckId+scheduling.dueAt], ownerId, dirty",
        decks: "id, ownerId, dirty",
        testRuns: "id, deckId, ownerId, startedAt, dirty",
        testRunQuestions: "id, runId, cardId, dirty",
        syncState: "id",
      })
      .upgrade(async (tx) => {
        // Every pre-existing local row is new to the server, so it starts
        // dirty (needs push) and not deleted.
        await tx
          .table("cards")
          .toCollection()
          .modify((card) => {
            card.deletedAt = null;
            card.dirty = 1;
            if (!card.scheduling.lastReviewedAt) {
              card.scheduling.lastReviewedAt = null;
            }
          });
        await tx
          .table("decks")
          .toCollection()
          .modify((deck) => {
            deck.deletedAt = null;
            deck.dirty = 1;
          });
        await tx
          .table("testRuns")
          .toCollection()
          .modify((run) => {
            run.deletedAt = null;
            run.dirty = 1;
          });
        await tx
          .table("testRunQuestions")
          .toCollection()
          .modify((q) => {
            q.dirty = 1;
          });
      });
  }
}

// Singleton — safe because this module is only ever imported in client code.
export const db = new FlashyDB();
