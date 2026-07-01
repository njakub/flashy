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
  const [alternateAnswers, setAlternateAnswers] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState(""); // comma-separated input value
  const [labels, setLabels] = useState<string[]>([]);
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
        setAlternateAnswers(c.alternateAnswers ?? []);
        setLabels(c.labels ?? []);
        setLabelInput((c.labels ?? []).join(", "));
      }
    });
  }, [cardId, cards]);

  function parseLabels(raw: string): string[] {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function addAlternate() {
    setAlternateAnswers((prev) => [...prev, ""]);
  }

  function updateAlternate(index: number, value: string) {
    setAlternateAnswers((prev) =>
      prev.map((a, i) => (i === index ? value : a)),
    );
  }

  function removeAlternate(index: number) {
    setAlternateAnswers((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const f = front.trim();
    const b = back.trim();
    if (!f || !b) {
      setError("Both front and back are required.");
      return;
    }
    const alts = alternateAnswers.map((a) => a.trim()).filter(Boolean);
    const lbs = parseLabels(labelInput);
    setSaving(true);
    setError(null);
    try {
      if (existing) {
        await cards.update(existing.id, {
          front: f,
          back: b,
          alternateAnswers: alts,
          labels: lbs,
        });
      } else {
        await cards.create({
          deckId,
          ownerId: LOCAL_USER_ID,
          front: f,
          back: b,
          alternateAnswers: alts,
          labels: lbs,
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
          <label className="block text-sm font-medium">
            Back (primary answer)
          </label>
          <textarea
            value={back}
            onChange={(e) => setBack(e.target.value)}
            rows={3}
            placeholder="Answer…"
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>

        {/* Alternate accepted answers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium">
              Alternate answers
              <span className="ml-1 text-xs font-normal text-neutral-400">
                (other phrasings that are also correct)
              </span>
            </label>
            <button
              type="button"
              onClick={addAlternate}
              className="text-xs text-indigo-600 hover:text-indigo-500 transition-colors"
            >
              + Add
            </button>
          </div>
          {alternateAnswers.length === 0 && (
            <p className="text-xs text-neutral-400">
              None — the primary answer above is the only accepted answer.
            </p>
          )}
          {alternateAnswers.map((alt, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={alt}
                onChange={(e) => updateAlternate(i, e.target.value)}
                placeholder={`Alternate answer ${i + 1}…`}
                className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => removeAlternate(i)}
                className="text-xs text-red-400 hover:text-red-600 transition-colors px-1"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Labels */}
        <div className="space-y-1">
          <label className="block text-sm font-medium">
            Labels
            <span className="ml-1 text-xs font-normal text-neutral-400">
              (comma-separated)
            </span>
          </label>
          <input
            type="text"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            placeholder="e.g. vocab, chapter-3, hard"
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {parseLabels(labelInput).length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {parseLabels(labelInput).map((l) => (
                <span
                  key={l}
                  className="rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs px-2 py-0.5"
                >
                  {l}
                </span>
              ))}
            </div>
          )}
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
