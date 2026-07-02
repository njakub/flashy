"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { useReloadOnSync } from "@/lib/sync/useReloadOnSync";
import type { Deck } from "@/lib/types";

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
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await decks.getAll(ownerId);
    setDeckList(d.sort((a, b) => a.name.localeCompare(b.name)));
    const counts: Record<string, number> = {};
    await Promise.all(
      d.map(async (deck) => {
        const c = await cards.getByDeck(deck.id);
        counts[deck.id] = c.length;
      }),
    );
    setCardCounts(counts);
  }, [decks, cards, ownerId]);

  useReloadOnSync(load);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const deck = await decks.create({ name, ownerId });
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
        <ul className="flex flex-col gap-3">
          {deckList.map((deck) => (
            <li key={deck.id}>
              <Link
                href={`/decks/${deck.id}`}
                className="flex items-center gap-4 rounded-row bg-surface-1 border border-line px-4 py-4 hover:border-accent transition-colors group"
              >
                <div className="flex-none w-11 h-11 rounded-icon bg-accent-soft flex items-center justify-center">
                  <span className="text-button text-accent-hi">
                    {initials(deck.name)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-body text-ink-1 tracking-tight truncate group-hover:text-accent-hi transition-colors">
                    {deck.name}
                  </p>
                  <p className="text-meta text-ink-3 mt-0.5">
                    {cardCounts[deck.id] ?? 0} card
                    {cardCounts[deck.id] !== 1 ? "s" : ""}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
