"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { scheduler } from "@/lib/scheduler";
import { distinctLabels } from "@/lib/testHistory";
import { FLAGGED_LABEL } from "@/lib/constants";
import { LabelChips } from "@/components/LabelChips";
import { CardContent } from "@/components/CardContent";
import { SpeakButton } from "@/components/SpeakButton";
import { webSpeechSpeaker } from "@/lib/speech/WebSpeechSpeaker";
import type { Card, RecallRating } from "@/lib/types";

interface Props {
  deckId: string;
}

const RATINGS: {
  value: RecallRating;
  label: string;
  description: string;
  key: string;
}[] = [
  { value: "again", label: "Again", description: "Complete blank", key: "1" },
  { value: "hard", label: "Hard", description: "Serious difficulty", key: "2" },
  { value: "good", label: "Good", description: "Recalled with effort", key: "3" },
  { value: "easy", label: "Easy", description: "Effortless recall", key: "4" },
];

const RATING_COLORS: Record<RecallRating, string> = {
  again: "bg-incorrect-soft border-incorrect-soft text-incorrect",
  hard: "bg-surface-2 border-line-2 text-self-grade",
  good: "bg-surface-2 border-line-2 text-ink-1",
  easy: "bg-correct-soft border-correct-soft text-correct",
};

function matchesLabels(card: Card, selectedLabels: string[]): boolean {
  return (
    selectedLabels.length === 0 ||
    card.labels.some((l) => selectedLabels.includes(l))
  );
}

export function StudySession({ deckId }: Props) {
  const { cards } = useRepositories();
  const [queue, setQueue] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState(0);
  const [studyingAhead, setStudyingAhead] = useState(false);
  const [deckTotalCount, setDeckTotalCount] = useState(0);
  const [deckFilteredCount, setDeckFilteredCount] = useState(0);
  const [labelOptions, setLabelOptions] = useState<string[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  const load = useCallback(
    async (studyAhead = false) => {
      webSpeechSpeaker.cancel();
      setLoading(true);
      const allDeckCards = await cards.getByDeck(deckId);
      const matching = allDeckCards.filter((c) =>
        matchesLabels(c, selectedLabels),
      );
      setLabelOptions(distinctLabels(allDeckCards));
      setDeckTotalCount(allDeckCards.length);
      setDeckFilteredCount(matching.length);

      let due = (await cards.getDueCards(deckId, new Date())).filter((c) =>
        matchesLabels(c, selectedLabels),
      );
      if (due.length === 0 && studyAhead) due = matching;

      due = [...due].sort(
        (a, b) =>
          new Date(a.scheduling.dueAt).getTime() -
          new Date(b.scheduling.dueAt).getTime(),
      );
      setQueue(due);
      setCurrentIndex(0);
      setRevealed(false);
      setReviewed(0);
      setDone(due.length === 0);
      setStudyingAhead(studyAhead && due.length > 0);
      setLoading(false);
    },
    [cards, deckId, selectedLabels],
  );

  const loadDue = useCallback(() => load(false), [load]);
  const loadAll = useCallback(() => load(true), [load]);

  useEffect(() => {
    loadDue();
  }, [loadDue]);

  const current = queue[currentIndex] ?? null;

  const handleRate = useCallback(
    async (rating: RecallRating) => {
      if (!current) return;
      webSpeechSpeaker.cancel(); // never let read-aloud audio outlive its card
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
    },
    [cards, current, currentIndex, queue.length],
  );

  const isFlagged = current?.labels.includes(FLAGGED_LABEL) ?? false;

  const toggleFlag = useCallback(async () => {
    if (!current) return;
    const labels = isFlagged
      ? current.labels.filter((l) => l !== FLAGGED_LABEL)
      : [...current.labels, FLAGGED_LABEL];
    const updated = await cards.update(current.id, { labels });
    setQueue((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }, [cards, current, isFlagged]);

  // Keyboard-first review: Space reveals the answer, 1-4 rate it. Ignored
  // while typing in a form control (none currently exist here, but this
  // keeps the shortcut safe if one is ever added) or once the session ends.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (done || loading || !current) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        return;
      if (!revealed) {
        if (e.code === "Space") {
          e.preventDefault();
          setRevealed(true);
        }
        return;
      }
      const rating = RATINGS.find((r) => r.key === e.key);
      if (rating) {
        e.preventDefault();
        void handleRate(rating.value);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [done, loading, current, revealed, handleRate]);

  function toggleLabel(label: string) {
    setSelectedLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  }

  if (loading) return <div className="p-8 text-ink-3">Loading…</div>;

  return (
    <div className="w-full max-w-xl mx-auto py-10 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-title">
          Study session
          {studyingAhead && (
            <span className="ml-2 text-meta text-ink-3 font-normal">
              (studying ahead)
            </span>
          )}
        </h2>
        <span className="text-stat text-ink-2">
          {done ? queue.length : currentIndex + 1} / {queue.length}
        </span>
      </div>
      {labelOptions.length > 0 && (
        <LabelChips
          labels={labelOptions}
          selected={selectedLabels}
          onToggle={toggleLabel}
        />
      )}

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
            {reviewed > 0
              ? `Session complete — reviewed ${reviewed} card${reviewed !== 1 ? "s" : ""}.`
              : deckTotalCount === 0
                ? "This deck has no cards yet."
                : selectedLabels.length > 0 && deckFilteredCount === 0
                  ? "No cards match the selected labels."
                  : "Nothing due right now."}
          </p>
          <div className="flex justify-center gap-3">
            {reviewed > 0 ? (
              <button
                onClick={loadDue}
                className="text-button rounded-control bg-accent text-on-accent px-5 py-3 hover:opacity-90 transition-opacity"
              >
                Restart
              </button>
            ) : (
              deckFilteredCount > 0 && (
                <button
                  onClick={loadAll}
                  className="text-button rounded-control bg-accent text-on-accent px-5 py-3 hover:opacity-90 transition-opacity"
                >
                  Study anyway
                </button>
              )
            )}
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
          <div className="rounded-card bg-surface-1 border border-line p-7 min-h-[220px] flex flex-col gap-5 relative">
            <button
              onClick={toggleFlag}
              title={isFlagged ? "Unflag this card" : "Flag this card for review"}
              className={`absolute top-3 right-3 text-meta transition-colors ${
                isFlagged ? "text-incorrect" : "text-ink-3 hover:text-ink-1"
              }`}
            >
              ⚑
            </button>
            <CardContent
              text={current?.front ?? ""}
              className={`text-card-front flex-1 flex flex-col justify-center ${
                revealed ? "text-ink-2" : "text-ink-1"
              }`}
            />
            {revealed && (
              <>
                <div className="h-px bg-line" />
                <div className="flex items-start gap-2">
                  <CardContent
                    text={current?.back ?? ""}
                    className="text-card-back text-accent-hi flex-1"
                  />
                  <SpeakButton text={current?.back ?? ""} className="mt-1.5" />
                </div>
              </>
            )}
          </div>

          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              className="w-full rounded-control border border-dashed border-line-2 text-ink-2 text-meta py-3 hover:bg-surface-2 transition-colors"
            >
              Tap to reveal answer{" "}
              <kbd className="text-[10px] opacity-60">(Space)</kbd>
            </button>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map(({ value, label, description, key }) => (
                <button
                  key={value}
                  onClick={() => handleRate(value)}
                  className={`rounded-control border px-1 py-3 text-center transition-colors ${RATING_COLORS[value]}`}
                >
                  <div className="text-[13px] font-semibold">
                    {label}{" "}
                    <kbd className="text-[10px] font-normal opacity-60">
                      {key}
                    </kbd>
                  </div>
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
