/**
 * Core domain types for Flashy.
 *
 * ownerId is reserved on every record so that multi-user / sync can be
 * introduced in Phase 2 as a data change, not a schema rewrite.
 */

// ---------------------------------------------------------------------------
// Scheduling state (SM-2 compatible)
// ---------------------------------------------------------------------------

export interface SchedulingState {
  /** Ease factor (SM-2 E-Factor). Default 2.5, minimum 1.3. */
  easeFactor: number;
  /** Current interval in days. */
  intervalDays: number;
  /** ISO timestamp of when this card is next due. */
  dueAt: string;
  /** Total number of successful reviews. */
  reps: number;
  /** Number of times the card was answered "Again" (lapse). */
  lapses: number;
  /**
   * ISO timestamp of the most recent review, or null if never reviewed.
   * Sync reconciles scheduling independently from card content, keyed on
   * this field — advance-only, most-recent-review-wins — so a content edit
   * on one device can never clobber a review recorded on another.
   */
  lastReviewedAt: string | null;
}

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

export interface Deck {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface Card {
  id: string;
  ownerId: string;
  deckId: string;
  front: string;
  /** Primary answer — shown in Study mode and Test mode result screens. */
  back: string;
  /**
   * Extra accepted phrasings used for grading only (not displayed as the
   * canonical answer).  Grading passes if the user's answer matches back
   * OR any alternateAnswer.
   */
  alternateAnswers: string[];
  /**
   * AI-authored justification for an accepted answer, keyed by the exact
   * answer text (a key into `back` or `alternateAnswers`). Populated when the
   * AI grading cascade auto-accepts a typed answer; shown on future correct
   * matches instead of a generic success message. Optional/additive — cards
   * synced before this existed simply have no entries.
   */
  answerJustifications?: Record<string, string>;
  /** User-defined tags.  Stored as a string array; maps to text[] in Postgres. */
  labels: string[];
  /**
   * Rubric for a "concept card" — a long-form interview-style question
   * ("Explain how the event loop works") whose answer is graded against a
   * checklist rather than short-answer similarity. A card IS a concept card
   * exactly when keyPoints is non-empty; there is no separate discriminator
   * (mirrors the hasCodeFence detection convention in
   * src/lib/content/markdown.ts). Optional/additive — cards synced before
   * this existed simply have an empty list.
   */
  keyPoints?: string[];
  createdAt: string;
  updatedAt: string;
  scheduling: SchedulingState;
}

// ---------------------------------------------------------------------------
// Study / recall rating
// ---------------------------------------------------------------------------

/** Four-point recall scale used in Card (flashcard) mode. */
export type RecallRating = "again" | "hard" | "good" | "easy";

// ---------------------------------------------------------------------------
// Test history
// ---------------------------------------------------------------------------

/**
 * One completed test run.  Stores run-level summary; per-question detail lives
 * in TestRunQuestion.
 *
 * Phase 2 DB mapping: test_runs table.
 */
export interface TestRun {
  id: string;
  ownerId: string;
  deckId: string;
  startedAt: string; // ISO timestamp — when the first question was shown
  completedAt: string; // ISO timestamp — when the last question was resolved
  questionCount: number;
  correctCount: number;
}

/**
 * One question attempt within a TestRun.
 *
 * cardFrontSnapshot / cardBackSnapshot are snapshotted at test time so history
 * remains accurate even if the card is later edited or deleted.
 *
 * outcome is always resolved ("correct" | "incorrect") — "ambiguous" is never
 * persisted; the user must self-grade before the row is written.
 *
 * Phase 2 DB mapping: test_run_questions table (FK → test_runs, FK → cards).
 */
export interface TestRunQuestion {
  id: string;
  runId: string;
  cardId: string;
  cardFrontSnapshot: string;
  cardBackSnapshot: string;
  userAnswer: string;
  outcome: "correct" | "incorrect";
  similarity?: number;
}

/** Derived per-card stats — computed from TestRunQuestion rows, never stored. */
export interface CardStats {
  cardId: string;
  attempts: number;
  correct: number;
}

// ---------------------------------------------------------------------------
// Grading outcome (used in Test mode)
// ---------------------------------------------------------------------------

export type GradeOutcome = "correct" | "incorrect" | "ambiguous";

export interface GradeResult {
  outcome: GradeOutcome;
  /** Similarity score in [0,1] when available (embedding grader). */
  similarity?: number;
  /** Short justification when available (LLM grader). Transient — shown in the
   * result UI for the current attempt only, never persisted to TestRunQuestion. */
  rationale?: string;
  /** Which accepted answer produced the best/matching similarity (embedding
   * grader) — used to look up that answer's stored justification, if any.
   * Transient, same lifetime as rationale/similarity. */
  matchedAnswer?: string;
  /**
   * Per-key-point coverage for a concept card — from the AI cascade
   * (ConceptGradeResponse) or folded in locally from the self-grade
   * checklist so the result screen renders identically either way.
   * Transient, same lifetime as rationale — never persisted to
   * TestRunQuestion (outcome stays binary).
   */
  coverage?: KeyPointCoverage[];
  /** Present only on results produced by LlmGrader — the LlmUsage row id,
   * echoed back via POST /grade/feedback if the user confirms or overrides
   * this verdict. Transient, same lifetime as rationale. */
  usageId?: string;
}

export interface KeyPointCoverage {
  point: string;
  covered: boolean;
}
