import type { GradeResult } from "@/lib/types";

// ---------------------------------------------------------------------------
// Grader interface — Phase 2 seam
//
// The local embedding grader implements this.
// Phase 2: an LLM-backed grader will implement the same interface; the test-
// mode UI calls whichever implementation is injected — no UI changes needed.
// ---------------------------------------------------------------------------

export interface Grader {
  /**
   * Grade a free-text answer against one or more accepted answers.
   *
   * @param cardFront       The question shown to the user.
   * @param correctAnswers  All accepted answers: [card.back, ...card.alternateAnswers].
   *                        Passes if the user's answer matches ANY of them.
   * @param userAnswer      What the user typed.
   * @returns               A GradeResult with outcome and optional similarity.
   *                        similarity reflects the best match across all accepted answers.
   */
  grade(
    cardFront: string,
    correctAnswers: string[],
    userAnswer: string,
  ): Promise<GradeResult>;
}
