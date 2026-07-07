import { describe, expect, it, vi } from "vitest";
import { CodeAwareGrader } from "./CodeAwareGrader";
import type { Grader } from "./Grader";
import type { GradeResult } from "@/lib/types";

function fakeInner(result: GradeResult): Grader {
  return { grade: vi.fn().mockResolvedValue(result) };
}

describe("CodeAwareGrader — non-code cards", () => {
  it("delegates straight to the inner grader when neither side has a code fence", async () => {
    const innerResult: GradeResult = { outcome: "correct", similarity: 0.9 };
    const inner = fakeInner(innerResult);
    const grader = new CodeAwareGrader(inner);
    const result = await grader.grade("capital of France?", ["Paris"], "paris");
    expect(result).toBe(innerResult);
    expect(inner.grade).toHaveBeenCalledWith(
      "capital of France?",
      ["Paris"],
      "paris",
      undefined,
    );
  });

  it("forwards keyPoints to the inner grader unchanged", async () => {
    const inner = fakeInner({ outcome: "ambiguous" });
    const grader = new CodeAwareGrader(inner);
    await grader.grade("q", ["a"], "b", ["point 1", "point 2"]);
    expect(inner.grade).toHaveBeenCalledWith("q", ["a"], "b", [
      "point 1",
      "point 2",
    ]);
  });
});

describe("CodeAwareGrader — code cards", () => {
  const inner = fakeInner({ outcome: "incorrect" }); // should never be reached

  it("marks a normalized exact match as correct without calling the inner grader", async () => {
    const grader = new CodeAwareGrader(inner);
    const correct = ["```js\nfor (let i = 0; i < 3; i++) console.log(i);\n```"];
    const userAnswer = "for (let i = 0; i < 3; i++) console.log(i);";
    const result = await grader.grade("print 0,1,2", correct, userAnswer);
    expect(result).toEqual({ outcome: "correct", matchedAnswer: correct[0] });
    expect(inner.grade).not.toHaveBeenCalled();
  });

  it("ignores whitespace/comment differences when matching", async () => {
    const grader = new CodeAwareGrader(inner);
    const correct = ["```py\ndef f(x):\n    return x + 1\n```"];
    const userAnswer = "def f(x): return x + 1  # increment";
    const result = await grader.grade("increment fn", correct, userAnswer);
    expect(result.outcome).toBe("correct");
  });

  it("never returns 'incorrect' — a non-match is ambiguous, not wrong", async () => {
    const grader = new CodeAwareGrader(inner);
    const correct = ["```js\nfor (let i = 0; i < 3; i++) {}\n```"];
    const userAnswer = "while (i < 3) { i++; }"; // semantically similar, textually different
    const result = await grader.grade("loop", correct, userAnswer);
    expect(result).toEqual({ outcome: "ambiguous" });
    expect(inner.grade).not.toHaveBeenCalled();
  });

  it("treats a code card as such even if only the user's answer has a fence", async () => {
    const grader = new CodeAwareGrader(inner);
    const correct = ["x = 1"]; // plain accepted answer, no fence
    const userAnswer = "```py\nx = 1\n```";
    const result = await grader.grade("assign x", correct, userAnswer);
    expect(result).toEqual({ outcome: "correct", matchedAnswer: "x = 1" });
  });

  it("matches against whichever accepted answer (of several) is correct", async () => {
    const grader = new CodeAwareGrader(inner);
    const correct = ["```js\nconst a = 1;\n```", "```js\nlet a = 1;\n```"];
    const result = await grader.grade("declare a=1", correct, "let a = 1;");
    expect(result).toEqual({ outcome: "correct", matchedAnswer: correct[1] });
  });
});
