"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { LOCAL_USER_ID } from "@/lib/constants";
import type { Deck } from "@/lib/types";

export function DeckList() {
  const { decks, cards } = useRepositories();
  const router = useRouter();
  const [deckList, setDeckList] = useState<Deck[]>([]);
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await decks.getAll(LOCAL_USER_ID);
    setDeckList(d.sort((a, b) => a.name.localeCompare(b.name)));
    const counts: Record<string, number> = {};
    await Promise.all(
      d.map(async (deck) => {
        const c = await cards.getByDeck(deck.id);
        counts[deck.id] = c.length;
      }),
    );
    setCardCounts(counts);
  }, [decks, cards]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const deck = await decks.create({ name, ownerId: LOCAL_USER_ID });
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
    <div className="max-w-xl mx-auto py-10 px-4 space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">Flashy</h1>

      {/* Create deck */}
      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New deck name…"
          className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          maxLength={120}
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
        >
          Create
        </button>
      </form>
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Deck list */}
      {deckList.length === 0 ? (
        <p className="text-neutral-500 text-sm">
          No decks yet. Create one above.
        </p>
      ) : (
        <ul className="space-y-2">
          {deckList.map((deck) => (
            <li key={deck.id}>
              <Link
                href={`/decks/${deck.id}`}
                className="flex items-center justify-between rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3 hover:border-indigo-400 transition-colors group"
              >
                <span className="font-medium group-hover:text-indigo-600 transition-colors">
                  {deck.name}
                </span>
                <span className="text-xs text-neutral-400">
                  {cardCounts[deck.id] ?? 0} card
                  {cardCounts[deck.id] !== 1 ? "s" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
