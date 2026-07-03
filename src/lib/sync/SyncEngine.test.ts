import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { applyCard, applyDeck, applyTestRun, applyTestRunQuestion } from "./SyncEngine";
import type { WireCard, WireDeck, WireTestRun, WireTestRunQuestion } from "./wire";

const SCHEDULING = {
  easeFactor: 2.5,
  intervalDays: 1,
  dueAt: "2026-01-02T00:00:00.000Z",
  reps: 1,
  lapses: 0,
};

function wireCard(overrides: Partial<WireCard> = {}): WireCard {
  return {
    id: "c1",
    ownerId: "owner",
    deckId: "deck-1",
    front: "wire-front",
    back: "wire-back",
    alternateAnswers: [],
    labels: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:10:00.000Z",
    deletedAt: null,
    rev: "10",
    scheduling: { ...SCHEDULING, lastReviewedAt: "2026-01-01T00:10:00.000Z" },
    ...overrides,
  };
}

async function seedLocalCard(overrides: Record<string, unknown> = {}) {
  await db.cards.put({
    id: "c1",
    ownerId: "owner",
    deckId: "deck-1",
    front: "local-front",
    back: "local-back",
    alternateAnswers: [],
    labels: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:05:00.000Z",
    scheduling: { ...SCHEDULING, lastReviewedAt: "2026-01-01T00:05:00.000Z" },
    deletedAt: null,
    dirty: 0,
    ...overrides,
  });
}

beforeEach(async () => {
  await Promise.all([
    db.cards.clear(),
    db.decks.clear(),
    db.testRuns.clear(),
    db.testRunQuestions.clear(),
    db.syncState.clear(),
  ]);
});

describe("applyCard — no local row", () => {
  it("inserts the wire row verbatim, clean (dirty: 0)", async () => {
    await applyCard(wireCard());
    const local = await db.cards.get("c1");
    expect(local?.front).toBe("wire-front");
    expect(local?.dirty).toBe(0);
  });
});

describe("applyCard — four-quadrant conflict matrix", () => {
  it("quadrant 1: neither stale locally -> wire wins outright, dirty cleared", async () => {
    await seedLocalCard({
      updatedAt: "2026-01-01T00:00:00.000Z", // older than wire's 00:10
      scheduling: { ...SCHEDULING, lastReviewedAt: null }, // never reviewed locally
      dirty: 1,
    });
    await applyCard(wireCard());
    const local = await db.cards.get("c1");
    expect(local?.front).toBe("wire-front");
    expect(local?.scheduling.lastReviewedAt).toBe("2026-01-01T00:10:00.000Z");
    expect(local?.dirty).toBe(0);
  });

  it("quadrant 2: content raced ahead locally, scheduling not -> content kept local, scheduling from wire, stays dirty", async () => {
    await seedLocalCard({
      updatedAt: "2026-01-01T00:20:00.000Z", // newer than wire's 00:10 -> content stale on wire
      scheduling: { ...SCHEDULING, lastReviewedAt: null }, // scheduling not ahead locally
      dirty: 1,
    });
    await applyCard(wireCard());
    const local = await db.cards.get("c1");
    expect(local?.front).toBe("local-front"); // content kept
    expect(local?.scheduling.lastReviewedAt).toBe("2026-01-01T00:10:00.000Z"); // scheduling from wire
    expect(local?.dirty).toBe(1); // local content still needs to push
  });

  it("quadrant 3: scheduling raced ahead locally, content not -> content from wire, scheduling kept local, stays dirty", async () => {
    await seedLocalCard({
      updatedAt: "2026-01-01T00:00:00.000Z", // older than wire -> content not stale
      scheduling: { ...SCHEDULING, lastReviewedAt: "2026-01-01T00:30:00.000Z" }, // newer than wire's review
      dirty: 1,
    });
    await applyCard(wireCard());
    const local = await db.cards.get("c1");
    expect(local?.front).toBe("wire-front"); // content from wire
    expect(local?.scheduling.lastReviewedAt).toBe("2026-01-01T00:30:00.000Z"); // scheduling kept
    expect(local?.dirty).toBe(1); // local review still needs to push
  });

  it("quadrant 4: both raced ahead locally -> entire pull is skipped, no write at all", async () => {
    await seedLocalCard({
      updatedAt: "2026-01-01T00:20:00.000Z",
      scheduling: { ...SCHEDULING, lastReviewedAt: "2026-01-01T00:30:00.000Z" },
      dirty: 1,
    });
    await applyCard(wireCard());
    const local = await db.cards.get("c1");
    expect(local?.front).toBe("local-front");
    expect(local?.scheduling.lastReviewedAt).toBe("2026-01-01T00:30:00.000Z");
    expect(local?.dirty).toBe(1); // untouched, re-pushes next cycle
  });

  it("a card never reviewed locally (lastReviewedAt null) is never considered scheduling-stale", async () => {
    await seedLocalCard({
      updatedAt: "2026-01-01T00:20:00.000Z", // content stale
      scheduling: { ...SCHEDULING, lastReviewedAt: null },
      dirty: 1,
    });
    await applyCard(wireCard());
    const local = await db.cards.get("c1");
    // content stale only (quadrant 2): content kept, scheduling from wire
    expect(local?.front).toBe("local-front");
    expect(local?.scheduling.lastReviewedAt).toBe("2026-01-01T00:10:00.000Z");
  });
});

describe("applyDeck", () => {
  const wireDeck = (overrides: Partial<WireDeck> = {}): WireDeck => ({
    id: "d1",
    ownerId: "owner",
    name: "wire-name",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:10:00.000Z",
    deletedAt: null,
    rev: "5",
    ...overrides,
  });

  it("inserts a new deck clean", async () => {
    await applyDeck(wireDeck());
    const local = await db.decks.get("d1");
    expect(local?.name).toBe("wire-name");
    expect(local?.dirty).toBe(0);
  });

  it("wire wins when local hasn't raced ahead", async () => {
    await db.decks.put({
      id: "d1",
      ownerId: "owner",
      name: "local-name",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      dirty: 1,
    });
    await applyDeck(wireDeck());
    const local = await db.decks.get("d1");
    expect(local?.name).toBe("wire-name");
    expect(local?.dirty).toBe(0);
  });

  it("skips the pull entirely when local raced ahead since the push", async () => {
    await db.decks.put({
      id: "d1",
      ownerId: "owner",
      name: "local-name",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:20:00.000Z", // newer than wire
      deletedAt: null,
      dirty: 1,
    });
    await applyDeck(wireDeck());
    const local = await db.decks.get("d1");
    expect(local?.name).toBe("local-name");
    expect(local?.dirty).toBe(1);
  });

  it("applies a tombstone (deletedAt) like any other field", async () => {
    await applyDeck(wireDeck({ deletedAt: "2026-01-01T00:15:00.000Z" }));
    const local = await db.decks.get("d1");
    expect(local?.deletedAt).toBe("2026-01-01T00:15:00.000Z");
  });
});

describe("applyTestRun — tombstone cascade", () => {
  const wireRun = (overrides: Partial<WireTestRun> = {}): WireTestRun => ({
    id: "r1",
    ownerId: "owner",
    deckId: "deck-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    questionCount: 2,
    correctCount: 1,
    deletedAt: null,
    rev: "3",
    ...overrides,
  });

  it("inserts a run clean", async () => {
    await applyTestRun(wireRun());
    const local = await db.testRuns.get("r1");
    expect(local?.dirty).toBe(0);
  });

  it("tombstoning a run deletes its cached question rows on this device", async () => {
    await db.testRunQuestions.bulkPut([
      {
        id: "q1",
        runId: "r1",
        cardId: "c1",
        cardFrontSnapshot: "f",
        cardBackSnapshot: "b",
        userAnswer: "a",
        outcome: "correct",
        dirty: 0,
      },
      {
        id: "q2",
        runId: "r1",
        cardId: "c2",
        cardFrontSnapshot: "f2",
        cardBackSnapshot: "b2",
        userAnswer: "a2",
        outcome: "incorrect",
        dirty: 0,
      },
    ]);
    await applyTestRun(wireRun({ deletedAt: "2026-01-01T00:20:00.000Z" }));
    const remaining = await db.testRunQuestions.where("runId").equals("r1").toArray();
    expect(remaining).toEqual([]);
  });

  it("a non-tombstoned run leaves its question rows untouched", async () => {
    await db.testRunQuestions.put({
      id: "q1",
      runId: "r1",
      cardId: "c1",
      cardFrontSnapshot: "f",
      cardBackSnapshot: "b",
      userAnswer: "a",
      outcome: "correct",
      dirty: 0,
    });
    await applyTestRun(wireRun());
    const remaining = await db.testRunQuestions.where("runId").equals("r1").toArray();
    expect(remaining).toHaveLength(1);
  });
});

describe("applyTestRunQuestion — immutability", () => {
  const wireQuestion = (
    overrides: Partial<WireTestRunQuestion> = {},
  ): WireTestRunQuestion => ({
    id: "q1",
    runId: "r1",
    cardId: "c1",
    cardFrontSnapshot: "wire-front-snapshot",
    cardBackSnapshot: "wire-back-snapshot",
    userAnswer: "wire-answer",
    outcome: "correct",
    rev: "7",
    ...overrides,
  });

  it("inserts a new question row verbatim", async () => {
    await applyTestRunQuestion(wireQuestion());
    const local = await db.testRunQuestions.get("q1");
    expect(local?.userAnswer).toBe("wire-answer");
    expect(local?.dirty).toBe(0);
  });

  it("leaves existing local content untouched — snapshots are immutable", async () => {
    await db.testRunQuestions.put({
      id: "q1",
      runId: "r1",
      cardId: "c1",
      cardFrontSnapshot: "local-front-snapshot",
      cardBackSnapshot: "local-back-snapshot",
      userAnswer: "local-answer",
      outcome: "incorrect",
      dirty: 1,
    });
    await applyTestRunQuestion(wireQuestion());
    const local = await db.testRunQuestions.get("q1");
    expect(local?.userAnswer).toBe("local-answer");
    expect(local?.outcome).toBe("incorrect");
  });

  it("still clears a stale dirty flag on an existing row once the server has acknowledged it", async () => {
    await db.testRunQuestions.put({
      id: "q1",
      runId: "r1",
      cardId: "c1",
      cardFrontSnapshot: "local-front-snapshot",
      cardBackSnapshot: "local-back-snapshot",
      userAnswer: "local-answer",
      outcome: "incorrect",
      dirty: 1,
    });
    await applyTestRunQuestion(wireQuestion());
    const local = await db.testRunQuestions.get("q1");
    expect(local?.dirty).toBe(0);
  });
});
