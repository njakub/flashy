import type { DeckRepository } from "@/lib/repositories/interfaces";
import { subtreeIds } from "./tree";

/**
 * Ids of `deckId` and all its descendant decks — what Study/Test on a
 * parent deck draw cards from. Falls back to just `deckId` if the deck
 * can't be found (e.g. deleted mid-navigation).
 */
export async function loadDeckSubtreeIds(
  decks: DeckRepository,
  deckId: string,
): Promise<string[]> {
  const deck = await decks.getById(deckId);
  if (!deck) return [deckId];
  const ids = subtreeIds(await decks.getAll(deck.ownerId), deckId);
  return ids.length > 0 ? ids : [deckId];
}
