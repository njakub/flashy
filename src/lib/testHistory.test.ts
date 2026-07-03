import { describe, expect, it } from "vitest";
import {
  cardLabelsById,
  computeLabelStats,
  distinctLabels,
  formatDuration,
  groupQuestionsByRun,
  runListForLabel,
} from "./testHistory";
import type { Card, TestRun, TestRunQuestion } from "@/lib/types";

function makeCard(id: string, labels: string[]): Card {
  return {
    id,
    ownerId: "owner",
    deckId: "deck-1",
    front: `front-${id}`,
    back: `back-${id}`,
    alternateAnswers: [],
    labels,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scheduling: {
      easeFactor: 2.5,
      intervalDays: 0,
      dueAt: "2026-01-01T00:00:00.000Z",
      reps: 0,
      lapses: 0,
      lastReviewedAt: null,
    },
  };
}

function makeQuestion(
  id: string,
  runId: string,
  cardId: string,
  outcome: "correct" | "incorrect",
): TestRunQuestion {
  return {
    id,
    runId,
    cardId,
    cardFrontSnapshot: "front",
    cardBackSnapshot: "back",
    userAnswer: "answer",
    outcome,
  };
}

function makeRun(id: string, questionCount: number, correctCount: number): TestRun {
  return {
    id,
    ownerId: "owner",
    deckId: "deck-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    questionCount,
    correctCount,
  };
}

describe("cardLabelsById / distinctLabels", () => {
  it("maps card id -> labels, defaulting to []", () => {
    const cards = [makeCard("c1", ["a", "b"]), makeCard("c2", [])];
    const map = cardLabelsById(cards);
    expect(map.get("c1")).toEqual(["a", "b"]);
    expect(map.get("c2")).toEqual([]);
  });

  it("collects a sorted, deduplicated label set across cards", () => {
    const cards = [makeCard("c1", ["b", "a"]), makeCard("c2", ["a", "c"])];
    expect(distinctLabels(cards)).toEqual(["a", "b", "c"]);
  });
});

describe("groupQuestionsByRun", () => {
  it("buckets questions by runId", () => {
    const questions = [
      makeQuestion("q1", "r1", "c1", "correct"),
      makeQuestion("q2", "r1", "c2", "incorrect"),
      makeQuestion("q3", "r2", "c1", "correct"),
    ];
    const grouped = groupQuestionsByRun(questions);
    expect(grouped.get("r1")?.map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(grouped.get("r2")?.map((q) => q.id)).toEqual(["q3"]);
  });
});

describe("computeLabelStats", () => {
  it("attributes each question to every one of its card's current labels", () => {
    const cardLabels = cardLabelsById([
      makeCard("c1", ["vocab", "unit1"]),
      makeCard("c2", ["vocab"]),
    ]);
    const questions = [
      makeQuestion("q1", "r1", "c1", "correct"),
      makeQuestion("q2", "r1", "c2", "incorrect"),
    ];
    const stats = computeLabelStats(questions, cardLabels);
    const byLabel = Object.fromEntries(stats.map((s) => [s.label, s]));
    expect(byLabel.vocab).toEqual({ label: "vocab", attempts: 2, correct: 1 });
    expect(byLabel.unit1).toEqual({ label: "unit1", attempts: 1, correct: 1 });
  });

  it("skips questions whose card is unlabelled or deleted", () => {
    const cardLabels = cardLabelsById([makeCard("c1", [])]);
    const questions = [
      makeQuestion("q1", "r1", "c1", "correct"),
      makeQuestion("q2", "r1", "deleted-card", "correct"),
    ];
    expect(computeLabelStats(questions, cardLabels)).toEqual([]);
  });
});

describe("runListForLabel", () => {
  const runs = [makeRun("r1", 5, 4), makeRun("r2", 3, 1)];
  const cardLabels = cardLabelsById([
    makeCard("c1", ["vocab"]),
    makeCard("c2", ["grammar"]),
  ]);
  const questionsByRun = groupQuestionsByRun([
    makeQuestion("q1", "r1", "c1", "correct"),
    makeQuestion("q2", "r1", "c1", "incorrect"),
    makeQuestion("q3", "r1", "c2", "correct"),
    makeQuestion("q4", "r2", "c2", "correct"),
  ]);

  it("label === null returns the stored run totals unrescored", () => {
    const entries = runListForLabel(runs, questionsByRun, cardLabels, null);
    expect(entries).toEqual([
      { run: runs[0], questionCount: 5, correctCount: 4 },
      { run: runs[1], questionCount: 3, correctCount: 1 },
    ]);
  });

  it("rescopes to matching questions only and drops runs with none", () => {
    const entries = runListForLabel(runs, questionsByRun, cardLabels, "vocab");
    expect(entries).toEqual([
      { run: runs[0], questionCount: 2, correctCount: 1 },
    ]);
  });

  it("another label picks up a different run/question subset", () => {
    const entries = runListForLabel(runs, questionsByRun, cardLabels, "grammar");
    expect(entries).toEqual([
      { run: runs[0], questionCount: 1, correctCount: 1 },
      { run: runs[1], questionCount: 1, correctCount: 1 },
    ]);
  });
});

describe("formatDuration", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatDuration("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:45.000Z")).toBe("45s");
  });

  it("formats durations over a minute as minutes + seconds", () => {
    expect(formatDuration("2026-01-01T00:00:00.000Z", "2026-01-01T00:02:05.000Z")).toBe("2m 5s");
  });

  it("returns an em dash for invalid/negative durations", () => {
    expect(formatDuration("2026-01-01T00:00:10.000Z", "2026-01-01T00:00:00.000Z")).toBe("—");
    expect(formatDuration("not-a-date", "2026-01-01T00:00:00.000Z")).toBe("—");
  });
});
