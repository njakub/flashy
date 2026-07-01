"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { LOCAL_USER_ID } from "@/lib/constants";
import type { Deck, Card } from "@/lib/types";

interface Props {
  deckId: string;
}

export function DeckDetail({ deckId }: Props) {
  const { decks, cards } = useRepositories();
  const router = useRouter();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cardList, setCardList] = useState<Card[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    const d = await decks.getById(deckId);
    if (!d) {
      router.push("/");
      return;
    }
    setDeck(d);
    setEditName(d.name);
    const c = await cards.getByDeck(deckId);
    setCardList(c.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    const due = await cards.getDueCards(deckId, new Date());
    setDueCount(due.length);
  }, [deckId, decks, cards, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    const name = editName.trim();
    if (!name || !deck) return;
    setError(null);
    try {
      await decks.update(deck.id, { name });
      setEditing(false);
      await load();
    } catch {
      setError("Failed to rename deck.");
    }
  }

  async function handleDeleteDeck() {
    if (!deck) return;
    try {
      await decks.delete(deck.id);
      router.push("/");
    } catch {
      setError("Failed to delete deck.");
    }
  }

  async function handleDeleteCard(cardId: string) {
    try {
      await cards.delete(cardId);
      await load();
    } catch {
      setError("Failed to delete card.");
    }
  }

  if (!deck) return <div className="p-8 text-neutral-500">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          {editing ? (
            <form onSubmit={handleRename} className="flex gap-2">
              <input
                autoFocus
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                maxLength={120}
              />
              <button
                type="submit"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setEditName(deck.name);
                }}
                className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
            </form>
          ) : (
            <h1 className="text-2xl font-bold">{deck.name}</h1>
          )}
        </div>

        {!editing && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              Rename
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg border border-red-300 text-red-600 px-3 py-1.5 text-sm hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              Delete deck
            </button>
          </div>
        )}
      </div>

      {/* Confirm delete deck */}
      {confirmDelete && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950 p-4 space-y-3">
          <p className="text-sm text-red-700 dark:text-red-300 font-medium">
            Delete &ldquo;{deck.name}&rdquo; and all {cardList.length} card
            {cardList.length !== 1 ? "s" : ""}? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDeleteDeck}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition-colors"
            >
              Yes, delete everything
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Study / Test actions */}
      <div className="flex gap-3">
        <Link
          href={`/decks/${deckId}/study`}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
        >
          Study ({dueCount} due)
        </Link>
        <Link
          href={`/decks/${deckId}/test`}
          className="rounded-lg border border-indigo-400 text-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors"
        >
          Test mode
        </Link>
      </div>

      {/* Add card */}
      <Link
        href={`/decks/${deckId}/cards/new`}
        className="inline-block rounded-lg border border-dashed border-neutral-400 px-4 py-2 text-sm text-neutral-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
      >
        + Add card
      </Link>

      {/* Card list */}
      {cardList.length === 0 ? (
        <p className="text-neutral-500 text-sm">No cards yet.</p>
      ) : (
        <ul className="space-y-2">
          {cardList.map((card) => (
            <li
              key={card.id}
              className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{card.front}</p>
                <p className="text-xs text-neutral-400 truncate mt-0.5">
                  {card.back}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Link
                  href={`/decks/${deckId}/cards/${card.id}/edit`}
                  className="text-xs text-neutral-400 hover:text-indigo-600 transition-colors"
                >
                  Edit
                </Link>
                <button
                  onClick={() => handleDeleteCard(card.id)}
                  className="text-xs text-neutral-400 hover:text-red-500 transition-colors"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/"
        className="inline-block text-sm text-neutral-400 hover:text-neutral-700 transition-colors"
      >
        ← All decks
      </Link>
    </div>
  );
}
