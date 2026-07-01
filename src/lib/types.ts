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
  /** User-defined tags.  Stored as a string array; maps to text[] in Postgres. */
  labels: string[];
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
}
