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
import { useAuth } from "@/components/providers/AuthProvider";
import { scheduler } from "@/lib/scheduler";
import {
  EmbeddingGrader,
  preloadEmbeddingModel,
} from "@/lib/grading/EmbeddingGrader";
import type { Card, GradeResult, TestRunQuestion } from "@/lib/types";

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
  const { ownerId } = useAuth();

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
          ownerId,
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
    return <div className="p-8 text-ink-3">Loading…</div>;
  }

  const missed = reviewed - correct;

  return (
    <div className="w-full max-w-xl mx-auto py-10 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-title">Test mode</h2>
        {(phase === "question" ||
          phase === "grading" ||
          phase === "ambiguous" ||
          phase === "result") && (
          <span className="text-stat text-ink-2">
            {currentIndex + 1} / {queue.length}
          </span>
        )}
      </div>
      {(phase === "question" ||
        phase === "grading" ||
        phase === "ambiguous" ||
        phase === "result") && (
        <div className="h-1 rounded-pill bg-surface-2 overflow-hidden -mt-2">
          <div
            className="h-full rounded-pill bg-accent transition-all"
            style={{ width: `${(currentIndex / queue.length) * 100}%` }}
          />
        </div>
      )}

      {/* Count-selection screen */}
      {phase === "pick" && (
        <div className="rounded-card border border-line bg-surface-1 p-8 space-y-6">
          {pool.length === 0 ? (
            <p className="text-center text-meta text-ink-3">
              No cards in this deck yet.
            </p>
          ) : pool.length < 5 ? (
            <p className="text-center text-meta text-ink-3">
              Only {pool.length} card{pool.length !== 1 ? "s" : ""} in this deck
              — need at least 5 for a quiz. Add more cards to get started.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-micro text-ink-3 uppercase tracking-wide text-center">
                  How many questions?
                </p>
                <p className="text-meta text-center text-ink-3">
                  {pool.length} card{pool.length !== 1 ? "s" : ""} available
                </p>
              </div>
              <div className="flex bg-surface-2 border border-line rounded-control p-1 gap-1">
                {QUIZ_SIZES.map((n) => {
                  const disabled = n > pool.length;
                  return (
                    <button
                      key={n}
                      onClick={() => startTest(n)}
                      disabled={disabled}
                      className={`flex-1 rounded-control py-3 text-button transition-colors
                        ${
                          disabled
                            ? "text-ink-3 cursor-not-allowed opacity-50"
                            : "text-ink-2 hover:bg-surface-3"
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
              className="text-meta text-ink-3 hover:text-ink-1 transition-colors"
            >
              ← Back to deck
            </Link>
          </div>
        </div>
      )}

      {/* Results screen */}
      {phase === "done" && (
        <div className="space-y-6">
          <div className="rounded-card border border-line bg-surface-1 p-8 text-center space-y-3">
            <p className="text-big-score text-ink-1">
              {correct}
              <span className="text-ink-3">/{queue.length}</span>
            </p>
            <p className="text-meta text-ink-2">
              {correct === queue.length
                ? "Perfect score!"
                : correct === 0
                  ? "Keep practising — you'll get there."
                  : "Good effort. Try again to improve your score."}
            </p>
            <div className="h-1.5 rounded-pill bg-surface-2 overflow-hidden mx-1">
              <div
                className="h-full rounded-pill bg-accent"
                style={{
                  width: `${queue.length > 0 ? (correct / queue.length) * 100 : 0}%`,
                }}
              />
            </div>
          </div>

          <div className="flex gap-2.5">
            <div className="flex-1 rounded-row border border-line bg-surface-1 p-4 text-center">
              <p className="text-title text-correct">{correct}</p>
              <p className="text-micro text-ink-3 mt-1">Correct</p>
            </div>
            <div className="flex-1 rounded-row border border-line bg-surface-1 p-4 text-center">
              <p className="text-title text-incorrect">{missed}</p>
              <p className="text-micro text-ink-3 mt-1">Missed</p>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              onClick={() => setPhase("pick")}
              className="text-button rounded-control bg-accent text-on-accent py-3 hover:opacity-90 transition-opacity"
            >
              Test again
            </button>
            <Link
              href={`/decks/${deckId}`}
              className="text-button rounded-control border border-line-2 text-ink-2 py-3 text-center hover:bg-surface-2 transition-colors"
            >
              Back to deck
            </Link>
          </div>
        </div>
      )}

      {/* Question + answer input */}
      {(phase === "question" || phase === "grading") && current && (
        <div className="space-y-4">
          <div className="rounded-card bg-surface-1 border border-line p-6 min-h-[120px] flex items-center">
            <p className="text-card-front text-ink-1 whitespace-pre-wrap">
              {current.front}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex gap-2">
              <textarea
                ref={answerRef}
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                rows={2}
                placeholder="Type your answer…"
                disabled={phase === "grading"}
                className="flex-1 rounded-control bg-surface-2 border border-line-2 px-4 py-3 text-base text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent resize-none disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={phase === "grading" || !userAnswer.trim()}
                className="text-button rounded-control bg-accent text-on-accent px-5 hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {phase === "grading" ? "…" : "→"}
              </button>
            </div>

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
              className="text-meta rounded-control border border-line text-ink-3 px-4 py-2 opacity-50 cursor-not-allowed"
            >
              AI grade (Phase 2)
            </button>
          </form>

          {phase === "grading" && modelLoading && (
            <p className="text-meta text-ink-3 text-center">
              Loading embedding model for the first time — this takes ~10 s and
              is cached for the rest of the session.
            </p>
          )}
        </div>
      )}

      {/* Ambiguous band — self-grade */}
      {phase === "ambiguous" && current && (
        <div className="space-y-4">
          <div className="rounded-card bg-surface-1 border border-line p-6">
            <p className="text-card-front text-ink-1 whitespace-pre-wrap">
              {current.front}
            </p>
          </div>

          {/* Show grader error if the embedding model failed to load */}
          {gradeError && (
            <div className="rounded-control border border-incorrect-soft bg-incorrect-soft px-4 py-3 space-y-1">
              <p className="text-micro text-incorrect font-semibold">
                Embedding model error — please self-grade
              </p>
              <p className="text-micro text-incorrect font-mono break-all">
                {gradeError}
              </p>
            </div>
          )}

          <div className="rounded-card border border-self-grade-soft bg-self-grade-soft p-6 space-y-4">
            <p className="text-micro text-self-grade font-semibold">
              {gradeError
                ? "Self-grade (model unavailable)"
                : "Your call"}
              {!gradeError && gradeResult?.similarity !== undefined && (
                <span className="ml-2 font-normal opacity-80">
                  (similarity: {(gradeResult.similarity * 100).toFixed(0)}%)
                </span>
              )}
            </p>

            <p className="text-meta text-ink-2">
              You wrote <b className="text-ink-1 font-semibold">{userAnswer}</b>
            </p>
            <p className="text-meta text-ink-2">
              Accepted{" "}
              <b className="text-ink-1 font-semibold">{current.back}</b>
            </p>

            <div className="flex gap-2.5">
              <button
                onClick={() => handleSelfGrade(false)}
                className="flex-1 rounded-control border border-incorrect-soft bg-incorrect-soft text-incorrect py-3.5 text-button"
              >
                Missed it
              </button>
              <button
                onClick={() => handleSelfGrade(true)}
                className="flex-1 rounded-control border border-correct-soft bg-correct-soft text-correct py-3.5 text-button"
              >
                Got it
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
                className="w-full text-meta text-accent-hi border border-dashed border-line-2 rounded-control px-3 py-2.5 hover:bg-surface-2 transition-colors"
              >
                Accept &ldquo;{userAnswer}&rdquo; for this card
              </button>
            ) : (
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={alternateInput}
                  onChange={(e) => setAlternateInput(e.target.value)}
                  placeholder="Alternate accepted phrasing…"
                  className="flex-1 rounded-control bg-surface-1 border border-line-2 px-3 py-2 text-meta text-ink-1 focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button
                  type="button"
                  onClick={handleSaveAlternate}
                  disabled={!alternateInput.trim() || alternateSaving}
                  className="text-micro rounded-control bg-accent text-on-accent px-3 py-2 hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {alternateSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingAlternate(false);
                    setAlternateInput("");
                  }}
                  className="text-micro text-ink-3 hover:text-ink-1 transition-colors"
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
          <div className="rounded-card bg-surface-1 border border-line p-6">
            <p className="text-card-front text-ink-1 whitespace-pre-wrap">
              {current.front}
            </p>
          </div>

          <div
            className={`rounded-card p-5 space-y-2.5 ${
              gradeResult.outcome === "correct"
                ? "bg-correct-soft"
                : "bg-incorrect-soft"
            }`}
          >
            <p
              className={`flex items-center gap-2 text-button ${
                gradeResult.outcome === "correct"
                  ? "text-correct"
                  : "text-incorrect"
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[13px] text-on-semantic ${
                  gradeResult.outcome === "correct"
                    ? "bg-correct"
                    : "bg-incorrect"
                }`}
              >
                {gradeResult.outcome === "correct" ? "✓" : "✕"}
              </span>
              {gradeResult.outcome === "correct" ? "Correct" : "Not quite"}
              {gradeResult.similarity !== undefined && (
                <span className="font-normal text-micro opacity-70">
                  ({(gradeResult.similarity * 100).toFixed(0)}% similarity)
                </span>
              )}
            </p>
            <p className="text-meta text-ink-2">
              You wrote <b className="text-ink-1 font-semibold">{userAnswer}</b>
            </p>
            <p className="text-meta text-ink-2">
              Answer <b className="text-ink-1 font-semibold">{current.back}</b>
            </p>

            {/* Add alternate answer — only shown on incorrect results */}
            {gradeResult.outcome === "incorrect" &&
              (!addingAlternate ? (
                <button
                  type="button"
                  onClick={() => {
                    setAddingAlternate(true);
                    setAlternateInput(userAnswer);
                  }}
                  className="w-full text-meta text-accent-hi border border-dashed border-line-2 rounded-control px-3 py-2.5 hover:bg-surface-2 transition-colors"
                >
                  Accept &ldquo;{userAnswer}&rdquo; for this card
                </button>
              ) : (
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={alternateInput}
                    onChange={(e) => setAlternateInput(e.target.value)}
                    placeholder="Alternate accepted phrasing…"
                    className="flex-1 rounded-control bg-surface-1 border border-line-2 px-3 py-2 text-meta text-ink-1 focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    type="button"
                    onClick={handleSaveAlternate}
                    disabled={!alternateInput.trim() || alternateSaving}
                    className="text-micro rounded-control bg-accent text-on-accent px-3 py-2 hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {alternateSaving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingAlternate(false);
                      setAlternateInput("");
                    }}
                    className="text-micro text-ink-3 hover:text-ink-1 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ))}
          </div>

          <button
            onClick={advance}
            className="w-full text-button rounded-control bg-accent text-on-accent py-3.5 hover:opacity-90 transition-opacity"
          >
            Next →
          </button>
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
