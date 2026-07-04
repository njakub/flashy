import { describe, expect, it } from "vitest";
import {
  activityDates,
  computeStreak,
  recentAccuracy,
  toLocalDateString,
} from "./dashboardStats";
import type { Card, TestRun } from "@/lib/types";

function makeCard(lastReviewedAt: string | null): Card {
  return {
    id: "c",
    ownerId: "owner",
    deckId: "deck-1",
    front: "f",
    back: "b",
    alternateAnswers: [],
    labels: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scheduling: {
      easeFactor: 2.5,
      intervalDays: 1,
      dueAt: "2026-01-02T00:00:00.000Z",
      reps: 1,
      lapses: 0,
      lastReviewedAt,
    },
  };
}

function makeRun(startedAt: string, questionCount = 5, correctCount = 4): TestRun {
  return {
    id: "r",
    ownerId: "owner",
    deckId: "deck-1",
    startedAt,
    completedAt: startedAt,
    questionCount,
    correctCount,
  };
}

describe("toLocalDateString", () => {
  it("formats as YYYY-MM-DD", () => {
    expect(toLocalDateString(new Date(2026, 5, 3))).toBe("2026-06-03");
  });

  it("pads single-digit months/days", () => {
    expect(toLocalDateString(new Date(2026, 0, 9))).toBe("2026-01-09");
  });
});

describe("activityDates", () => {
  it("collects distinct dates from card reviews and run starts", () => {
    const cards = [
      makeCard("2026-06-01T10:00:00.000Z"),
      makeCard("2026-06-02T10:00:00.000Z"),
      makeCard(null), // never reviewed — contributes nothing
    ];
    const runs = [makeRun("2026-06-02T12:00:00.000Z"), makeRun("2026-06-03T09:00:00.000Z")];
    const dates = activityDates(cards, runs);
    expect(dates).toEqual(new Set(["2026-06-01", "2026-06-02", "2026-06-03"]));
  });
});

describe("computeStreak", () => {
  it("counts consecutive days ending today", () => {
    const today = new Date(2026, 5, 10);
    const dates = new Set(["2026-06-08", "2026-06-09", "2026-06-10"]);
    expect(computeStreak(dates, today)).toBe(3);
  });

  it("stops at the first gap", () => {
    const today = new Date(2026, 5, 10);
    const dates = new Set(["2026-06-05", "2026-06-09", "2026-06-10"]);
    expect(computeStreak(dates, today)).toBe(2);
  });

  it("still counts the streak when today has no activity yet but yesterday does", () => {
    const today = new Date(2026, 5, 10);
    const dates = new Set(["2026-06-08", "2026-06-09"]); // nothing on the 10th yet
    expect(computeStreak(dates, today)).toBe(2);
  });

  it("returns 0 when neither today nor yesterday has activity", () => {
    const today = new Date(2026, 5, 10);
    const dates = new Set(["2026-06-01"]);
    expect(computeStreak(dates, today)).toBe(0);
  });

  it("returns 0 for no activity at all", () => {
    expect(computeStreak(new Set(), new Date(2026, 5, 10))).toBe(0);
  });

  it("a single day of activity today is a streak of 1", () => {
    const today = new Date(2026, 5, 10);
    expect(computeStreak(new Set(["2026-06-10"]), today)).toBe(1);
  });
});

describe("recentAccuracy", () => {
  it("sums questionCount/correctCount across runs within the window", () => {
    const now = new Date(2026, 5, 30);
    const runs = [
      makeRun("2026-06-25T00:00:00.000Z", 10, 8),
      makeRun("2026-06-28T00:00:00.000Z", 5, 5),
    ];
    const stats = recentAccuracy(runs, 30, now);
    expect(stats).toEqual({ attempts: 15, correct: 13, percent: 87 });
  });

  it("excludes runs outside the window", () => {
    const now = new Date(2026, 5, 30);
    const runs = [
      makeRun("2026-01-01T00:00:00.000Z", 10, 1), // way outside a 30-day window
      makeRun("2026-06-29T00:00:00.000Z", 4, 4),
    ];
    const stats = recentAccuracy(runs, 30, now);
    expect(stats).toEqual({ attempts: 4, correct: 4, percent: 100 });
  });

  it("percent is null when there are no attempts in the window", () => {
    const now = new Date(2026, 5, 30);
    const stats = recentAccuracy([], 30, now);
    expect(stats).toEqual({ attempts: 0, correct: 0, percent: null });
  });
});
