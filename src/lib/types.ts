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
  back: string;
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
// Grading outcome (used in Test mode)
// ---------------------------------------------------------------------------

export type GradeOutcome = "correct" | "incorrect" | "ambiguous";

export interface GradeResult {
  outcome: GradeOutcome;
  /** Similarity score in [0,1] when available (embedding grader). */
  similarity?: number;
}
