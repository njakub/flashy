import type { Deck } from "@/lib/types";

/**
 * Pure deck-hierarchy helpers over a flat Deck[] (Deck.parentId).
 *
 * Hand-mirrored at flashy-mobile/src/lib/decks/tree.ts — keep the two
 * identical (like sync/wire.ts).
 *
 * Sync reconciles parentId per deck row (last-writer-wins), so concurrent
 * edits on two devices can produce shapes no single client would create.
 * Every helper here resolves an *effective* parent that tolerates them,
 * without ever writing anything back:
 *   - orphan (parent missing / deleted / not in the list) -> root
 *   - self-parent -> root
 *   - cycle -> the deck with the smallest id in the cycle becomes a root
 *     (deterministic, so every device renders the same tree)
 */

export interface DeckNode {
  deck: Deck;
  children: DeckNode[];
  /** 0 for roots. */
  depth: number;
}

const byName = (a: Deck, b: Deck) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** Map of deck id -> effective parent id (null = root). */
function effectiveParents(decks: Deck[]): Map<string, string | null> {
  const byId = new Map(decks.map((d) => [d.id, d]));
  const declared = (id: string): string | null => {
    const p = byId.get(id)?.parentId ?? null;
    return p !== null && p !== id && byId.has(p) ? p : null;
  };

  // Cycle roots: walk up from every deck; a revisit within one walk means
  // a cycle, broken at its smallest id.
  const cycleRoots = new Set<string>();
  for (const d of decks) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: string | null = d.id;
    while (cur !== null && !cycleRoots.has(cur)) {
      if (onPath.has(cur)) {
        const cycle = path.slice(path.indexOf(cur));
        cycleRoots.add(cycle.reduce((min, id) => (id < min ? id : min)));
        break;
      }
      onPath.add(cur);
      path.push(cur);
      cur = declared(cur);
    }
  }

  const result = new Map<string, string | null>();
  for (const d of decks) {
    result.set(d.id, cycleRoots.has(d.id) ? null : declared(d.id));
  }
  return result;
}

/** Effective parent of `id` after applying the invariants above. */
export function effectiveParentId(decks: Deck[], id: string): string | null {
  return effectiveParents(decks).get(id) ?? null;
}

/** Forest of decks; roots and every children list sorted by name. */
export function buildDeckTree(decks: Deck[]): DeckNode[] {
  const parents = effectiveParents(decks);
  const childrenOf = new Map<string | null, Deck[]>();
  for (const d of decks) {
    const p = parents.get(d.id) ?? null;
    const list = childrenOf.get(p);
    if (list) list.push(d);
    else childrenOf.set(p, [d]);
  }
  const build = (deck: Deck, depth: number): DeckNode => ({
    deck,
    depth,
    children: (childrenOf.get(deck.id) ?? [])
      .sort(byName)
      .map((c) => build(c, depth + 1)),
  });
  return (childrenOf.get(null) ?? []).sort(byName).map((d) => build(d, 0));
}

/** Pre-order flattening of a forest — e.g. for an indented <select>. */
export function flattenTree(nodes: DeckNode[]): DeckNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** `id` plus every descendant id, pre-order. [] if `id` isn't in `decks`. */
export function subtreeIds(decks: Deck[], id: string): string[] {
  const find = (nodes: DeckNode[]): DeckNode | undefined => {
    for (const n of nodes) {
      if (n.deck.id === id) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return undefined;
  };
  const node = find(buildDeckTree(decks));
  return node ? flattenTree([node]).map((n) => n.deck.id) : [];
}

/** Ancestors of `id`, root first, excluding `id` itself — for breadcrumbs. */
export function ancestors(decks: Deck[], id: string): Deck[] {
  const parents = effectiveParents(decks);
  const byId = new Map(decks.map((d) => [d.id, d]));
  const chain: Deck[] = [];
  let p = parents.get(id) ?? null;
  while (p !== null) {
    const deck = byId.get(p);
    if (!deck) break;
    chain.unshift(deck);
    p = parents.get(p) ?? null;
  }
  return chain;
}

/**
 * True if making `newParentId` the parent of `id` would put `id` inside
 * its own subtree (including newParentId === id). null is always valid.
 */
export function wouldCreateCycle(
  decks: Deck[],
  id: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false;
  return subtreeIds(decks, id).includes(newParentId) || newParentId === id;
}
