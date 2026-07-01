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
   * Grade a free-text answer against the correct answer.
   *
   * @param cardFront      The question shown to the user.
   * @param correctAnswer  The card's back (expected answer).
   * @param userAnswer     What the user typed.
   * @returns              A GradeResult with outcome and optional similarity.
   */
  grade(
    cardFront: string,
    correctAnswer: string,
    userAnswer: string,
  ): Promise<GradeResult>;
}
