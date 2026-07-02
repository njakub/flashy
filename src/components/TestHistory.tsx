"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { useReloadOnSync } from "@/lib/sync/useReloadOnSync";
import {
  cardLabelsById,
  distinctLabels,
  groupQuestionsByRun,
  computeLabelStats,
  runListForLabel,
  formatDuration,
  type RunListEntry,
} from "@/lib/testHistory";
import type { Card, TestRun, TestRunQuestion } from "@/lib/types";

interface Props {
  deckId: string;
}

function pct(correct: number, attempts: number): string {
  if (attempts === 0) return "—";
  return `${Math.round((correct / attempts) * 100)}%`;
}

function accuracyColor(p: number): string {
  return p >= 80 ? "text-correct" : p >= 60 ? "text-self-grade" : "text-incorrect";
}

function accuracyBarColor(p: number): string {
  return p >= 80 ? "bg-correct" : p >= 60 ? "bg-self-grade" : "bg-incorrect";
}

type Tab = "runs" | "byLabel";

export function TestHistory({ deckId }: Props) {
  const { cards, testRuns } = useRepositories();
  const [loading, setLoading] = useState(true);
  const [cardList, setCardList] = useState<Card[]>([]);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [questions, setQuestions] = useState<TestRunQuestion[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("runs");

  const load = useCallback(async () => {
    setLoading(true);
    const [c, r] = await Promise.all([
      cards.getByDeck(deckId),
      testRuns.getRunsByDeck(deckId),
    ]);
    setCardList(c);
    setRuns(r);
    setQuestions(await testRuns.getQuestionsForRuns(r.map((run) => run.id)));
    setLoading(false);
  }, [cards, testRuns, deckId]);

  useReloadOnSync(load);

  if (loading) return <div className="p-8 text-ink-3">Loading…</div>;

  const cardLabels = cardLabelsById(cardList);
  const labels = distinctLabels(cardList);
  const questionsByRun = groupQuestionsByRun(questions);
  const labelStats = computeLabelStats(questions, cardLabels);

  const overallAttempts = runs.reduce((a, r) => a + r.questionCount, 0);
  const overallCorrect = runs.reduce((a, r) => a + r.correctCount, 0);

  const entries: RunListEntry[] = runListForLabel(
    runs,
    questionsByRun,
    cardLabels,
    selectedLabel,
  );

  function selectLabelAndShowRuns(label: string) {
    setSelectedLabel(label);
    setTab("runs");
  }

  return (
    <div className="w-full max-w-2xl mx-auto py-10 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-title">Test history</h1>
        <Link
          href={`/decks/${deckId}`}
          className="text-meta text-ink-3 hover:text-ink-1 transition-colors"
        >
          ← Back to deck
        </Link>
      </div>

      {runs.length === 0 ? (
        <p className="text-meta text-ink-3">
          No test history yet — take a test to see it here.
        </p>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1.5 bg-surface-1 border border-line rounded-control p-1">
            <button
              onClick={() => setTab("runs")}
              className={`flex-1 text-center py-2.5 rounded-segment text-button transition-colors ${
                tab === "runs" ? "bg-surface-3 text-ink-1" : "text-ink-2"
              }`}
            >
              Runs
            </button>
            {labels.length > 0 && (
              <button
                onClick={() => setTab("byLabel")}
                className={`flex-1 text-center py-2.5 rounded-segment text-button transition-colors ${
                  tab === "byLabel" ? "bg-surface-3 text-ink-1" : "text-ink-2"
                }`}
              >
                By label
              </button>
            )}
          </div>

          {tab === "runs" ? (
            <>
              {selectedLabel && (
                <div className="flex items-center gap-2">
                  <span className="text-micro rounded-chip bg-accent-soft text-accent-hi px-2.5 py-1.5">
                    Filtered by &ldquo;{selectedLabel}&rdquo;
                  </span>
                  <button
                    onClick={() => setSelectedLabel(null)}
                    className="text-micro text-ink-3 hover:text-ink-1 transition-colors"
                  >
                    ✕ Clear
                  </button>
                </div>
              )}

              {entries.length === 0 ? (
                <p className="text-meta text-ink-3">
                  No runs contain &ldquo;{selectedLabel}&rdquo; cards yet.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {entries.map(({ run, questionCount, correctCount }) => {
                    const runPct =
                      questionCount > 0
                        ? Math.round((correctCount / questionCount) * 100)
                        : null;
                    return (
                      <li key={run.id}>
                        <Link
                          href={`/decks/${deckId}/history/${run.id}`}
                          className="flex items-center gap-4 py-4 border-b border-line last:border-none hover:opacity-80 transition-opacity"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-body text-ink-1">
                              {new Date(run.startedAt).toLocaleDateString()}
                            </p>
                            <p className="text-meta text-ink-3 mt-0.5">
                              {questionCount} question
                              {questionCount !== 1 ? "s" : ""} ·{" "}
                              {formatDuration(run.startedAt, run.completedAt)}
                            </p>
                          </div>
                          <div className="flex-none text-right">
                            <p
                              className={`text-stat ${runPct === null ? "text-ink-3" : accuracyColor(runPct)}`}
                            >
                              {correctCount}/{questionCount}
                            </p>
                            <p className="text-stat text-ink-3 mt-0.5">
                              {runPct === null ? "—" : `${runPct}%`}
                            </p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <p className="text-meta text-ink-2">
                Accuracy across all tests, per label
              </p>
              <p className="text-micro text-ink-3">
                Reflects current labels — relabelling or deleting a card
                updates this retroactively.
              </p>
              <p className="text-meta text-ink-2">
                Overall{" "}
                <span className="text-ink-1 font-semibold">
                  {pct(overallCorrect, overallAttempts)}
                </span>{" "}
                ({overallCorrect}/{overallAttempts})
              </p>
              <ul className="flex flex-col">
                {labelStats.map((s) => {
                  const p =
                    s.attempts > 0
                      ? Math.round((s.correct / s.attempts) * 100)
                      : 0;
                  return (
                    <li key={s.label}>
                      <button
                        onClick={() => selectLabelAndShowRuns(s.label)}
                        className="w-full flex items-center gap-3 py-3.5 text-left"
                      >
                        <span className="text-body text-ink-1 w-24 flex-none truncate">
                          {s.label}
                        </span>
                        <div className="flex-1 h-2 rounded-pill bg-surface-2 overflow-hidden">
                          <div
                            className={`h-full rounded-pill ${accuracyBarColor(p)}`}
                            style={{ width: `${p}%` }}
                          />
                        </div>
                        <span
                          className={`text-stat w-10 flex-none text-right ${accuracyColor(p)}`}
                        >
                          {p}%
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
