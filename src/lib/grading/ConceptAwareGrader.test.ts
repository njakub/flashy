import { describe, expect, it, vi } from "vitest";
import { ConceptAwareGrader } from "./ConceptAwareGrader";
import type { Grader } from "./Grader";
import type { GradeResult } from "@/lib/types";

function fakeInner(result: GradeResult): Grader {
  return { grade: vi.fn().mockResolvedValue(result) };
}

describe("ConceptAwareGrader — non-concept cards", () => {
  it("delegates to the inner grader when keyPoints is absent", async () => {
    const innerResult: GradeResult = { outcome: "correct", similarity: 0.9 };
    const inner = fakeInner(innerResult);
    const grader = new ConceptAwareGrader(inner);
    const result = await grader.grade("capital of France?", ["Paris"], "paris");
    expect(result).toBe(innerResult);
    expect(inner.grade).toHaveBeenCalledWith(
      "capital of France?",
      ["Paris"],
      "paris",
      undefined,
    );
  });

  it("delegates to the inner grader when keyPoints is an empty array", async () => {
    const innerResult: GradeResult = { outcome: "incorrect" };
    const inner = fakeInner(innerResult);
    const grader = new ConceptAwareGrader(inner);
    const result = await grader.grade("q", ["a"], "b", []);
    expect(result).toBe(innerResult);
    expect(inner.grade).toHaveBeenCalledWith("q", ["a"], "b", []);
  });
});

describe("ConceptAwareGrader — concept cards", () => {
  it("short-circuits to ambiguous without calling the inner grader", async () => {
    const inner = fakeInner({ outcome: "incorrect" }); // should never be reached
    const grader = new ConceptAwareGrader(inner);
    const keyPoints = ["closures capture variables", "closures persist scope"];
    const result = await grader.grade(
      "What are closures?",
      ["A closure is a function bundled with its lexical scope."],
      "A closure remembers variables from where it was created.",
      keyPoints,
    );
    expect(result).toEqual({ outcome: "ambiguous" });
    expect(inner.grade).not.toHaveBeenCalled();
  });

  it("never returns 'correct' or 'incorrect' for a concept card — always ambiguous", async () => {
    const inner = fakeInner({ outcome: "correct", similarity: 0.99 });
    const grader = new ConceptAwareGrader(inner);
    const result = await grader.grade("q", ["a"], "a", ["point 1"]);
    expect(result.outcome).toBe("ambiguous");
  });
});
