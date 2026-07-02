"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { scheduler } from "@/lib/scheduler";
import type { Card, RecallRating } from "@/lib/types";

interface Props {
  deckId: string;
}

const RATINGS: { value: RecallRating; label: string; description: string }[] = [
  { value: "again", label: "Again", description: "Complete blank" },
  { value: "hard", label: "Hard", description: "Serious difficulty" },
  { value: "good", label: "Good", description: "Recalled with effort" },
  { value: "easy", label: "Easy", description: "Effortless recall" },
];

const RATING_COLORS: Record<RecallRating, string> = {
  again: "bg-incorrect-soft border-incorrect-soft text-incorrect",
  hard: "bg-surface-2 border-line-2 text-self-grade",
  good: "bg-surface-2 border-line-2 text-ink-1",
  easy: "bg-correct-soft border-correct-soft text-correct",
};

export function StudySession({ deckId }: Props) {
  const { cards } = useRepositories();
  const [queue, setQueue] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const due = await cards.getByDeck(deckId);
    setQueue(due);
    setCurrentIndex(0);
    setRevealed(false);
    setDone(due.length === 0);
    setLoading(false);
  }, [cards, deckId]);

  useEffect(() => {
    load();
  }, [load]);

  const current = queue[currentIndex] ?? null;

  async function handleRate(rating: RecallRating) {
    if (!current) return;
    const nextState = scheduler.review(current.scheduling, rating);
    await cards.update(current.id, { scheduling: nextState });
    setReviewed((r) => r + 1);
    const nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      setDone(true);
    } else {
      setCurrentIndex(nextIndex);
      setRevealed(false);
    }
  }

  if (loading) return <div className="p-8 text-ink-3">Loading…</div>;

  return (
    <div className="w-full max-w-xl mx-auto py-10 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-title">Study session</h2>
        <span className="text-stat text-ink-2">
          {done ? queue.length : currentIndex + 1} / {queue.length}
        </span>
      </div>
      {!done && queue.length > 0 && (
        <div className="h-1 rounded-pill bg-surface-2 overflow-hidden">
          <div
            className="h-full rounded-pill bg-accent transition-all"
            style={{ width: `${(currentIndex / queue.length) * 100}%` }}
          />
        </div>
      )}

      {done ? (
        <div className="rounded-card border border-line bg-surface-1 p-8 text-center space-y-4">
          <p className="text-2xl">🎉</p>
          <p className="text-body">
            {queue.length === 0
              ? "This deck has no cards yet."
              : `Session complete — reviewed ${reviewed} card${reviewed !== 1 ? "s" : ""}.`}
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={load}
              className="text-button rounded-control bg-accent text-on-accent px-5 py-3 hover:opacity-90 transition-opacity"
            >
              Restart
            </button>
            <Link
              href={`/decks/${deckId}`}
              className="text-button rounded-control border border-line-2 text-ink-2 px-5 py-3 hover:bg-surface-2 transition-colors"
            >
              Back to deck
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-card bg-surface-1 border border-line p-7 min-h-[220px] flex flex-col gap-5">
            <p
              className={`text-card-front flex-1 flex items-center whitespace-pre-wrap ${
                revealed ? "text-ink-2" : "text-ink-1"
              }`}
            >
              {current?.front}
            </p>
            {revealed && (
              <>
                <div className="h-px bg-line" />
                <p className="text-card-back text-accent-hi whitespace-pre-wrap">
                  {current?.back}
                </p>
              </>
            )}
          </div>

          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              className="w-full rounded-control border border-dashed border-line-2 text-ink-2 text-meta py-3 hover:bg-surface-2 transition-colors"
            >
              Tap to reveal answer
            </button>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map(({ value, label, description }) => (
                <button
                  key={value}
                  onClick={() => handleRate(value)}
                  className={`rounded-control border px-1 py-3 text-center transition-colors ${RATING_COLORS[value]}`}
                >
                  <div className="text-[13px] font-semibold">{label}</div>
                  <div className="text-[10px] font-normal opacity-70 mt-0.5">
                    {description}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <Link
        href={`/decks/${deckId}`}
        className="inline-block text-meta text-ink-3 hover:text-ink-1 transition-colors"
      >
        ← Back to deck
      </Link>
    </div>
  );
}
