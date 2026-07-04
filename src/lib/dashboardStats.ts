/**
 * Cross-deck dashboard aggregates — pure functions over already-fetched
 * repository data (no DB access), same shape as testHistory.ts. Everything
 * here is derived, never stored, honoring the CardStats "never stored"
 * precedent: recomputed on each load from Card.scheduling.lastReviewedAt and
 * TestRun rows.
 */
import type { Card, TestRun } from "@/lib/types";

/** YYYY-MM-DD in local time (not UTC) — a streak should match the user's
 * own calendar day, not a timezone-shifted one. */
export function toLocalDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Distinct local-calendar-dates with at least one review or completed test
 * run — the raw input to computeStreak(). */
export function activityDates(cards: Card[], runs: TestRun[]): Set<string> {
  const dates = new Set<string>();
  for (const c of cards) {
    if (c.scheduling.lastReviewedAt) {
      dates.add(toLocalDateString(new Date(c.scheduling.lastReviewedAt)));
    }
  }
  for (const r of runs) {
    dates.add(toLocalDateString(new Date(r.startedAt)));
  }
  return dates;
}

/**
 * Consecutive-day streak ending today, walking backward from `today`.
 * If today has no activity yet, the streak isn't broken until the day
 * actually passes — it "still stands" as long as yesterday has activity,
 * and counts from yesterday backward. Returns 0 if neither today nor
 * yesterday has activity.
 */
export function computeStreak(dates: Set<string>, today: Date = new Date()): number {
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!dates.has(toLocalDateString(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!dates.has(toLocalDateString(cursor))) return 0;
  }
  let streak = 0;
  while (dates.has(toLocalDateString(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export interface AccuracyStats {
  attempts: number;
  correct: number;
  /** Percentage 0-100, or null when there are no attempts in the window. */
  percent: number | null;
}

/** Aggregate accuracy across runs whose startedAt falls within the last
 * `windowDays` days (inclusive of today) — sums questionCount/correctCount
 * from TestRun rows directly rather than re-fetching TestRunQuestion rows. */
export function recentAccuracy(
  runs: TestRun[],
  windowDays: number,
  now: Date = new Date(),
): AccuracyStats {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffMs = cutoff.getTime();

  let attempts = 0;
  let correct = 0;
  for (const r of runs) {
    if (new Date(r.startedAt).getTime() < cutoffMs) continue;
    attempts += r.questionCount;
    correct += r.correctCount;
  }

  return {
    attempts,
    correct,
    percent: attempts > 0 ? Math.round((correct / attempts) * 100) : null,
  };
}
