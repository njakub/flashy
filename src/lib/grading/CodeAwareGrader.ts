import type { GradeResult } from "@/lib/types";
import type { Grader } from "./Grader";
import { hasCodeFence, normalizeCode, splitFences } from "@/lib/content/markdown";

/** Fenced code, if any; otherwise the whole text treated as raw code — a
 * user typing an answer to a code card won't wrap it in ``` fences. */
function codeContent(text: string): string {
  const codeSegments = splitFences(text).filter((s) => s.kind === "code");
  return codeSegments.length > 0
    ? codeSegments.map((s) => s.text).join("\n")
    : text;
}

/**
 * Wraps another Grader with a code-aware pre-check (see
 * docs/feature-analysis-report.md §B4): MiniLM/cosine embeddings are trained
 * on natural language, so two semantically-identical snippets (a for-loop vs
 * a while-loop) or two near-identical snippets differing by one token score
 * arbitrarily. When either side of the comparison contains a fenced code
 * block, this grader short-circuits the inner grader entirely — normalized
 * exact match on code content is "correct", anything else is "ambiguous"
 * (never an outright "incorrect": a single normalized-text heuristic can't
 * tell semantic equivalence from a real mistake, so it always defers to
 * self-grade or the LLM cascade, which is competent at code equivalence).
 */
export class CodeAwareGrader implements Grader {
  constructor(private readonly inner: Grader) {}

  async grade(
    cardFront: string,
    correctAnswers: string[],
    userAnswer: string,
    keyPoints?: string[],
  ): Promise<GradeResult> {
    const isCodeCard =
      correctAnswers.some(hasCodeFence) || hasCodeFence(userAnswer);
    if (!isCodeCard) {
      return this.inner.grade(cardFront, correctAnswers, userAnswer, keyPoints);
    }

    const userCode = normalizeCode(codeContent(userAnswer));
    const matchedAnswer = correctAnswers.find(
      (answer) => normalizeCode(codeContent(answer)) === userCode,
    );

    return matchedAnswer
      ? { outcome: "correct", matchedAnswer }
      : { outcome: "ambiguous" };
  }
}
