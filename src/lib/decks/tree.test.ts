import { describe, expect, it } from "vitest";
import type { Deck } from "@/lib/types";
import {
  ancestors,
  buildDeckTree,
  effectiveParentId,
  subtreeIds,
  wouldCreateCycle,
  type DeckNode,
} from "./tree";

function deck(id: string, parentId: string | null = null, name = id): Deck {
  return {
    id,
    ownerId: "u",
    name,
    parentId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Compact shape for assertions: "id(child,child(grandchild))". */
function shape(nodes: DeckNode[]): string {
  return nodes
    .map((n) =>
      n.children.length ? `${n.deck.id}(${shape(n.children)})` : n.deck.id,
    )
    .join(",");
}

describe("buildDeckTree", () => {
  it("flat list -> all roots, sorted by name case-insensitively", () => {
    const tree = buildDeckTree([
      deck("c", null, "react"),
      deck("a", null, "Browser"),
      deck("b", null, "CSS"),
    ]);
    expect(shape(tree)).toBe("a,b,c");
  });

  it("nests three levels with correct depths", () => {
    const tree = buildDeckTree([
      deck("fe"),
      deck("react", "fe"),
      deck("hooks", "react"),
      deck("js", "fe"),
    ]);
    expect(shape(tree)).toBe("fe(js,react(hooks))");
    expect(tree[0].children[1].children[0].depth).toBe(2);
  });

  it("orphan (parent missing) becomes a root", () => {
    expect(shape(buildDeckTree([deck("a"), deck("b", "gone")]))).toBe("a,b");
  });

  it("self-parent becomes a root", () => {
    expect(shape(buildDeckTree([deck("a", "a")]))).toBe("a");
  });

  it("2-cycle -> smallest id is the root, the other hangs beneath it", () => {
    expect(shape(buildDeckTree([deck("y", "x"), deck("x", "y")]))).toBe(
      "x(y)",
    );
  });

  it("3-cycle with a tail -> broken at smallest id, tail kept", () => {
    const tree = buildDeckTree([
      deck("b", "a"),
      deck("c", "b"),
      deck("a", "c"),
      deck("tail", "c"),
    ]);
    expect(shape(tree)).toBe("a(b(c(tail)))");
  });
});

describe("subtreeIds / ancestors / effectiveParentId", () => {
  const decks = [
    deck("fe"),
    deck("react", "fe"),
    deck("hooks", "react"),
    deck("js", "fe"),
    deck("sd"),
  ];

  it("subtree of a leaf is just itself", () => {
    expect(subtreeIds(decks, "hooks")).toEqual(["hooks"]);
  });

  it("subtree of a root includes every descendant, pre-order", () => {
    expect(subtreeIds(decks, "fe")).toEqual(["fe", "js", "react", "hooks"]);
  });

  it("unknown id -> empty subtree", () => {
    expect(subtreeIds(decks, "nope")).toEqual([]);
  });

  it("ancestors are root-first and exclude the deck", () => {
    expect(ancestors(decks, "hooks").map((d) => d.id)).toEqual([
      "fe",
      "react",
    ]);
    expect(ancestors(decks, "fe")).toEqual([]);
  });

  it("effectiveParentId resolves orphans to null", () => {
    expect(effectiveParentId([deck("a", "gone")], "a")).toBeNull();
    expect(effectiveParentId(decks, "hooks")).toBe("react");
  });
});

describe("wouldCreateCycle", () => {
  const decks = [deck("fe"), deck("react", "fe"), deck("hooks", "react"), deck("sd")];

  it("rejects moving into itself, a child, or a grandchild", () => {
    expect(wouldCreateCycle(decks, "fe", "fe")).toBe(true);
    expect(wouldCreateCycle(decks, "fe", "react")).toBe(true);
    expect(wouldCreateCycle(decks, "fe", "hooks")).toBe(true);
  });

  it("allows an unrelated deck, an ancestor, or top level", () => {
    expect(wouldCreateCycle(decks, "fe", "sd")).toBe(false);
    expect(wouldCreateCycle(decks, "hooks", "fe")).toBe(false);
    expect(wouldCreateCycle(decks, "hooks", null)).toBe(false);
  });
});
