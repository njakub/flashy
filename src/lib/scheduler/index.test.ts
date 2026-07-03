import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULING_STATE, scheduler } from "./index";
import type { SchedulingState } from "@/lib/types";

/** Mirrors scheduler's daysFromNow: N days out, truncated to local midnight. */
function expectedDueAt(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

describe("DEFAULT_SCHEDULING_STATE", () => {
  it("is due immediately with no review history", () => {
    const state = DEFAULT_SCHEDULING_STATE();
    expect(state.easeFactor).toBe(2.5);
    expect(state.intervalDays).toBe(0);
    expect(state.reps).toBe(0);
    expect(state.lapses).toBe(0);
    expect(state.lastReviewedAt).toBeNull();
    expect(new Date(state.dueAt).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("scheduler.review — interval progression", () => {
  it("first successful review (reps 0 -> 1) schedules 1 day out", () => {
    const state = DEFAULT_SCHEDULING_STATE();
    const next = scheduler.review(state, "good");
    expect(next.reps).toBe(1);
    expect(next.intervalDays).toBe(1);
  });

  it("second successful review (reps 1 -> 2) schedules 6 days out", () => {
    const state: SchedulingState = { ...DEFAULT_SCHEDULING_STATE(), reps: 1, intervalDays: 1 };
    const next = scheduler.review(state, "good");
    expect(next.reps).toBe(2);
    expect(next.intervalDays).toBe(6);
  });

  it("subsequent reviews (reps >= 2) round(prevInterval * newEase)", () => {
    const state: SchedulingState = {
      ...DEFAULT_SCHEDULING_STATE(),
      reps: 2,
      intervalDays: 6,
      easeFactor: 2.5,
    };
    const next = scheduler.review(state, "good");
    // good -> grade 3 -> easeDelta = 0.1 - 2*(0.08+2*0.02) = 0.1-0.24 = -0.14
    const expectedEase = 2.5 - 0.14;
    expect(next.easeFactor).toBeCloseTo(expectedEase, 5);
    expect(next.intervalDays).toBe(Math.round(6 * expectedEase));
    expect(next.reps).toBe(3);
  });

  it("stamps lastReviewedAt on every review", () => {
    const state = DEFAULT_SCHEDULING_STATE();
    expect(state.lastReviewedAt).toBeNull();
    const next = scheduler.review(state, "easy");
    expect(next.lastReviewedAt).not.toBeNull();
    expect(new Date(next.lastReviewedAt!).getTime()).not.toBeNaN();
  });
});

describe("scheduler.review — lapses", () => {
  it("again/hard (grade < 3) resets interval to 1 day and increments lapses", () => {
    const state: SchedulingState = {
      ...DEFAULT_SCHEDULING_STATE(),
      reps: 5,
      intervalDays: 30,
      lapses: 1,
    };
    const next = scheduler.review(state, "again");
    expect(next.intervalDays).toBe(1);
    expect(next.lapses).toBe(2);
    // reps is deliberately left untouched on a lapse (only the interval resets)
    expect(next.reps).toBe(5);
  });

  it("does not lower easeFactor below the 1.3 floor", () => {
    const state: SchedulingState = {
      ...DEFAULT_SCHEDULING_STATE(),
      easeFactor: 1.3,
    };
    const next = scheduler.review(state, "again");
    expect(next.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it("hard is still a lapse (grade 1 < 3) even though distinct from again", () => {
    const state = DEFAULT_SCHEDULING_STATE();
    const next = scheduler.review(state, "hard");
    expect(next.intervalDays).toBe(1);
    expect(next.lapses).toBe(1);
  });
});

describe("scheduler.review — dueAt", () => {
  it("dueAt lands exactly intervalDays out, truncated to local midnight", () => {
    const state: SchedulingState = { ...DEFAULT_SCHEDULING_STATE(), reps: 1, intervalDays: 1 };
    const next = scheduler.review(state, "good");
    expect(next.dueAt).toBe(expectedDueAt(next.intervalDays));
  });
});
