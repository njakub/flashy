import type { GradeResult } from "@/lib/types";
import type { Grader } from "./Grader";

/**
 * Wraps another Grader with a concept-card pre-check (see
 * docs/feature-analysis-report.md-style rationale, mirroring CodeAwareGrader):
 * concept cards are long-form interview-style answers ("Explain how the
 * event loop works") graded against a rubric of key points rather than a
 * short accepted-answer list. Cosine-similarity embeddings are trained for
 * short-text matching and are documented-unreliable on long answers, so this
 * grader never lets the inner grader see a concept card at all — it always
 * short-circuits to "ambiguous" (never "incorrect": a heuristic can't fail a
 * long answer), deferring to the self-grade checklist or the LLM cascade
 * (which is competent at long-form coverage judgment via /grade's rubric
 * mode — see LlmGrader).
 *
 * Intended as the OUTERMOST wrapper in the local grading chain (see
 * TestSession's localGrader construction) so a concept card whose answer
 * happens to contain a code fence still skips CodeAwareGrader's exact-match
 * logic rather than being treated as a code card.
 */
export class ConceptAwareGrader implements Grader {
  constructor(private readonly inner: Grader) {}

  async grade(
    cardFront: string,
    correctAnswers: string[],
    userAnswer: string,
    keyPoints?: string[],
  ): Promise<GradeResult> {
    if (keyPoints && keyPoints.length > 0) {
      return { outcome: "ambiguous" };
    }
    return this.inner.grade(cardFront, correctAnswers, userAnswer, keyPoints);
  }
}
