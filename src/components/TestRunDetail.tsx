"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { useReloadOnSync } from "@/lib/sync/useReloadOnSync";
import { cardLabelsById, formatDuration } from "@/lib/testHistory";
import { CardContent } from "@/components/CardContent";
import type { Card, TestRun, TestRunQuestion } from "@/lib/types";

interface Props {
  deckId: string;
  runId: string;
}

export function TestRunDetail({ deckId, runId }: Props) {
  const { cards, testRuns } = useRepositories();
  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState<TestRun | null>(null);
  const [questions, setQuestions] = useState<TestRunQuestion[]>([]);
  const [cardList, setCardList] = useState<Card[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, qs, c] = await Promise.all([
      testRuns.getRunById(runId),
      testRuns.getQuestionsForRun(runId),
      cards.getByDeck(deckId),
    ]);
    setRun(r ?? null);
    setQuestions(qs);
    setCardList(c);
    setLoading(false);
  }, [testRuns, cards, runId, deckId]);

  useReloadOnSync(load);

  if (loading) return <div className="p-8 text-ink-3">Loading…</div>;

  if (!run) {
    return (
      <div className="w-full max-w-2xl mx-auto py-10 px-4 space-y-4">
        <p className="text-meta text-ink-3">Test run not found.</p>
        <Link
          href={`/decks/${deckId}/history`}
          className="text-meta text-ink-3 hover:text-ink-1 transition-colors"
        >
          ← Back to history
        </Link>
      </div>
    );
  }

  const cardLabels = cardLabelsById(cardList);

  return (
    <div className="w-full max-w-2xl mx-auto py-10 px-4 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-title">
            {new Date(run.startedAt).toLocaleDateString()} ·{" "}
            {run.correctCount}/{run.questionCount}
          </h1>
          <p className="text-meta text-ink-3 mt-1">
            {run.questionCount} question{run.questionCount !== 1 ? "s" : ""} ·{" "}
            {formatDuration(run.startedAt, run.completedAt)}
          </p>
        </div>
        <Link
          href={`/decks/${deckId}/history`}
          className="text-meta text-ink-3 hover:text-ink-1 transition-colors shrink-0"
        >
          ← Back
        </Link>
      </div>

      <ul className="flex flex-col">
        {questions.map((q) => {
          const labels = cardLabels.get(q.cardId);
          return (
            <li
              key={q.id}
              className="flex items-start gap-3 py-3.5 border-b border-line last:border-none"
            >
              <span
                className={`flex-none w-[22px] h-[22px] mt-0.5 rounded-full flex items-center justify-center text-[12px] text-on-semantic ${
                  q.outcome === "correct" ? "bg-correct" : "bg-incorrect"
                }`}
              >
                {q.outcome === "correct" ? "✓" : "✕"}
              </span>
              <div className="flex-1 min-w-0">
                <CardContent text={q.cardFrontSnapshot} className="text-body text-ink-1" />
                <p className="text-meta text-ink-3 mt-1">
                  {q.outcome === "correct" ? (
                    q.cardBackSnapshot
                  ) : (
                    <>
                      you wrote{" "}
                      <span className="text-incorrect">{q.userAnswer}</span> ·{" "}
                      {q.cardBackSnapshot}
                    </>
                  )}
                  {q.similarity !== undefined && (
                    <span className="opacity-70">
                      {" "}
                      ({(q.similarity * 100).toFixed(0)}% similarity)
                    </span>
                  )}
                </p>
                {labels === undefined ? (
                  <span className="text-micro text-ink-3 italic">
                    card deleted
                  </span>
                ) : (
                  labels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {labels.map((l) => (
                        <span
                          key={l}
                          className="text-micro rounded-chip bg-surface-3 border border-line text-ink-2 px-2 py-0.5"
                        >
                          {l}
                        </span>
                      ))}
                    </div>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
