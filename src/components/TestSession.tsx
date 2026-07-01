"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { scheduler } from "@/lib/scheduler";
import {
  EmbeddingGrader,
  preloadEmbeddingModel,
} from "@/lib/grading/EmbeddingGrader";
import type { Card, GradeResult, TestRunQuestion } from "@/lib/types";
import { LOCAL_USER_ID } from "@/lib/constants";

/**
 * TestSession — free-text answer mode with local-embedding grading.
 *
 * Phase 2 seam: the `grader` ref holds a `Grader` instance.
 * To plug in an LLM grader, construct a different Grader implementation and
 * assign it. The UI code below only calls `grader.current.grade(...)`.
 *
 * A placeholder for a future "AI grade" button is included but disabled/no-op.
 */

interface Props {
  deckId: string;
}

type SessionPhase =
  | "loading"
  | "pick"
  | "question"
  | "grading"
  | "ambiguous"
  | "result"
  | "done";

const QUIZ_SIZES = [5, 10, 15, 20] as const;

/** Fisher-Yates sample — returns n unique items in random order. */
function sample<T>(arr: T[], n: number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export function TestSession({ deckId }: Props) {
  const { cards, testRuns } = useRepositories();

  // Phase 2 seam: swap grader implementation here.
  const grader = useRef(new EmbeddingGrader());

  const [pool, setPool] = useState<Card[]>([]); // full deck card pool
  const [queue, setQueue] = useState<Card[]>([]); // current run's random subset
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<SessionPhase>("loading");
  const [userAnswer, setUserAnswer] = useState("");
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(0);
  const [correct, setCorrect] = useState(0);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  // Accumulated per-question outcomes for the run; flushed to DB on completion.
  const questionLog = useRef<Omit<TestRunQuestion, "id" | "runId">[]>([]);
  // ISO timestamp of when the current run started.
  const runStartedAt = useRef<string>("");

  // "Add alternate answer" state — shown on incorrect/ambiguous result screens.
  const [addingAlternate, setAddingAlternate] = useState(false);
  const [alternateInput, setAlternateInput] = useState("");
  const [alternateSaving, setAlternateSaving] = useState(false);

  // Fetch ALL cards in the deck (no due-date filter) and go to count-selection.
  // Test mode is a random quiz over the full deck; due-date filtering belongs
  // to Study mode only.
  const load = useCallback(async () => {
    setPhase("loading");
    setGradeError(null);
    preloadEmbeddingModel();
    const all = await cards.getByDeck(deckId);
    setPool(all);
    setPhase("pick");
  }, [cards, deckId]);

  // Start a timed quiz with a fresh random subset of the pool.
  function startTest(count: number) {
    const selected = sample(pool, Math.min(count, pool.length));
    setQueue(selected);
    setCurrentIndex(0);
    setUserAnswer("");
    setGradeResult(null);
    setReviewed(0);
    setCorrect(0);
    questionLog.current = [];
    runStartedAt.current = new Date().toISOString();
    setPhase("question");
  }

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (phase === "question") {
      answerRef.current?.focus();
    }
  }, [phase, currentIndex]);

  const current = queue[currentIndex] ?? null;

  /** All accepted answers for the current card (primary + alternates). */
  function acceptedAnswers(card: Card): string[] {
    return [card.back, ...(card.alternateAnswers ?? [])];
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const answer = userAnswer.trim();
    if (!answer || !current) return;
    setPhase("grading");
    setGradeError(null);
    setModelLoading(true);
    try {
      const result = await grader.current.grade(
        current.front,
        acceptedAnswers(current),
        answer,
      );
      setGradeResult(result);
      if (result.outcome === "ambiguous") {
        setPhase("ambiguous");
      } else {
        setPhase("result");
        await persistGrade(result.outcome === "correct", result.similarity);
      }
    } catch (err) {
      // Log full stack so the trace is visible in Firefox DevTools console.
      // Check the Console tab (F12) for "EmbeddingGrader error:" immediately
      // after hitting Submit — the stack will show the exact throw site.
      console.error("EmbeddingGrader error:", err);
      const message = err instanceof Error ? err.message : String(err);
      setGradeError(message);
      setGradeResult({ outcome: "ambiguous" });
      setPhase("ambiguous");
    } finally {
      setModelLoading(false);
    }
  }

  async function persistGrade(isCorrect: boolean, similarity?: number) {
    if (!current) return;
    const rating = isCorrect ? "good" : "again";
    const nextState = scheduler.review(current.scheduling, rating);
    await cards.update(current.id, { scheduling: nextState });

    // Record this question outcome for history — "ambiguous" is never stored,
    // outcome is always the final resolved value.
    questionLog.current.push({
      cardId: current.id,
      cardFrontSnapshot: current.front,
      cardBackSnapshot: current.back,
      userAnswer,
      outcome: isCorrect ? "correct" : "incorrect",
      similarity,
    });

    setReviewed((r) => r + 1);
    if (isCorrect) setCorrect((c) => c + 1);
  }

  async function handleSelfGrade(isCorrect: boolean) {
    await persistGrade(isCorrect, gradeResult?.similarity);
    setPhase("result");
    setGradeResult((r) =>
      r ? { ...r, outcome: isCorrect ? "correct" : "incorrect" } : r,
    );
  }

  /** Save a completed run to history, then transition to the done screen. */
  async function finishRun() {
    const completedAt = new Date().toISOString();
    const log = questionLog.current;
    const correctCount = log.filter((q) => q.outcome === "correct").length;
    try {
      await testRuns.saveRun(
        {
          ownerId: LOCAL_USER_ID,
          deckId,
          startedAt: runStartedAt.current || completedAt,
          completedAt,
          questionCount: log.length,
          correctCount,
        },
        log,
      );
    } catch (err) {
      // History save failures are non-fatal — the user still sees the results.
      console.error("Failed to save test run:", err);
    }
    setPhase("done");
  }

  function advance() {
    // Reset "add alternate" state between questions.
    setAddingAlternate(false);
    setAlternateInput("");
    const next = currentIndex + 1;
    if (next >= queue.length) {
      finishRun();
    } else {
      setCurrentIndex(next);
      setUserAnswer("");
      setGradeResult(null);
      setPhase("question");
    }
  }

  /** Save a new alternate answer to the current card immediately. */
  async function handleSaveAlternate() {
    const alt = alternateInput.trim();
    if (!alt || !current) return;
    setAlternateSaving(true);
    try {
      const updated = await cards.update(current.id, {
        alternateAnswers: [...(current.alternateAnswers ?? []), alt],
      });
      // Patch the card in the queue so subsequent grading picks up the new alternate.
      setQueue((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      // Also patch the pool so future runs include it.
      setPool((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setAlternateInput("");
      setAddingAlternate(false);
    } catch (err) {
      console.error("Failed to save alternate answer:", err);
    } finally {
      setAlternateSaving(false);
    }
  }

  if (phase === "loading") {
    return <div className="p-8 text-neutral-500">Loading…</div>;
  }

  return (
    <div className="max-w-xl mx-auto py-10 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Test mode</h2>
        {(phase === "question" ||
          phase === "grading" ||
          phase === "ambiguous" ||
          phase === "result") && (
          <span className="text-sm text-neutral-400">
            {currentIndex + 1} / {queue.length}
          </span>
        )}
      </div>

      {/* Count-selection screen */}
      {phase === "pick" && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 space-y-6">
          {pool.length === 0 ? (
            <p className="text-center text-neutral-500">
              No cards in this deck yet.
            </p>
          ) : pool.length < 5 ? (
            <p className="text-center text-neutral-500">
              Only {pool.length} card{pool.length !== 1 ? "s" : ""} in this deck
              — need at least 5 for a quiz. Add more cards to get started.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <p className="font-semibold text-center">How many questions?</p>
                <p className="text-xs text-center text-neutral-400">
                  {pool.length} card{pool.length !== 1 ? "s" : ""} available
                </p>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {QUIZ_SIZES.map((n) => {
                  const disabled = n > pool.length;
                  return (
                    <button
                      key={n}
                      onClick={() => startTest(n)}
                      disabled={disabled}
                      className={`rounded-lg border py-3 text-sm font-semibold transition-colors
                        ${
                          disabled
                            ? "border-neutral-200 dark:border-neutral-700 text-neutral-300 dark:text-neutral-600 cursor-not-allowed"
                            : "border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950"
                        }`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="pt-2 text-center">
            <Link
              href={`/decks/${deckId}`}
              className="text-sm text-neutral-400 hover:text-neutral-700 transition-colors"
            >
              ← Back to deck
            </Link>
          </div>
        </div>
      )}

      {/* Results screen */}
      {phase === "done" && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 text-center space-y-4">
          <p className="text-2xl">🎉</p>
          <p className="font-semibold text-lg">
            {correct} / {queue.length} correct
          </p>
          <p className="text-sm text-neutral-500">
            {correct === queue.length
              ? "Perfect score!"
              : correct === 0
                ? "Keep practising — you'll get there."
                : "Good effort. Try again to improve your score."}
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <button
              onClick={() => setPhase("pick")}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
            >
              New test
            </button>
            <Link
              href={`/decks/${deckId}`}
              className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Back to deck
            </Link>
          </div>
        </div>
      )}

      {/* Question + answer input */}
      {(phase === "question" || phase === "grading") && current && (
        <div className="space-y-4">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 min-h-[120px] flex items-center justify-center text-center">
            <p className="text-lg whitespace-pre-wrap">{current.front}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <textarea
              ref={answerRef}
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              rows={3}
              placeholder="Type your answer…"
              disabled={phase === "grading"}
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none disabled:opacity-60"
            />
            <div className="flex gap-3 items-center">
              <button
                type="submit"
                disabled={phase === "grading" || !userAnswer.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                {phase === "grading"
                  ? modelLoading
                    ? "Loading model…"
                    : "Grading…"
                  : "Submit"}
              </button>

              {/*
               * PHASE 2 PLACEHOLDER — AI grader button.
               * Disabled / no-op in Phase 1. In Phase 2: construct an
               * LlmGrader (implements Grader) and assign it to grader.current,
               * then call handleSubmit programmatically.
               */}
              <button
                type="button"
                disabled
                title="AI grading — coming in Phase 2"
                className="rounded-lg border border-neutral-200 dark:border-neutral-700 px-4 py-2 text-sm text-neutral-400 opacity-40 cursor-not-allowed"
              >
                AI grade (Phase 2)
              </button>
            </div>
          </form>

          {phase === "grading" && modelLoading && (
            <p className="text-xs text-neutral-400">
              Loading embedding model for the first time — this takes ~10 s and
              is cached for the rest of the session.
            </p>
          )}
        </div>
      )}

      {/* Ambiguous band — self-grade */}
      {phase === "ambiguous" && current && (
        <div className="space-y-4">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 space-y-3">
            <p className="text-xs uppercase tracking-wide text-neutral-400 font-semibold">
              Question
            </p>
            <p className="whitespace-pre-wrap">{current.front}</p>
          </div>

          {/* Show grader error if the embedding model failed to load */}
          {gradeError && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 space-y-1">
              <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                Embedding model error — please self-grade
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 font-mono break-all">
                {gradeError}
              </p>
            </div>
          )}

          <div className="rounded-xl border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950 p-6 space-y-4">
            <p className="text-xs uppercase tracking-wide text-yellow-600 dark:text-yellow-400 font-semibold">
              {gradeError
                ? "Self-grade (model unavailable)"
                : "Needs self-assessment"}
              {!gradeError && gradeResult?.similarity !== undefined && (
                <span className="ml-2 font-normal">
                  (similarity: {(gradeResult.similarity * 100).toFixed(0)}%)
                </span>
              )}
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-neutral-500">
                  Your answer
                </p>
                <p className="text-sm whitespace-pre-wrap">{userAnswer}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-neutral-500">
                  Correct answer
                </p>
                <p className="text-sm whitespace-pre-wrap">{current.back}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => handleSelfGrade(true)}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 transition-colors"
              >
                I was correct
              </button>
              <button
                onClick={() => handleSelfGrade(false)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition-colors"
              >
                I was wrong
              </button>
            </div>

            {/* Add alternate answer affordance — optional, never blocking */}
            {!addingAlternate ? (
              <button
                type="button"
                onClick={() => {
                  setAddingAlternate(true);
                  setAlternateInput(userAnswer);
                }}
                className="text-xs text-neutral-400 hover:text-indigo-600 transition-colors underline"
              >
                My phrasing should also be accepted — add as alternate answer
              </button>
            ) : (
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={alternateInput}
                  onChange={(e) => setAlternateInput(e.target.value)}
                  placeholder="Alternate accepted phrasing…"
                  className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={handleSaveAlternate}
                  disabled={!alternateInput.trim() || alternateSaving}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {alternateSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingAlternate(false);
                    setAlternateInput("");
                  }}
                  className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Result reveal */}
      {phase === "result" && current && gradeResult && (
        <div className="space-y-4">
          <div
            className={`rounded-xl border p-6 space-y-3 ${
              gradeResult.outcome === "correct"
                ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950"
                : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950"
            }`}
          >
            <p
              className={`text-sm font-semibold ${
                gradeResult.outcome === "correct"
                  ? "text-green-700 dark:text-green-300"
                  : "text-red-700 dark:text-red-300"
              }`}
            >
              {gradeResult.outcome === "correct" ? "✓ Correct" : "✗ Incorrect"}
              {gradeResult.similarity !== undefined && (
                <span className="ml-2 font-normal text-xs opacity-70">
                  ({(gradeResult.similarity * 100).toFixed(0)}% similarity)
                </span>
              )}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-neutral-500">
                  Your answer
                </p>
                <p className="text-sm whitespace-pre-wrap">{userAnswer}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-neutral-500">
                  Correct answer
                </p>
                <p className="text-sm whitespace-pre-wrap">{current.back}</p>
              </div>
            </div>
          </div>

          {/* Add alternate answer — only shown on incorrect results */}
          {gradeResult.outcome === "incorrect" && (
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 px-4 py-3">
              {!addingAlternate ? (
                <button
                  type="button"
                  onClick={() => {
                    setAddingAlternate(true);
                    setAlternateInput(userAnswer);
                  }}
                  className="text-xs text-neutral-400 hover:text-indigo-600 transition-colors underline"
                >
                  My phrasing should also be accepted — add as alternate answer
                </button>
              ) : (
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={alternateInput}
                    onChange={(e) => setAlternateInput(e.target.value)}
                    placeholder="Alternate accepted phrasing…"
                    className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleSaveAlternate}
                    disabled={!alternateInput.trim() || alternateSaving}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                  >
                    {alternateSaving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingAlternate(false);
                      setAlternateInput("");
                    }}
                    className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            onClick={advance}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            Next →
          </button>
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
