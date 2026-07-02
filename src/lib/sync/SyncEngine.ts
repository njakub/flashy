import { db, defaultSyncCursor } from "@/lib/db";
import type {
  StoredCard,
  StoredDeck,
  StoredTestRun,
  StoredTestRunQuestion,
} from "@/lib/db";
import { API_BASE_URL } from "@/lib/config";
import { notifySyncApplied } from "./syncEvents";
import type {
  SyncRequestBody,
  SyncResponseBody,
  WireCard,
  WireDeck,
  WireTestRun,
  WireTestRunQuestion,
} from "./wire";

export interface SyncCounts {
  decks: number;
  cards: number;
  testRuns: number;
  testRunQuestions: number;
}

export interface SyncResult {
  pushed: SyncCounts;
  pulled: SyncCounts;
}

/**
 * Resolves the current access token, refreshing it first if needed. Returns
 * null if there's no signed-in session — syncOnce() then no-ops.
 */
export type AccessTokenGetter = () => Promise<string | null>;

const CURSOR_ID = "cursor";

/**
 * One push+pull round trip against flashy-api's POST /sync.
 *
 * This is a sibling of the Dexie repositories, not a wrapper around them —
 * it reads/writes db.cards/db.decks/db.testRuns/db.testRunQuestions
 * directly, including the sync-only deletedAt/dirty fields the repository
 * interfaces deliberately don't expose. Network calls live here, off the
 * read/write hot path the repositories serve — the app stays fully
 * functional offline regardless of whether syncOnce() has ever run.
 */
export class SyncEngine {
  constructor(private readonly getAccessToken: AccessTokenGetter) {}

  async syncOnce(): Promise<SyncResult | null> {
    const token = await this.getAccessToken();
    if (!token) return null;

    const [dirtyDecks, dirtyCards, dirtyTestRuns, dirtyTestRunQuestions] =
      await Promise.all([
        db.decks.where("dirty").equals(1).toArray(),
        db.cards.where("dirty").equals(1).toArray(),
        db.testRuns.where("dirty").equals(1).toArray(),
        db.testRunQuestions.where("dirty").equals(1).toArray(),
      ]);

    const cursorRow = (await db.syncState.get(CURSOR_ID)) ?? {
      id: CURSOR_ID,
      ...defaultSyncCursor(),
    };

    const body: SyncRequestBody = {
      cursor: {
        decks: cursorRow.decks,
        cards: cursorRow.cards,
        testRuns: cursorRow.testRuns,
        testRunQuestions: cursorRow.testRunQuestions,
      },
      push: {
        decks: dirtyDecks.map(toWireDeckPush),
        cards: dirtyCards.map(toWireCardPush),
        testRuns: dirtyTestRuns.map(toWireTestRunPush),
        testRunQuestions: dirtyTestRunQuestions.map(toWireTestRunQuestionPush),
      },
    };

    const res = await fetch(`${API_BASE_URL}/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Sync failed: ${res.status} ${await res.text()}`);
    }
    const data: SyncResponseBody = (await res.json()) as SyncResponseBody;

    await db.transaction(
      "rw",
      [db.decks, db.cards, db.testRuns, db.testRunQuestions, db.syncState],
      async () => {
        for (const d of data.decks) await applyDeck(d);
        for (const c of data.cards) await applyCard(c);
        for (const r of data.testRuns) await applyTestRun(r);
        for (const q of data.testRunQuestions) await applyTestRunQuestion(q);

        await db.syncState.put({ id: CURSOR_ID, ...data.cursor });
      },
    );

    const pulledAnything =
      data.decks.length > 0 ||
      data.cards.length > 0 ||
      data.testRuns.length > 0 ||
      data.testRunQuestions.length > 0;
    if (pulledAnything) notifySyncApplied();

    return {
      pushed: {
        decks: dirtyDecks.length,
        cards: dirtyCards.length,
        testRuns: dirtyTestRuns.length,
        testRunQuestions: dirtyTestRunQuestions.length,
      },
      pulled: {
        decks: data.decks.length,
        cards: data.cards.length,
        testRuns: data.testRuns.length,
        testRunQuestions: data.testRunQuestions.length,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Push serialization — StoredX -> wire push shape
// ---------------------------------------------------------------------------

function toWireDeckPush(d: StoredDeck) {
  return {
    id: d.id,
    name: d.name,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    deletedAt: d.deletedAt,
  };
}

function toWireCardPush(c: StoredCard) {
  return {
    id: c.id,
    deckId: c.deckId,
    front: c.front,
    back: c.back,
    alternateAnswers: c.alternateAnswers,
    labels: c.labels,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    deletedAt: c.deletedAt,
    scheduling: c.scheduling,
  };
}

function toWireTestRunPush(r: StoredTestRun) {
  return {
    id: r.id,
    deckId: r.deckId,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    questionCount: r.questionCount,
    correctCount: r.correctCount,
    deletedAt: r.deletedAt,
  };
}

function toWireTestRunQuestionPush(q: StoredTestRunQuestion) {
  return {
    id: q.id,
    runId: q.runId,
    cardId: q.cardId,
    cardFrontSnapshot: q.cardFrontSnapshot,
    cardBackSnapshot: q.cardBackSnapshot,
    userAnswer: q.userAnswer,
    outcome: q.outcome,
    similarity: q.similarity,
  };
}

// ---------------------------------------------------------------------------
// Pull application — wire -> StoredX, applied directly to Dexie
//
// Race safety: a sync round trip can take a few hundred ms, in which the
// user might edit the very row we just pushed. Rather than blindly
// overwriting with the (now slightly stale) server response, each apply
// compares the wire row's timestamp against the LOCAL row's CURRENT
// timestamp (not a pre-push snapshot) and only overwrites fields that
// aren't newer locally. Anything skipped this way keeps dirty=1, so the
// next sync cycle re-pushes the real latest edit — self-healing, no data
// loss, worst case one extra round trip.
// ---------------------------------------------------------------------------

async function applyDeck(wire: WireDeck): Promise<void> {
  const local = await db.decks.get(wire.id);
  if (
    local &&
    new Date(local.updatedAt).getTime() > new Date(wire.updatedAt).getTime()
  ) {
    return; // local raced ahead since this row was pushed
  }
  await db.decks.put({
    id: wire.id,
    ownerId: wire.ownerId,
    name: wire.name,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
    deletedAt: wire.deletedAt,
    dirty: 0,
  });
}

async function applyCard(wire: WireCard): Promise<void> {
  const local = await db.cards.get(wire.id);

  if (!local) {
    await db.cards.put({
      id: wire.id,
      ownerId: wire.ownerId,
      deckId: wire.deckId,
      front: wire.front,
      back: wire.back,
      alternateAnswers: wire.alternateAnswers,
      labels: wire.labels,
      createdAt: wire.createdAt,
      updatedAt: wire.updatedAt,
      deletedAt: wire.deletedAt,
      scheduling: wire.scheduling,
      dirty: 0,
    });
    return;
  }

  const contentStale =
    new Date(local.updatedAt).getTime() > new Date(wire.updatedAt).getTime();

  const localLastReviewed = local.scheduling.lastReviewedAt
    ? new Date(local.scheduling.lastReviewedAt).getTime()
    : null;
  const wireLastReviewed = wire.scheduling.lastReviewedAt
    ? new Date(wire.scheduling.lastReviewedAt).getTime()
    : null;
  const schedulingStale =
    localLastReviewed !== null &&
    (wireLastReviewed === null || localLastReviewed > wireLastReviewed);

  if (contentStale && schedulingStale) return; // fully raced ahead locally

  await db.cards.put({
    ...local,
    front: contentStale ? local.front : wire.front,
    back: contentStale ? local.back : wire.back,
    alternateAnswers: contentStale
      ? local.alternateAnswers
      : wire.alternateAnswers,
    labels: contentStale ? local.labels : wire.labels,
    updatedAt: contentStale ? local.updatedAt : wire.updatedAt,
    deletedAt: contentStale ? local.deletedAt : wire.deletedAt,
    scheduling: schedulingStale ? local.scheduling : wire.scheduling,
    dirty: contentStale || schedulingStale ? 1 : 0,
  });
}

async function applyTestRun(wire: WireTestRun): Promise<void> {
  await db.testRuns.put({
    id: wire.id,
    ownerId: wire.ownerId,
    deckId: wire.deckId,
    startedAt: wire.startedAt,
    completedAt: wire.completedAt,
    questionCount: wire.questionCount,
    correctCount: wire.correctCount,
    deletedAt: wire.deletedAt,
    dirty: 0,
  });

  // Tombstoned run: cached question rows for it are no longer reachable on
  // this device (symmetric with DexieTestRunRepository.deleteByDeck).
  if (wire.deletedAt !== null) {
    await db.testRunQuestions.where("runId").equals(wire.id).delete();
  }
}

async function applyTestRunQuestion(wire: WireTestRunQuestion): Promise<void> {
  const local = await db.testRunQuestions.get(wire.id);
  if (local) {
    if (local.dirty === 1) await db.testRunQuestions.update(wire.id, { dirty: 0 });
    return; // immutable — local content, if any, is already final
  }
  await db.testRunQuestions.put({
    id: wire.id,
    runId: wire.runId,
    cardId: wire.cardId,
    cardFrontSnapshot: wire.cardFrontSnapshot,
    cardBackSnapshot: wire.cardBackSnapshot,
    userAnswer: wire.userAnswer,
    outcome: wire.outcome,
    similarity: wire.similarity,
    dirty: 0,
  });
}
