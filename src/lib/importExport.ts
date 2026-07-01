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

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "deck";
}
