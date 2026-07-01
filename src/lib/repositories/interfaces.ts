import type {
  Card,
  CardStats,
  Deck,
  TestRun,
  TestRunQuestion,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// DeckRepository — seam for Phase 2 sync / remote backend
// ---------------------------------------------------------------------------

/**
 * All deck persistence goes through this interface.
 * Phase 2: swap DexieDeckRepository for a hybrid local+remote implementation
 * without touching any component or page.
 */
export interface DeckRepository {
  getAll(ownerId: string): Promise<Deck[]>;
  getById(id: string): Promise<Deck | undefined>;
  create(deck: Omit<Deck, "id" | "createdAt" | "updatedAt">): Promise<Deck>;
  update(id: string, patch: Partial<Pick<Deck, "name">>): Promise<Deck>;
  /** Deleting a deck also deletes all its cards and test history (cascade). */
  delete(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// CardRepository — seam for Phase 2 sync / remote backend
// ---------------------------------------------------------------------------

/**
 * All card persistence goes through this interface.
 * Phase 2: swap DexieCardRepository for a hybrid local+remote implementation.
 */
export interface CardRepository {
  getByDeck(deckId: string): Promise<Card[]>;
  getDueCards(deckId: string | null, now: Date): Promise<Card[]>;
  getById(id: string): Promise<Card | undefined>;
  create(card: Omit<Card, "id" | "createdAt" | "updatedAt">): Promise<Card>;
  update(
    id: string,
    patch: Partial<
      Pick<
        Card,
        "front" | "back" | "alternateAnswers" | "labels" | "scheduling"
      >
    >,
  ): Promise<Card>;
  delete(id: string): Promise<void>;
  deleteByDeck(deckId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// TestRunRepository — persists test history
// ---------------------------------------------------------------------------

export interface TestRunRepository {
  /** Persist a completed run and all its question attempts atomically. */
  saveRun(
    run: Omit<TestRun, "id">,
    questions: Omit<TestRunQuestion, "id" | "runId">[],
  ): Promise<TestRun>;

  /** All runs for a deck, newest first. */
  getRunsByDeck(deckId: string): Promise<TestRun[]>;

  /** All question attempts for a single run. */
  getQuestionsForRun(runId: string): Promise<TestRunQuestion[]>;

  /**
   * Per-card stats for a set of card ids — one grouped query, not N queries.
   * O(history size for those cards).
   */
  getStatsByCards(cardIds: string[]): Promise<CardStats[]>;

  /** Delete all history for a deck (called when the deck is deleted). */
  deleteByDeck(deckId: string): Promise<void>;
}
