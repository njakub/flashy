import { describe, expect, it } from "vitest";
import {
  buildExportFile,
  IMPORT_EXPORT_FORMAT_VERSION,
  parseCsv,
  parseImportByFilename,
  parseImportFile,
  parsePlainText,
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

describe("parsePlainText", () => {
  it("parses tab-separated front/back", () => {
    const result = parsePlainText("front1\tback1\nfront2\tback2");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.cards).toEqual([
        { front: "front1", back: "back1", alternateAnswers: [], labels: [] },
        { front: "front2", back: "back2", alternateAnswers: [], labels: [] },
      ]);
    }
  });

  it("parses pipe-separated front/back and trims whitespace", () => {
    const result = parsePlainText("  front1  |  back1  ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.cards).toEqual([
        { front: "front1", back: "back1", alternateAnswers: [], labels: [] },
      ]);
    }
  });

  it("skips blank lines silently", () => {
    const result = parsePlainText("front1|back1\n\n\nfront2|back2");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.cards).toHaveLength(2);
      expect(result.result.errors).toEqual([]);
    }
  });

  it("reports a per-row error for a line with no recognized separator, keeping good rows", () => {
    const result = parsePlainText("front1|back1\nno separator here\nfront2|back2");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.cards).toHaveLength(2);
      expect(result.result.errors).toEqual([{ index: 1, reason: expect.any(String) }]);
    }
  });

  it("reports a per-row error for a missing front or back", () => {
    const result = parsePlainText("|back1\nfront2|");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.cards).toEqual([]);
      expect(result.result.errors).toHaveLength(2);
    }
  });

  it("rejects an empty file", () => {
    expect(parsePlainText("   \n  \n")).toEqual({
      ok: false,
      fileError: "File is empty.",
    });
  });
});

describe("parseCsv", () => {
  it("parses front,back,alternates,labels with ';'-separated sub-lists", () => {
    const result = parseCsv("run,correr,corriendo;corre,verbs;irregular");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.cards).toEqual([
        {
          front: "run",
          back: "correr",
          alternateAnswers: ["corriendo", "corre"],
          labels: ["verbs", "irregular"],
        },
      ]);
    }
  });

  it("defaults alternates/labels to [] when those columns are omitted", () => {
    const result = parseCsv("front1,back1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.cards).toEqual([
        { front: "front1", back: "back1", alternateAnswers: [], labels: [] },
      ]);
    }
  });

  it("handles quoted fields containing commas", () => {
    const result = parseCsv('"1, 2, 3",back1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.cards[0].front).toBe("1, 2, 3");
    }
  });

  it("handles an escaped double-quote inside a quoted field", () => {
    const result = parseCsv('"say ""hi""",back1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.cards[0].front).toBe('say "hi"');
    }
  });

  it("detects and skips a front,back header row", () => {
    const result = parseCsv("front,back,alternates,labels\nq1,a1,,");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.cards).toEqual([
        { front: "q1", back: "a1", alternateAnswers: [], labels: [] },
      ]);
    }
  });

  it("does not mistake a real data row for a header", () => {
    const result = parseCsv("Front door,Back yard");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.cards).toEqual([
        { front: "Front door", back: "Back yard", alternateAnswers: [], labels: [] },
      ]);
    }
  });

  it("reports a per-row error for a missing front or back, keeping good rows", () => {
    const result = parseCsv("q1,a1\n,a2\nq3,");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.cards).toHaveLength(1);
      expect(result.result.errors.map((e) => e.index)).toEqual([1, 2]);
    }
  });

  it("rejects an empty file", () => {
    expect(parseCsv("")).toEqual({ ok: false, fileError: "File is empty." });
  });
});

describe("parseImportByFilename", () => {
  it("dispatches .csv to parseCsv", () => {
    const result = parseImportByFilename("deck.csv", "q1,a1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.cards[0].front).toBe("q1");
  });

  it("dispatches .txt to parsePlainText", () => {
    const result = parseImportByFilename("deck.txt", "q1|a1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.cards[0].front).toBe("q1");
  });

  it("dispatches .json (and anything else) to parseImportFile", () => {
    const result = parseImportByFilename(
      "deck.json",
      JSON.stringify({ formatVersion: IMPORT_EXPORT_FORMAT_VERSION, cards: [] }),
    );
    expect(result.ok).toBe(true);
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
