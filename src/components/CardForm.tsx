"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { DEFAULT_SCHEDULING_STATE } from "@/lib/scheduler";
import type { Card } from "@/lib/types";

interface Props {
  deckId: string;
  cardId?: string; // undefined = create mode
}

export function CardForm({ deckId, cardId }: Props) {
  const { cards } = useRepositories();
  const { ownerId } = useAuth();
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
          ownerId,
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
    <div className="w-full max-w-lg mx-auto py-10 px-4 space-y-6">
      <h1 className="text-title tracking-tight">
        {existing ? "Edit card" : "New card"}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label className="block text-micro text-ink-2">Front</label>
          <textarea
            value={front}
            onChange={(e) => setFront(e.target.value)}
            rows={3}
            placeholder="Question or prompt…"
            className="w-full rounded-control bg-surface-2 border border-line-2 px-4 py-3 text-base text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent resize-none"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-micro text-ink-2">
            Back (primary answer)
          </label>
          <textarea
            value={back}
            onChange={(e) => setBack(e.target.value)}
            rows={3}
            placeholder="Answer…"
            className="w-full rounded-control bg-surface-2 border border-line-2 px-4 py-3 text-base text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent resize-none"
          />
        </div>

        {/* Alternate accepted answers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-micro text-ink-2">
              Alternate answers
              <span className="ml-1 text-ink-3">
                (other phrasings that are also correct)
              </span>
            </label>
            <button
              type="button"
              onClick={addAlternate}
              className="text-micro text-accent-hi hover:opacity-80 transition-opacity"
            >
              + Add
            </button>
          </div>
          {alternateAnswers.length === 0 && (
            <p className="text-meta text-ink-3">
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
                className="flex-1 rounded-control bg-surface-2 border border-line-2 px-4 py-2.5 text-base text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => removeAlternate(i)}
                className="text-meta text-incorrect hover:opacity-80 transition-opacity px-1"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Labels */}
        <div className="space-y-1.5">
          <label className="block text-micro text-ink-2">
            Labels
            <span className="ml-1 text-ink-3">(comma-separated)</span>
          </label>
          <input
            type="text"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            placeholder="e.g. vocab, chapter-3, hard"
            className="w-full rounded-control bg-surface-2 border border-line-2 px-4 py-3 text-base text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {parseLabels(labelInput).length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {parseLabels(labelInput).map((l) => (
                <span
                  key={l}
                  className="text-micro rounded-chip bg-accent-soft text-accent-hi px-2.5 py-1"
                >
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-meta text-incorrect">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="text-button rounded-control bg-accent text-on-accent px-5 py-3 hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? "Saving…" : existing ? "Save changes" : "Add card"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/decks/${deckId}`)}
            className="text-button rounded-control border border-line-2 text-ink-2 px-5 py-3 hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
