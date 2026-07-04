/**
 * Card content import/export — JSON envelope for portability (not backup).
 *
 * Only authored card content travels (front, back, alternateAnswers, labels).
 * id, ownerId, deckId, timestamps, and scheduling are intentionally excluded —
 * they are per-device/per-import state, not content.
 */
import type { Card } from "@/lib/types";

export const IMPORT_EXPORT_FORMAT_VERSION = 1;

export interface ExportedCard {
  front: string;
  back: string;
  alternateAnswers: string[];
  labels: string[];
}

export interface ExportFile {
  formatVersion: number;
  exportedAt: string;
  deckName: string;
  cards: ExportedCard[];
}

export function buildExportFile(deckName: string, cards: Card[]): ExportFile {
  return {
    formatVersion: IMPORT_EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    deckName,
    cards: cards.map((c) => ({
      front: c.front,
      back: c.back,
      alternateAnswers: c.alternateAnswers,
      labels: c.labels,
    })),
  };
}

export interface ImportRowError {
  index: number;
  reason: string;
}

export interface ImportParseResult {
  cards: ExportedCard[];
  errors: ImportRowError[];
}

export type ImportParseOutcome =
  | { ok: true; result: ImportParseResult }
  | { ok: false; fileError: string };

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Two-tier validation: structural problems (bad JSON, wrong/missing format
 * version, missing cards array) reject the whole file — nothing is imported.
 * Once the file is structurally valid, each card entry is validated
 * independently; bad entries are reported and skipped, good ones proceed.
 */
export function parseImportFile(raw: string): ImportParseOutcome {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, fileError: "File is not valid JSON." };
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, fileError: "File does not contain a JSON object." };
  }

  const obj = data as Record<string, unknown>;

  if (obj.formatVersion !== IMPORT_EXPORT_FORMAT_VERSION) {
    return {
      ok: false,
      fileError: `Unsupported format version (expected ${IMPORT_EXPORT_FORMAT_VERSION}).`,
    };
  }

  if (!Array.isArray(obj.cards)) {
    return { ok: false, fileError: 'File is missing a "cards" array.' };
  }

  const cards: ExportedCard[] = [];
  const errors: ImportRowError[] = [];

  obj.cards.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      errors.push({ index, reason: "Entry is not an object." });
      return;
    }
    const e = entry as Record<string, unknown>;

    if (typeof e.front !== "string" || e.front.trim() === "") {
      errors.push({ index, reason: 'Missing or empty "front".' });
      return;
    }
    if (typeof e.back !== "string" || e.back.trim() === "") {
      errors.push({ index, reason: 'Missing or empty "back".' });
      return;
    }
    const alternateAnswers = e.alternateAnswers ?? [];
    if (!isStringArray(alternateAnswers)) {
      errors.push({
        index,
        reason: '"alternateAnswers" must be an array of strings.',
      });
      return;
    }
    const labels = e.labels ?? [];
    if (!isStringArray(labels)) {
      errors.push({ index, reason: '"labels" must be an array of strings.' });
      return;
    }

    cards.push({
      front: e.front.trim(),
      back: e.back.trim(),
      alternateAnswers,
      labels,
    });
  });

  return { ok: true, result: { cards, errors } };
}

/**
 * Plain-text import: one card per line, "front<TAB>back" or "front | back".
 * The fastest authoring path — pasting lines straight out of notes — so it
 * deliberately has no alternates/labels column; use CSV for that.
 */
export function parsePlainText(raw: string): ImportParseOutcome {
  const lines = raw.split(/\r?\n/);
  const cards: ExportedCard[] = [];
  const errors: ImportRowError[] = [];
  let sawAnyContent = false;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "") return; // blank lines are skipped silently
    sawAnyContent = true;

    const sep = line.includes("\t") ? "\t" : line.includes("|") ? "|" : null;
    if (!sep) {
      errors.push({
        index,
        reason: 'Expected "front<TAB>back" or "front | back".',
      });
      return;
    }
    const sepIndex = line.indexOf(sep);
    const front = line.slice(0, sepIndex).trim();
    const back = line.slice(sepIndex + 1).trim();
    if (!front) {
      errors.push({ index, reason: 'Missing "front".' });
      return;
    }
    if (!back) {
      errors.push({ index, reason: 'Missing "back".' });
      return;
    }
    cards.push({ front, back, alternateAnswers: [], labels: [] });
  });

  if (!sawAnyContent) {
    return { ok: false, fileError: "File is empty." };
  }
  return { ok: true, result: { cards, errors } };
}

/** Minimal RFC4180-ish CSV line splitter: handles double-quoted fields
 * (including embedded commas and "" as an escaped quote). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/**
 * CSV import: front,back,alternates,labels — alternates/labels are each a
 * single field with ";"-separated entries. An optional header row
 * ("front,back,...") is detected and skipped.
 */
export function parseCsv(raw: string): ImportParseOutcome {
  const lines = raw.split(/\r?\n/);
  const cards: ExportedCard[] = [];
  const errors: ImportRowError[] = [];
  let sawAnyContent = false;
  let sawFirstRow = false;

  lines.forEach((rawLine, index) => {
    if (rawLine.trim() === "") return; // blank lines are skipped silently
    sawAnyContent = true;

    const fields = parseCsvLine(rawLine).map((f) => f.trim());
    if (!sawFirstRow) {
      sawFirstRow = true;
      if (
        fields[0]?.toLowerCase() === "front" &&
        fields[1]?.toLowerCase() === "back"
      ) {
        return; // header row, skip
      }
    }

    const [front = "", back = "", altsRaw = "", labelsRaw = ""] = fields;
    if (!front) {
      errors.push({ index, reason: 'Missing "front".' });
      return;
    }
    if (!back) {
      errors.push({ index, reason: 'Missing "back".' });
      return;
    }
    const alternateAnswers = altsRaw
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    const labels = labelsRaw
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    cards.push({ front, back, alternateAnswers, labels });
  });

  if (!sawAnyContent) {
    return { ok: false, fileError: "File is empty." };
  }
  return { ok: true, result: { cards, errors } };
}

/** Dispatches to the right parser by file extension — the JSON envelope
 * (buildExportFile's own format) remains the default/fallback. */
export function parseImportByFilename(
  filename: string,
  raw: string,
): ImportParseOutcome {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "csv") return parseCsv(raw);
  if (ext === "txt") return parsePlainText(raw);
  return parseImportFile(raw);
}

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "deck";
}
