"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { LOCAL_USER_ID } from "@/lib/constants";
import { DEFAULT_SCHEDULING_STATE } from "@/lib/scheduler";
import type { Card } from "@/lib/types";

interface Props {
  deckId: string;
  cardId?: string; // undefined = create mode
}

export function CardForm({ deckId, cardId }: Props) {
  const { cards } = useRepositories();
  const router = useRouter();
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Card | null>(null);

  useEffect(() => {
    if (!cardId) return;
    cards.getById(cardId).then((c) => {
      if (c) {
        setExisting(c);
        setFront(c.front);
        setBack(c.back);
      }
    });
  }, [cardId, cards]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const f = front.trim();
    const b = back.trim();
    if (!f || !b) {
      setError("Both front and back are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (existing) {
        await cards.update(existing.id, { front: f, back: b });
      } else {
        await cards.create({
          deckId,
          ownerId: LOCAL_USER_ID,
          front: f,
          back: b,
          scheduling: DEFAULT_SCHEDULING_STATE(),
        });
      }
      router.push(`/decks/${deckId}`);
    } catch {
      setError("Failed to save card.");
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto py-10 px-4 space-y-6">
      <h1 className="text-2xl font-bold">
        {existing ? "Edit card" : "New card"}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label className="block text-sm font-medium">Front</label>
          <textarea
            value={front}
            onChange={(e) => setFront(e.target.value)}
            rows={3}
            placeholder="Question or prompt…"
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium">Back</label>
          <textarea
            value={back}
            onChange={(e) => setBack(e.target.value)}
            rows={3}
            placeholder="Answer…"
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : existing ? "Save changes" : "Add card"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/decks/${deckId}`)}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
