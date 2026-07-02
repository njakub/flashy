/**
 * Wire protocol for POST /sync — mirrors flashy-api's src/sync/sync.schema.ts
 * and sync.types.ts. Kept as a hand-written mirror rather than a shared
 * package since the two projects deploy independently; the shapes must be
 * changed in lockstep by hand.
 */

export interface SyncCursor {
  decks: string;
  cards: string;
  testRuns: string;
  testRunQuestions: string;
}

export interface WireDeck {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  rev: string;
}

export interface WireCard {
  id: string;
  ownerId: string;
  deckId: string;
  front: string;
  back: string;
  alternateAnswers: string[];
  labels: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  rev: string;
  scheduling: {
    easeFactor: number;
    intervalDays: number;
    dueAt: string;
    reps: number;
    lapses: number;
    lastReviewedAt: string | null;
  };
}

export interface WireTestRun {
  id: string;
  ownerId: string;
  deckId: string;
  startedAt: string;
  completedAt: string;
  questionCount: number;
  correctCount: number;
  deletedAt: string | null;
  rev: string;
}

export interface WireTestRunQuestion {
  id: string;
  runId: string;
  cardId: string;
  cardFrontSnapshot: string;
  cardBackSnapshot: string;
  userAnswer: string;
  outcome: "correct" | "incorrect";
  similarity?: number;
  rev: string;
}

export interface SyncRequestBody {
  cursor: SyncCursor;
  push: {
    decks: Omit<WireDeck, "ownerId" | "rev">[];
    cards: Omit<WireCard, "ownerId" | "rev">[];
    testRuns: Omit<WireTestRun, "ownerId" | "rev">[];
    testRunQuestions: Omit<WireTestRunQuestion, "rev">[];
  };
}

export interface SyncResponseBody {
  cursor: SyncCursor;
  decks: WireDeck[];
  cards: WireCard[];
  testRuns: WireTestRun[];
  testRunQuestions: WireTestRunQuestion[];
}
