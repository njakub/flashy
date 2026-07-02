import type { SchedulingState, RecallRating } from "@/lib/types";

// ---------------------------------------------------------------------------
// Scheduler interface — Phase 2 seam
//
// To swap the algorithm (e.g. FSRS), implement a new object that satisfies
// this shape and replace the export at the bottom.
// ---------------------------------------------------------------------------

export interface Scheduler {
  /**
   * Given a card's current scheduling state and the user's recall rating,
   * return the next scheduling state to persist.
   */
  review(state: SchedulingState, rating: RecallRating): SchedulingState;
}

// ---------------------------------------------------------------------------
// Default scheduling state for new cards
// ---------------------------------------------------------------------------

export function DEFAULT_SCHEDULING_STATE(): SchedulingState {
  return {
    easeFactor: 2.5,
    intervalDays: 0,
    dueAt: new Date().toISOString(), // due immediately
    reps: 0,
    lapses: 0,
    lastReviewedAt: null,
  };
}

// ---------------------------------------------------------------------------
// SM-2 implementation
//
// Recall rating → SM-2 quality grade mapping:
//   again → 0  (complete blackout / lapse)
//   hard  → 1  (recalled with serious difficulty)
//   good  → 3  (recalled with effort)
//   easy  → 5  (perfect recall)
//
// Algorithm:
//   • grade < 3 (again / hard):   reset interval to 1 day, decrement ease.
//   • grade >= 3 (good / easy):
//       reps == 0 → interval = 1 day
//       reps == 1 → interval = 6 days
//       reps >= 2 → interval = round(previous × easeFactor)
//   • New easeFactor = old + (0.1 - (5 - grade) × (0.08 + (5 - grade) × 0.02))
//   • easeFactor minimum = 1.3
// ---------------------------------------------------------------------------

const GRADE: Record<RecallRating, number> = {
  again: 0,
  hard: 1,
  good: 3,
  easy: 5,
};

const MIN_EASE = 1.3;

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(1, days));
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const sm2Scheduler: Scheduler = {
  review(state: SchedulingState, rating: RecallRating): SchedulingState {
    const grade = GRADE[rating];
    const lastReviewedAt = new Date().toISOString();

    // Update ease factor (SM-2 formula)
    const easeDelta = 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02);
    const newEase = Math.max(MIN_EASE, state.easeFactor + easeDelta);

    // Lapse: grade < 3 → reset
    if (grade < 3) {
      return {
        easeFactor: newEase,
        intervalDays: 1,
        dueAt: daysFromNow(1),
        reps: state.reps,
        lapses: state.lapses + 1,
        lastReviewedAt,
      };
    }

    // Successful recall
    let nextInterval: number;
    if (state.reps === 0) {
      nextInterval = 1;
    } else if (state.reps === 1) {
      nextInterval = 6;
    } else {
      nextInterval = Math.round(state.intervalDays * newEase);
    }

    return {
      easeFactor: newEase,
      intervalDays: nextInterval,
      dueAt: daysFromNow(nextInterval),
      reps: state.reps + 1,
      lapses: state.lapses,
      lastReviewedAt,
    };
  },
};

/**
 * The active scheduler instance used throughout the app.
 * Phase 2: replace with an FSRS or server-side scheduler by changing this
 * single export — no component code changes required.
 */
export const scheduler: Scheduler = sm2Scheduler;
