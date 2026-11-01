"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { useReloadOnSync } from "@/lib/sync/useReloadOnSync";
import { StatsPanel } from "@/components/StatsPanel";
import { buildDeckTree, type DeckNode } from "@/lib/decks/tree";
import type { Deck } from "@/lib/types";

const COLLAPSED_KEY = "flashy_deck_collapsed";

/** Per-viewer convenience only — storage may be unavailable, so never throw. */
function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(ids: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore — collapse state just won't persist
  }
}

interface Counts {
  total: number;
  due: number;
}

/** Two-letter monogram for the deck icon — presentational only. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function DeckList() {
  const { decks, cards } = useRepositories();
  const { ownerId } = useAuth();
  const router = useRouter();
  const [deckList, setDeckList] = useState<Deck[]>([]);
  // Rolled up: a deck's own cards plus every descendant's.
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  // Lazy init is hydration-safe here: the deck list is empty until load()
  // resolves, so collapse state can't change the server-rendered markup.
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : readCollapsed(),
  );
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await decks.getAll(ownerId);
    setDeckList(d);
    const allCards = await cards.getAllByOwner(ownerId);
    const nowIso = new Date().toISOString();
    const own: Record<string, Counts> = {};
    for (const c of allCards) {
      const entry = (own[c.deckId] ??= { total: 0, due: 0 });
      entry.total++;
      if (c.scheduling.dueAt <= nowIso) entry.due++;
    }
    const rolled: Record<string, Counts> = {};
    const roll = (node: DeckNode): Counts => {
      const sum = { ...(own[node.deck.id] ?? { total: 0, due: 0 }) };
      for (const child of node.children) {
        const c = roll(child);
        sum.total += c.total;
        sum.due += c.due;
      }
      rolled[node.deck.id] = sum;
      return sum;
    };
    buildDeckTree(d).forEach(roll);
    setCounts(rolled);
  }, [decks, cards, ownerId]);

  useReloadOnSync(load);

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeCollapsed(next);
      return next;
    });
  }

  // Pre-order rows, skipping anything under a collapsed deck.
  const visibleRows: DeckNode[] = [];
  const walk = (nodes: DeckNode[]) => {
    for (const n of nodes) {
      visibleRows.push(n);
      if (!collapsed.has(n.deck.id)) walk(n.children);
    }
  };
  walk(buildDeckTree(deckList));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const deck = await decks.create({ name, ownerId, parentId: null });
      setNewName("");
      await load();
      router.push(`/decks/${deck.id}`);
    } catch {
      setError("Failed to create deck.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="w-full max-w-xl mx-auto py-10 px-4 space-y-6">
      <h1 className="text-display tracking-tight">Decks</h1>

      {deckList.length > 0 && <StatsPanel />}

      {/* Create deck */}
      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New deck name…"
          className="flex-1 rounded-control bg-surface-2 border border-line-2 px-4 py-3 text-base text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent"
          maxLength={120}
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="text-button rounded-control bg-accent text-on-accent px-5 min-h-12 hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          Create
        </button>
      </form>
      {error && <p className="text-meta text-incorrect">{error}</p>}

      {/* Deck list */}
      {deckList.length === 0 ? (
        <p className="text-meta text-ink-3">No decks yet. Create one above.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleRows.map((node) => {
            const { deck } = node;
            const c = counts[deck.id] ?? { total: 0, due: 0 };
            const hasChildren = node.children.length > 0;
            const isCollapsed = collapsed.has(deck.id);
            return (
              <li
                key={deck.id}
                className="flex items-center gap-1"
                style={{ paddingLeft: `${node.depth * 1.5}rem` }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(deck.id)}
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${deck.name}`}
                    className="flex-none w-7 h-7 rounded-chip text-ink-3 hover:text-ink-1 hover:bg-surface-2 transition-colors"
                  >
                    {isCollapsed ? "▸" : "▾"}
                  </button>
                ) : (
                  <span className="flex-none w-7" aria-hidden />
                )}
                <Link
                  href={`/decks/${deck.id}`}
                  className="flex-1 min-w-0 flex items-center gap-4 rounded-row bg-surface-1 border border-line px-4 py-3 hover:border-accent transition-colors group"
                >
                  <div className="flex-none w-10 h-10 rounded-icon bg-accent-soft flex items-center justify-center">
                    <span className="text-button text-accent-hi">
                      {initials(deck.name)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-body text-ink-1 tracking-tight truncate group-hover:text-accent-hi transition-colors">
                      {deck.name}
                    </p>
                    <p className="text-meta text-ink-3 mt-0.5">
                      {c.total} card{c.total !== 1 ? "s" : ""}
                      {c.due > 0 && ` · ${c.due} due`}
                      {hasChildren &&
                        ` · ${node.children.length} sub-deck${node.children.length !== 1 ? "s" : ""}`}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
