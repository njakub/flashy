import type { Card } from "@/lib/types";

/**
 * A card IS a concept card exactly when it has key points — no persisted
 * discriminator, same convention as hasCodeFence() in markdown.ts.
 */
export function isConceptCard(card: Pick<Card, "keyPoints">): boolean {
  return (card.keyPoints?.length ?? 0) > 0;
}
