import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import type { CardStats, TestRun, TestRunQuestion } from "@/lib/types";
import type { TestRunRepository } from "./interfaces";

export class DexieTestRunRepository implements TestRunRepository {
  async saveRun(
    run: Omit<TestRun, "id">,
    questions: Omit<TestRunQuestion, "id" | "runId">[],
  ): Promise<TestRun> {
    const runId = uuidv4();
    const newRun: TestRun = { id: runId, ...run };

    const newQuestions: TestRunQuestion[] = questions.map((q) => ({
      id: uuidv4(),
      runId,
      ...q,
    }));

    // Write run + all questions in one Dexie transaction.
    await db.transaction("rw", db.testRuns, db.testRunQuestions, async () => {
      await db.testRuns.add(newRun);
      if (newQuestions.length > 0) {
        await db.testRunQuestions.bulkAdd(newQuestions);
      }
    });

    return newRun;
  }

  async getRunsByDeck(deckId: string): Promise<TestRun[]> {
    const runs = await db.testRuns.where("deckId").equals(deckId).toArray();
    // Newest first.
    return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getQuestionsForRun(runId: string): Promise<TestRunQuestion[]> {
    return db.testRunQuestions.where("runId").equals(runId).toArray();
  }

  /**
   * Single grouped pass over testRunQuestions for the given card ids.
   * O(history size for those cards) — no per-card round trips.
   */
  async getStatsByCards(cardIds: string[]): Promise<CardStats[]> {
    if (cardIds.length === 0) return [];

    const cardIdSet = new Set(cardIds);
    const rows = await db.testRunQuestions
      .where("cardId")
      .anyOf(cardIds)
      .toArray();

    const statsMap = new Map<string, CardStats>();
    for (const id of cardIdSet) {
      statsMap.set(id, { cardId: id, attempts: 0, correct: 0 });
    }

    for (const row of rows) {
      const s = statsMap.get(row.cardId);
      if (!s) continue;
      s.attempts += 1;
      if (row.outcome === "correct") s.correct += 1;
    }

    return Array.from(statsMap.values());
  }

  async deleteByDeck(deckId: string): Promise<void> {
    const runs = await db.testRuns.where("deckId").equals(deckId).toArray();
    const runIds = runs.map((r) => r.id);

    await db.transaction("rw", db.testRuns, db.testRunQuestions, async () => {
      if (runIds.length > 0) {
        await db.testRunQuestions.where("runId").anyOf(runIds).delete();
      }
      await db.testRuns.where("deckId").equals(deckId).delete();
    });
  }
}
