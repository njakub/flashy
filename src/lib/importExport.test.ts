import { describe, expect, it } from "vitest";
import {
  buildExportFile,
  IMPORT_EXPORT_FORMAT_VERSION,
  parseImportFile,
  sanitizeFilename,
} from "./importExport";
import type { Card } from "@/lib/types";

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "c1",
    ownerId: "owner",
    deckId: "deck-1",
    front: "front",
    back: "back",
    alternateAnswers: ["alt"],
    labels: ["l1"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scheduling: {
      easeFactor: 2.5,
      intervalDays: 0,
      dueAt: "2026-01-01T00:00:00.000Z",
      reps: 0,
      lapses: 0,
      lastReviewedAt: null,
    },
    ...overrides,
  };
}

describe("buildExportFile", () => {
  it("excludes id/ownerId/deckId/timestamps/scheduling, keeps content only", () => {
    const file = buildExportFile("My Deck", [makeCard()]);
    expect(file.formatVersion).toBe(IMPORT_EXPORT_FORMAT_VERSION);
    expect(file.deckName).toBe("My Deck");
    expect(file.cards).toEqual([
      { front: "front", back: "back", alternateAnswers: ["alt"], labels: ["l1"] },
    ]);
  });
});

describe("parseImportFile — structural (whole-file) validation", () => {
  it("rejects invalid JSON", () => {
    const result = parseImportFile("not json");
    expect(result).toEqual({ ok: false, fileError: "File is not valid JSON." });
  });

  it("rejects a JSON array at the top level", () => {
    const result = parseImportFile("[]");
    expect(result.ok).toBe(false);
  });

  it("rejects a wrong/missing formatVersion", () => {
    const result = parseImportFile(JSON.stringify({ formatVersion: 99, cards: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fileError).toContain("format version");
  });

  it("rejects a missing cards array", () => {
    const result = parseImportFile(
      JSON.stringify({ formatVersion: IMPORT_EXPORT_FORMAT_VERSION }),
    );
    expect(result).toEqual({
      ok: false,
      fileError: 'File is missing a "cards" array.',
    });
  });
});

describe("parseImportFile — per-row validation", () => {
  function fileWith(cards: unknown[]): string {
    return JSON.stringify({ formatVersion: IMPORT_EXPORT_FORMAT_VERSION, cards });
  }

  it("accepts a well-formed row and trims front/back", () => {
    const result = parseImportFile(
      fileWith([{ front: "  q  ", back: "  a  ", alternateAnswers: ["x"], labels: ["y"] }]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.errors).toEqual([]);
      expect(result.result.cards).toEqual([
        { front: "q", back: "a", alternateAnswers: ["x"], labels: ["y"] },
      ]);
    }
  });

  it("defaults missing alternateAnswers/labels to []", () => {
    const result = parseImportFile(fileWith([{ front: "q", back: "a" }]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.cards).toEqual([
        { front: "q", back: "a", alternateAnswers: [], labels: [] },
      ]);
    }
  });

  it("skips a bad row but keeps good ones (partial success, not whole-file rejection)", () => {
    const result = parseImportFile(
      fileWith([
        { front: "good", back: "a" },
        { front: "", back: "a" }, // empty front
        { front: "q2" }, // missing back
        { front: "q3", back: "a", alternateAnswers: "not-an-array" },
        { front: "q4", back: "a", labels: [1, 2] },
        "not-an-object",
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.cards).toEqual([
        { front: "good", back: "a", alternateAnswers: [], labels: [] },
      ]);
      expect(result.result.errors.map((e) => e.index)).toEqual([1, 2, 3, 4, 5]);
    }
  });
});

describe("sanitizeFilename", () => {
  it("lowercases and hyphenates", () => {
    expect(sanitizeFilename("My Spanish Deck!")).toBe("my-spanish-deck");
  });

  it("strips leading/trailing hyphens produced by punctuation", () => {
    expect(sanitizeFilename("  ---weird--- ")).toBe("weird");
  });

  it("falls back to 'deck' when nothing alphanumeric remains", () => {
    expect(sanitizeFilename("!!!")).toBe("deck");
    expect(sanitizeFilename("")).toBe("deck");
  });
});
