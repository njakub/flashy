import type { Card, Deck } from "@/lib/types";

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
  /** Deleting a deck also deletes all its cards (cascade). */
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
    patch: Partial<Pick<Card, "front" | "back" | "scheduling">>,
  ): Promise<Card>;
  delete(id: string): Promise<void>;
  deleteByDeck(deckId: string): Promise<void>;
}
