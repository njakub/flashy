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
  again: "bg-red-600 hover:bg-red-500",
  hard: "bg-orange-500 hover:bg-orange-400",
  good: "bg-green-600 hover:bg-green-500",
  easy: "bg-sky-600 hover:bg-sky-500",
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

  if (loading) return <div className="p-8 text-neutral-500">Loading…</div>;

  return (
    <div className="max-w-xl mx-auto py-10 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Study session</h2>
        <span className="text-sm text-neutral-400">
          {done ? queue.length : currentIndex + 1} / {queue.length}
        </span>
      </div>

      {done ? (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 text-center space-y-4">
          <p className="text-2xl">🎉</p>
          <p className="font-semibold">
            {queue.length === 0
              ? "This deck has no cards yet."
              : `Session complete — reviewed ${reviewed} card${reviewed !== 1 ? "s" : ""}.`}
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={load}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
            >
              Restart
            </button>
            <Link
              href={`/decks/${deckId}`}
              className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Back to deck
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Card front */}
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 min-h-[140px] flex items-center justify-center text-center">
            <p className="text-lg whitespace-pre-wrap">{current?.front}</p>
          </div>

          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              className="w-full rounded-xl border border-dashed border-indigo-400 py-3 text-sm text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors font-medium"
            >
              Reveal answer
            </button>
          ) : (
            <div className="space-y-4">
              {/* Card back */}
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950 p-6 min-h-[100px] flex items-center justify-center text-center">
                <p className="text-base whitespace-pre-wrap">{current?.back}</p>
              </div>

              {/* Recall rating buttons */}
              <div className="grid grid-cols-4 gap-2">
                {RATINGS.map(({ value, label, description }) => (
                  <button
                    key={value}
                    onClick={() => handleRate(value)}
                    className={`rounded-lg px-2 py-3 text-white text-sm font-semibold transition-colors ${RATING_COLORS[value]}`}
                  >
                    <div>{label}</div>
                    <div className="text-xs font-normal opacity-80 mt-0.5">
                      {description}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Link
        href={`/decks/${deckId}`}
        className="inline-block text-sm text-neutral-400 hover:text-neutral-700 transition-colors"
      >
        ← Back to deck
      </Link>
    </div>
  );
}
