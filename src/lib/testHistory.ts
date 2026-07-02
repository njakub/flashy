/**
 * Test-history helpers — pure functions over already-fetched repository data.
 * No DB access here; this is a join across CardRepository and
 * TestRunRepository results, which is why it lives outside both repos.
 *
 * Label attribution is a deliberate choice, not an oversight: TestRunQuestion
 * snapshots front/back at test time so those stay accurate after a card is
 * edited/deleted, but it does NOT snapshot labels. Per-label accuracy here is
 * computed against each card's CURRENT labels, so relabelling a card
 * retroactively moves its history, and deleting a card drops its questions
 * out of every label view (they still count toward a run's "Overall" total,
 * which comes from the stored TestRun.questionCount/correctCount). This was
 * chosen over adding a labelsSnapshot field to TestRunQuestion because, for a
 * personal study tool, "how am I doing on X" should mean X as currently
 * understood, not an early/wrong taxonomy frozen at test time. If immutable
 * per-label history is ever wanted, add `labelsSnapshot: string[]` to
 * TestRunQuestion and populate it in TestSession.finishRun.
 */
import type { Card, TestRun, TestRunQuestion } from "@/lib/types";

export function cardLabelsById(cards: Card[]): Map<string, string[]> {
  return new Map(cards.map((c) => [c.id, c.labels ?? []]));
}

export function distinctLabels(cards: Card[]): string[] {
  const set = new Set<string>();
  for (const c of cards) {
    for (const l of c.labels ?? []) set.add(l);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function groupQuestionsByRun(
  questions: TestRunQuestion[],
): Map<string, TestRunQuestion[]> {
  const map = new Map<string, TestRunQuestion[]>();
  for (const q of questions) {
    const list = map.get(q.runId);
    if (list) list.push(q);
    else map.set(q.runId, [q]);
  }
  return map;
}

export interface LabelStats {
  label: string;
  attempts: number;
  correct: number;
}

/** One grouped pass over all history rows, bucketed by each card's current labels. */
export function computeLabelStats(
  questions: TestRunQuestion[],
  cardLabels: Map<string, string[]>,
): LabelStats[] {
  const buckets = new Map<string, { attempts: number; correct: number }>();
  for (const q of questions) {
    const labels = cardLabels.get(q.cardId);
    if (!labels || labels.length === 0) continue; // unlabelled, or card deleted — nothing to attribute to
    const isCorrect = q.outcome === "correct";
    for (const label of labels) {
      const bucket = buckets.get(label) ?? { attempts: 0, correct: 0 };
      bucket.attempts += 1;
      if (isCorrect) bucket.correct += 1;
      buckets.set(label, bucket);
    }
  }
  return Array.from(buckets.entries())
    .map(([label, s]) => ({ label, ...s }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export interface RunListEntry {
  run: TestRun;
  questionCount: number;
  correctCount: number;
}

/**
 * Runs for the list view, optionally rescored/filtered by a label.
 * Unfiltered (label === null): uses the stored run totals — a stable figure
 * unaffected by later relabelling/deletion.
 * Filtered: rescored against matching questions only; runs with no matching
 * questions are dropped (a run "appears" only if it contains matching cards).
 */
export function runListForLabel(
  runs: TestRun[],
  questionsByRun: Map<string, TestRunQuestion[]>,
  cardLabels: Map<string, string[]>,
  label: string | null,
): RunListEntry[] {
  if (label === null) {
    return runs.map((run) => ({
      run,
      questionCount: run.questionCount,
      correctCount: run.correctCount,
    }));
  }
  const entries: RunListEntry[] = [];
  for (const run of runs) {
    const questions = questionsByRun.get(run.id) ?? [];
    const matched = questions.filter((q) =>
      (cardLabels.get(q.cardId) ?? []).includes(label),
    );
    if (matched.length === 0) continue;
    entries.push({
      run,
      questionCount: matched.length,
      correctCount: matched.filter((q) => q.outcome === "correct").length,
    });
  }
  return entries;
}

export function formatDuration(startedAt: string, completedAt: string): string {
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
