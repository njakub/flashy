"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import Link from "next/link";
import { useRepositories } from "@/components/providers/RepositoryProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { useSettings } from "@/components/providers/SettingsProvider";
import { scheduler } from "@/lib/scheduler";
import {
  EmbeddingGrader,
  preloadEmbeddingModel,
} from "@/lib/grading/EmbeddingGrader";
import { LlmGrader } from "@/lib/grading/LlmGrader";
import { CodeAwareGrader } from "@/lib/grading/CodeAwareGrader";
import { ConceptAwareGrader } from "@/lib/grading/ConceptAwareGrader";
import { useThresholdPrefs } from "@/lib/grading/useThresholdPrefs";
import type { Grader } from "@/lib/grading/Grader";
import { FLAGGED_LABEL, randomSuccessMessage } from "@/lib/constants";
import { distinctLabels } from "@/lib/testHistory";
import { hasCodeFence } from "@/lib/content/markdown";
import { isConceptCard } from "@/lib/content/concept";
import { LabelChips } from "@/components/LabelChips";
import { CardContent } from "@/components/CardContent";
import { SpeakButton } from "@/components/SpeakButton";
import { webSpeechSpeaker } from "@/lib/speech/WebSpeechSpeaker";
import { useTranscriber } from "@/lib/speech/useTranscriber";
import type { GradingDefault } from "@/lib/settings/wire";
import type { Card, GradeResult, TestRunQuestion } from "@/lib/types";

/**
 * TestSession — free-text answer mode, gradeable two ways: the local
 * on-device embedding grader (free, works offline) or the AI grader (taps
 * flashy-api's POST /grade, which proxies to Claude — requires sign-in,
 * only fires when the user taps a button). Both implement the same `Grader`
 * interface, so the shared resolution tail and the downstream outcome/
 * history flow don't care which one produced a result.
 *
 * When the account's default grading method is "ai" (set on /profile), the
 * primary submit runs a cascade instead of the plain embedding grader: try
 * the free local model first, and only skip Claude when it's confidently
 * correct — ambiguous, outright "incorrect", and outright grader failures
 * all escalate, since a single embedding score isn't trusted to mark an
 * answer wrong on its own. An LLM-confirmed correct answer is auto-saved as
 * an accepted alternate on the card, together with the AI's justification,
 * so the same phrasing grades for free (with the same message) next time.
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

/**
 * Fills in a success message on a correct result that doesn't already carry
 * one (i.e. wasn't produced by the LLM, which supplies its own rationale):
 * the stored justification for the matched answer if the card has one,
 * otherwise a random generic message. No-op on non-correct outcomes and
 * when a rationale is already present.
 */
function withSuccessMessage(card: Card, result: GradeResult): GradeResult {
  if (result.outcome !== "correct" || result.rationale) return result;
  const stored =
    result.matchedAnswer && card.answerJustifications?.[result.matchedAnswer];
  return { ...result, rationale: stored || randomSuccessMessage() };
}

/**
 * Voice input runs an on-device Whisper model through onnxruntime-web's WASM
 * backend. On some mobile browsers (notably Android Firefox) that backend
 * can't build an inference session for the quantized model and throws a raw
 * ONNX graph dump ("Can't create a session … TransposeDQWeightsForMatMulNBits
 * Missing required scale …"). That's meaningless to a user, so collapse any
 * session-creation failure into a plain explanation; other errors (e.g. a
 * denied mic permission) pass through unchanged.
 */
function friendlyMicError(raw: string): string {
  if (
    /can't create a session|MatMulNBits|DequantizeLinear|InferenceSession|no available backend/i.test(
      raw,
    )
  ) {
    return "Voice input isn't supported in this browser — the on-device speech model couldn't load here. Try Chrome, or type your answer instead.";
  }
  return raw;
}

export function TestSession({ deckId }: Props) {
  const { cards, testRuns } = useRepositories();
  const { ownerId, status, getAccessToken } = useAuth();
  const { gradingDefault } = useSettings();
  const { preset: thresholdPreset } = useThresholdPrefs();
  const isSignedIn = status === "signedIn";

  // Read once at mount (device-local strictness preset — see
  // useThresholdPrefs); a change made on /profile takes effect the next
  // time Test mode is entered, same lifetime as the grader instances below.
  const embeddingGrader = useRef(
    new EmbeddingGrader(thresholdPreset.passThreshold, thresholdPreset.failThreshold),
  );
  // Guards embeddingGrader with a code-aware pre-check (§B4): cosine
  // similarity over natural-language embeddings isn't trustworthy for code,
  // so a fenced-code card short-circuits straight to normalized exact-match
  // or self-grade, never trusting a single embedding score to fail it. Only
  // wraps the local grader — the LLM cascade below is already competent at
  // code equivalence. ConceptAwareGrader wraps OUTERMOST: a concept card
  // (long-form, graded against a key-points rubric) always defers to
  // self-grade/AI rather than either heuristic, even if its answer happens
  // to contain a code fence.
  const localGrader = useRef<Grader>(
    new ConceptAwareGrader(new CodeAwareGrader(embeddingGrader.current)),
  );
  const llmGrader = useRef(new LlmGrader(getAccessToken));
  // Snapshot of the account's grading preference for the run in progress —
  // set once when a quiz starts, not read live, so a preference change on
  // another device mid-run can't switch behavior under the user. State (not
  // a ref) because it also drives what the question screen renders (the
  // standalone AI grade button is redundant — and hidden — once the primary
  // submit is already running the cascade).
  const [sessionGradingMode, setSessionGradingMode] =
    useState<GradingDefault>("local");
  // Whether the primary submit is already running the AI-assisted cascade
  // for this session — when true, the separate "AI grade" button (and its
  // ambiguous-band tiebreaker) are redundant and hidden.
  const cascadeActive = isSignedIn && sessionGradingMode === "ai";

  const [pool, setPool] = useState<Card[]>([]); // full deck card pool
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [queue, setQueue] = useState<Card[]>([]); // current run's random subset
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<SessionPhase>("loading");
  const [userAnswer, setUserAnswer] = useState("");
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  // Which grader produced the in-flight "grading" phase, if any — drives the
  // loading copy and which button shows a spinner state.
  const [activeGrader, setActiveGrader] = useState<"local" | "ai" | null>(
    null,
  );
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(0);
  const [correct, setCorrect] = useState(0);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  // Voice input (§D) — transcript lands directly in userAnswer, editable in
  // the same textarea before submit, so the grading pipeline below is
  // entirely unchanged by this.
  const transcriber = useTranscriber();
  const [micError, setMicError] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  useEffect(() => {
    if (transcriber.state !== "recording") return;
    const id = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [transcriber.state]);

  async function handleMicClick() {
    setMicError(null);
    if (transcriber.state === "idle") {
      setRecordingSeconds(0);
      try {
        await transcriber.start();
      } catch (err) {
        setMicError(
          friendlyMicError(
            err instanceof Error ? err.message : "Microphone access failed.",
          ),
        );
      }
    } else if (transcriber.state === "recording") {
      try {
        const text = await transcriber.stop();
        if (text) setUserAnswer(text);
      } catch (err) {
        setMicError(
          friendlyMicError(
            err instanceof Error ? err.message : "Transcription failed.",
          ),
        );
      }
    }
  }

  // Accumulated per-question outcomes for the run; flushed to DB on completion.
  const questionLog = useRef<Omit<TestRunQuestion, "id" | "runId">[]>([]);
  // ISO timestamp of when the current run started.
  const runStartedAt = useRef<string>("");

  // "Add alternate answer" state — shown on incorrect/ambiguous result screens.
  const [addingAlternate, setAddingAlternate] = useState(false);
  const [alternateInput, setAlternateInput] = useState("");
  const [alternateSaving, setAlternateSaving] = useState(false);

  // Concept-card self-grade checklist — transient, index-aligned with
  // current.keyPoints. Reset between questions/runs in advance()/startTest().
  const [checkedPoints, setCheckedPoints] = useState<boolean[]>([]);

  const labelOptions = distinctLabels(pool);
  const filteredPool =
    selectedLabels.length > 0
      ? pool.filter((c) => c.labels.some((l) => selectedLabels.includes(l)))
      : pool;

  function toggleLabel(label: string) {
    setSelectedLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  }

  // Start a timed quiz with a fresh random subset of the (label-filtered) pool.
  function startTest(count: number) {
    const selected = sample(filteredPool, Math.min(count, filteredPool.length));
    setQueue(selected);
    setCurrentIndex(0);
    setUserAnswer("");
    setGradeResult(null);
    setReviewed(0);
    setCorrect(0);
    setCheckedPoints([]);
    setMicError(null);
    questionLog.current = [];
    runStartedAt.current = new Date().toISOString();
    setSessionGradingMode(gradingDefault);
    setPhase("question");
  }

  // Fetch ALL cards in the deck (no due-date filter) and go to count-selection.
  // Test mode is a random quiz over the full deck; due-date filtering belongs
  // to Study mode only.
  useEffect(() => {
    async function load() {
      setPhase("loading");
      setGradeError(null);
      preloadEmbeddingModel();
      const all = await cards.getByDeck(deckId);
      setPool(all);
      setPhase("pick");
    }
    void load();
  }, [cards, deckId]);

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

  /**
   * Appends `text` to the current card's accepted answers, storing an AI
   * justification alongside it when provided. Used both by the grading
   * cascade (auto-accept on LLM-correct) and the manual "Accept … for this
   * card" affordance.
   */
  async function addAcceptedAnswer(text: string, justification?: string) {
    if (!current) return;
    const trimmed = text.trim();
    if (!trimmed || acceptedAnswers(current).includes(trimmed)) return;
    try {
      const updated = await cards.update(current.id, {
        alternateAnswers: [...(current.alternateAnswers ?? []), trimmed],
        ...(justification
          ? {
              answerJustifications: {
                ...(current.answerJustifications ?? {}),
                [trimmed]: justification,
              },
            }
          : {}),
      });
      // Patch the card in the queue so subsequent grading picks it up.
      setQueue((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      // Also patch the pool so future runs include it.
      setPool((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      console.error("Failed to save accepted answer:", err);
    }
  }

  /**
   * Shared tail for every grading entry point (local submit, AI button,
   * ambiguous tiebreaker, cascade) once a grader has produced a resolved
   * (non-ambiguous) result: auto-accepts the typed answer when the LLM
   * confirms it's correct, fills in a success message when one isn't
   * already present, and persists through the usual outcome/history flow.
   */
  async function resolveGrade(result: GradeResult, source: "local" | "ai") {
    if (!current) return;
    // Never auto-accept a whole long-form paragraph as a card "alternate
    // answer" — that affordance only makes sense for short accepted-answer
    // cards.
    if (
      source === "ai" &&
      result.outcome === "correct" &&
      !isConceptCard(current)
    ) {
      await addAcceptedAnswer(userAnswer.trim(), result.rationale);
    }
    const finalResult = withSuccessMessage(current, result);
    setGradeResult(finalResult);
    setPhase("result");
    await persistGrade(finalResult.outcome === "correct", finalResult.similarity);
  }

  /**
   * Grades the current typed answer with whichever Grader is passed in.
   * Shared by the local Grade submit, the top-level AI Grade button, and the
   * AI-grade tiebreaker in the ambiguous band.
   */
  async function submitAnswer(grader: Grader, source: "local" | "ai") {
    const answer = userAnswer.trim();
    if (!answer || !current) return;
    setPhase("grading");
    setGradeError(null);
    setActiveGrader(source);
    try {
      const result = await grader.grade(
        current.front,
        acceptedAnswers(current),
        answer,
        current.keyPoints,
      );
      if (result.outcome === "ambiguous") {
        setGradeResult(result);
        setPhase("ambiguous");
      } else {
        await resolveGrade(result, source);
      }
    } catch (err) {
      // Log full stack so the trace is visible in Firefox DevTools console.
      // Check the Console tab (F12) for the "... error:" line immediately
      // after grading — the stack will show the exact throw site.
      console.error(
        `${source === "ai" ? "LlmGrader" : "EmbeddingGrader"} error:`,
        err,
      );
      const message = err instanceof Error ? err.message : String(err);
      setGradeError(message);
      setGradeResult({ outcome: "ambiguous" });
      setPhase("ambiguous");
    } finally {
      setActiveGrader(null);
    }
  }

  /**
   * "AI-assisted" default: try the free embedding grader first; only skip
   * the LLM when it's confidently "correct". Anything else — "ambiguous",
   * an outright "incorrect", or the local model itself failing to load/run
   * — escalates to Claude. A single embedding score is not trusted to mark
   * an answer wrong on its own (cosine similarity systematically penalizes
   * short-but-correct answers against long explanatory accepted answers),
   * so only a confident match gets to skip the second opinion. Falls back
   * to the manual self-grade band if the LLM call also fails — same
   * graceful-degradation shape as submitAnswer.
   */
  async function runCascade() {
    const answer = userAnswer.trim();
    if (!answer || !current) return;
    setPhase("grading");
    setGradeError(null);
    setActiveGrader("local");

    let embeddingResult: GradeResult | null = null;
    try {
      embeddingResult = await localGrader.current.grade(
        current.front,
        acceptedAnswers(current),
        answer,
        current.keyPoints,
      );
    } catch (err) {
      console.error("EmbeddingGrader error (cascade):", err);
      // embeddingResult stays null — falls through to LLM escalation below,
      // same as a non-"correct" embedding result would.
    }

    if (embeddingResult && embeddingResult.outcome === "correct") {
      await resolveGrade(embeddingResult, "local");
      setActiveGrader(null);
      return;
    }

    // Ambiguous, outright "incorrect", or the embedding grader itself
    // failed — escalate to Claude rather than trust a single local score.
    setActiveGrader("ai");
    try {
      const aiResult = await llmGrader.current.grade(
        current.front,
        acceptedAnswers(current),
        answer,
        current.keyPoints,
      );
      if (aiResult.outcome === "ambiguous") {
        setGradeResult(aiResult);
        setPhase("ambiguous");
      } else {
        await resolveGrade(aiResult, "ai");
      }
    } catch (err) {
      console.error("LlmGrader error (cascade):", err);
      const message = err instanceof Error ? err.message : String(err);
      setGradeError(message);
      setGradeResult(embeddingResult ?? { outcome: "ambiguous" });
      setPhase("ambiguous");
    } finally {
      setActiveGrader(null);
    }
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    if (cascadeActive) {
      void runCascade();
    } else {
      void submitAnswer(localGrader.current, "local");
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
    setGradeResult((r) => {
      if (!r) return r;
      const updated: GradeResult = {
        ...r,
        outcome: isCorrect ? "correct" : "incorrect",
        // Fold the self-grade checklist into the same coverage shape the AI
        // cascade produces, so the result screen renders identically either
        // way.
        ...(current && isConceptCard(current)
          ? {
              coverage: (current.keyPoints ?? []).map((point, i) => ({
                point,
                covered: checkedPoints[i] ?? false,
              })),
            }
          : {}),
      };
      return current ? withSuccessMessage(current, updated) : updated;
    });
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
    webSpeechSpeaker.cancel(); // never let read-aloud audio outlive its card
    transcriber.cancel(); // ditto for a stray in-progress recording
    // Reset "add alternate" state between questions.
    setAddingAlternate(false);
    setAlternateInput("");
    setCheckedPoints([]);
    setMicError(null); // a mic error from this card shouldn't linger onto the next
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

  const isFlagged = current?.labels.includes(FLAGGED_LABEL) ?? false;

  async function toggleFlag() {
    if (!current) return;
    const labels = isFlagged
      ? current.labels.filter((l) => l !== FLAGGED_LABEL)
      : [...current.labels, FLAGGED_LABEL];
    const updated = await cards.update(current.id, { labels });
    setQueue((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setPool((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  // Keyboard-first review: Enter advances past the result screen (the
  // question form already submits on Enter via its own onSubmit). Ignored
  // while typing in the "accept as alternate" input so Enter there doesn't
  // accidentally skip the question mid-edit.
  useEffect(() => {
    if (phase !== "result") return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        return;
      if (e.key === "Enter") {
        e.preventDefault();
        advance();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /** Save a new alternate answer to the current card immediately. */
  async function handleSaveAlternate() {
    const alt = alternateInput.trim();
    if (!alt) return;
    setAlternateSaving(true);
    await addAcceptedAnswer(alt);
    setAlternateInput("");
    setAddingAlternate(false);
    setAlternateSaving(false);
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
          {labelOptions.length > 0 && (
            <LabelChips
              labels={labelOptions}
              selected={selectedLabels}
              onToggle={toggleLabel}
            />
          )}
          {pool.length === 0 ? (
            <p className="text-center text-meta text-ink-3">
              No cards in this deck yet.
            </p>
          ) : filteredPool.length === 0 ? (
            <p className="text-center text-meta text-ink-3">
              No cards match the selected labels.
            </p>
          ) : filteredPool.length < 5 ? (
            <p className="text-center text-meta text-ink-3">
              Only {filteredPool.length} card
              {filteredPool.length !== 1 ? "s" : ""}{" "}
              {selectedLabels.length > 0 ? "match the selected labels" : "in this deck"}
              — need at least 5 for a quiz.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-micro text-ink-3 uppercase tracking-wide text-center">
                  How many questions?
                </p>
                <p className="text-meta text-center text-ink-3">
                  {filteredPool.length} card{filteredPool.length !== 1 ? "s" : ""} available
                </p>
              </div>
              <div className="flex bg-surface-2 border border-line rounded-control p-1 gap-1">
                {QUIZ_SIZES.map((n) => {
                  const disabled = n > filteredPool.length;
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
            <CardContent
              text={current.front}
              className="text-card-front text-ink-1 flex-1"
            />
          </div>

          {cascadeActive && (
            <p className="text-micro text-accent-hi">
              AI-assisted grading is on — Claude reviews anything the free
              local check doesn&apos;t confidently mark correct.
            </p>
          )}

          <form onSubmit={handleFormSubmit} className="space-y-3">
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
              {transcriber.supported && (
                <button
                  type="button"
                  onClick={() => void handleMicClick()}
                  disabled={
                    phase === "grading" ||
                    transcriber.state === "requesting" ||
                    transcriber.state === "transcribing"
                  }
                  title="Voice input — transcribed on your device, audio never leaves your browser"
                  className={`text-button rounded-control px-4 border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    transcriber.state === "recording"
                      ? "bg-incorrect-soft border-incorrect-soft text-incorrect animate-pulse"
                      : "border-line-2 text-ink-2 hover:bg-surface-2"
                  }`}
                >
                  {transcriber.state === "recording"
                    ? `⏹ ${recordingSeconds}s`
                    : transcriber.state === "requesting"
                      ? "…"
                      : transcriber.state === "transcribing"
                        ? "…"
                        : "🎤"}
                </button>
              )}
              <button
                type="submit"
                disabled={phase === "grading" || !userAnswer.trim()}
                className="text-button rounded-control bg-accent text-on-accent px-5 hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {activeGrader !== null ? "…" : "→"}
              </button>
            </div>

            {transcriber.state === "recording" &&
              transcriber.modelProgress !== null &&
              transcriber.modelProgress < 100 && (
                <p className="text-meta text-ink-3 text-center">
                  Loading voice model in the background… {transcriber.modelProgress}%
                </p>
              )}
            {transcriber.state === "transcribing" && (
              <p className="text-meta text-ink-3 text-center">
                {transcriber.modelProgress !== null && transcriber.modelProgress < 100
                  ? `Loading voice model… ${transcriber.modelProgress}%`
                  : "Transcribing…"}
              </p>
            )}
            {micError && (
              <div className="flex items-start gap-2 rounded-control border border-incorrect-soft bg-incorrect-soft px-3 py-2">
                <p className="flex-1 text-micro text-incorrect">{micError}</p>
                <button
                  type="button"
                  onClick={() => setMicError(null)}
                  aria-label="Dismiss error"
                  className="shrink-0 text-incorrect opacity-70 hover:opacity-100 leading-none"
                >
                  ✕
                </button>
              </div>
            )}

            {/* AI Grade — manual escalation straight to Claude, skipping the
             * free local check. Only fires on tap; requires sign-in since
             * the endpoint is JWT-guarded (the LLM API key never reaches the
             * client). Hidden when AI-assisted is already the session's
             * default — the primary submit above already runs that cascade,
             * so this button would be redundant. */}
            {!cascadeActive && (
              <button
                type="button"
                onClick={() => void submitAnswer(llmGrader.current, "ai")}
                disabled={
                  phase === "grading" || !userAnswer.trim() || !isSignedIn
                }
                title={isSignedIn ? undefined : "Sign in to use AI grade"}
                className="text-meta rounded-control border border-line text-ink-2 px-4 py-2 hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
              >
                {activeGrader === "ai" ? "Asking Claude…" : "AI grade"}
              </button>
            )}
          </form>

          {phase === "grading" && activeGrader === "local" && (
            <p className="text-meta text-ink-3 text-center">
              Loading embedding model for the first time — this takes ~10 s and
              is cached for the rest of the session.
            </p>
          )}
          {phase === "grading" && activeGrader === "ai" && (
            <p className="text-meta text-ink-3 text-center">
              Asking Claude to grade this answer…
            </p>
          )}
        </div>
      )}

      {/* Ambiguous band — self-grade */}
      {phase === "ambiguous" && current && (
        <div className="space-y-4">
          <div className="rounded-card bg-surface-1 border border-line p-6">
            <CardContent text={current.front} className="text-card-front text-ink-1" />
          </div>

          {/* Show grader error if grading failed (either grader) */}
          {gradeError && (
            <div className="rounded-control border border-incorrect-soft bg-incorrect-soft px-4 py-3 space-y-1">
              <p className="text-micro text-incorrect font-semibold">
                Grading error — please self-grade
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
                : isConceptCard(current)
                  ? "Tick what you covered, then grade yourself"
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
            {hasCodeFence(current.back) || isConceptCard(current) ? (
              <div className="text-meta text-ink-2">
                <div className="flex items-center gap-1.5">
                  <span>Accepted</span>
                  <SpeakButton text={current.back} />
                </div>
                <CardContent text={current.back} className="text-ink-1 font-semibold" />
              </div>
            ) : (
              <p className="text-meta text-ink-2 flex items-center gap-1.5">
                <span>
                  Accepted{" "}
                  <b className="text-ink-1 font-semibold">{current.back}</b>
                </span>
                <SpeakButton text={current.back} />
              </p>
            )}

            {isConceptCard(current) && (
              <div className="space-y-2 rounded-control bg-surface-1 border border-line-2 p-3">
                <p className="text-micro text-ink-3">
                  Covered {checkedPoints.filter(Boolean).length} of{" "}
                  {(current.keyPoints ?? []).length} key points
                </p>
                <div className="space-y-1.5">
                  {(current.keyPoints ?? []).map((point, i) => (
                    <label
                      key={i}
                      className="flex items-start gap-2 text-meta text-ink-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checkedPoints[i] ?? false}
                        onChange={(e) => {
                          const next = [...checkedPoints];
                          next[i] = e.target.checked;
                          setCheckedPoints(next);
                        }}
                        className="mt-0.5"
                      />
                      <span>{point}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

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

            {/* Let Claude break the tie instead of self-grading. This block
             * only renders while phase === "ambiguous" — submitAnswer moves
             * phase to "grading" synchronously, unmounting it, so there's no
             * separate disabled state to track here. */}
            {isSignedIn && (
              <button
                type="button"
                onClick={() => void submitAnswer(llmGrader.current, "ai")}
                className="w-full text-meta text-accent-hi border border-dashed border-line-2 rounded-control px-3 py-2.5 hover:bg-surface-2 transition-colors"
              >
                Let AI grade this instead
              </button>
            )}

            {/* Add alternate answer affordance — optional, never blocking.
             * Hidden for concept cards: a whole paragraph shouldn't become
             * an "alternate answer" on the card. */}
            {!isConceptCard(current) &&
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
        </div>
      )}

      {/* Result reveal */}
      {phase === "result" && current && gradeResult && (
        <div className="space-y-4">
          <div className="rounded-card bg-surface-1 border border-line p-6 relative">
            <button
              onClick={() => void toggleFlag()}
              title={isFlagged ? "Unflag this card" : "Flag this card for review"}
              className={`absolute top-3 right-3 text-meta transition-colors ${
                isFlagged ? "text-incorrect" : "text-ink-3 hover:text-ink-1"
              }`}
            >
              ⚑
            </button>
            <CardContent
              text={current.front}
              className="text-card-front text-ink-1 pr-6"
            />
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
            {hasCodeFence(current.back) || isConceptCard(current) ? (
              <div className="text-meta text-ink-2">
                <div className="flex items-center gap-1.5">
                  <span>Answer</span>
                  <SpeakButton text={current.back} />
                </div>
                <CardContent text={current.back} className="text-ink-1 font-semibold" />
              </div>
            ) : (
              <p className="text-meta text-ink-2 flex items-center gap-1.5">
                <span>
                  Answer <b className="text-ink-1 font-semibold">{current.back}</b>
                </span>
                <SpeakButton text={current.back} />
              </p>
            )}
            {gradeResult.rationale && (
              <p className="text-micro text-ink-3 italic">
                “{gradeResult.rationale}”
              </p>
            )}

            {gradeResult.coverage && gradeResult.coverage.length > 0 && (
              <div className="space-y-1.5 rounded-control bg-surface-1 border border-line-2 p-3">
                <p className="text-micro text-ink-3">
                  Covered{" "}
                  {gradeResult.coverage.filter((c) => c.covered).length} of{" "}
                  {gradeResult.coverage.length} key points
                </p>
                <ul className="space-y-1">
                  {gradeResult.coverage.map((c, i) => (
                    <li
                      key={i}
                      className={`text-meta flex items-start gap-1.5 ${
                        c.covered ? "text-ink-2" : "text-incorrect font-medium"
                      }`}
                    >
                      <span className={c.covered ? "text-correct" : "text-incorrect"}>
                        {c.covered ? "✓" : "✕"}
                      </span>
                      <span>{c.point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Add alternate answer — only shown on incorrect results, and
             * never for concept cards (a whole paragraph shouldn't become
             * an "alternate answer"). */}
            {gradeResult.outcome === "incorrect" &&
              !isConceptCard(current) &&
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
            Next → <kbd className="text-[11px] font-normal opacity-70">(Enter)</kbd>
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
