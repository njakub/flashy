import { describe, expect, it } from "vitest";
import { isConceptCard } from "./concept";

describe("isConceptCard", () => {
  it("is false when keyPoints is undefined", () => {
    expect(isConceptCard({ keyPoints: undefined })).toBe(false);
  });

  it("is false when keyPoints is an empty array", () => {
    expect(isConceptCard({ keyPoints: [] })).toBe(false);
  });

  it("is true when keyPoints has at least one entry", () => {
    expect(isConceptCard({ keyPoints: ["closures capture variables"] })).toBe(true);
  });
});
