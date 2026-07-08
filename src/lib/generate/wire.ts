// ---------------------------------------------------------------------------
// Wire protocol for flashy-api's POST /generate — turns source material
// (pasted text or a PDF) into candidate flashcards for the review step.
//
// Hand-maintained mirror of flashy-api's src/generate/generate.schema.ts,
// same convention as src/lib/grading/wire.ts / src/lib/sync/wire.ts: the two
// projects deploy independently, so shape changes are made by hand in both.
// ---------------------------------------------------------------------------

/** Mirror of the server cap — pre-validate before the round trip. */
export const MAX_SOURCE_TEXT_CHARS = 100_000;
/** Raw PDF byte cap (server enforces the equivalent on the base64 string). */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export type GenerateSource =
  | { type: "text"; text: string }
  | { type: "pdf"; data: string }; // base64, no newlines

export interface GenerateRequestBody {
  source: GenerateSource;
  /** Target, not a contract — the server may return fewer cards. */
  targetCount: number;
}

/**
 * A generated candidate card — exactly the authored-content subset of Card
 * (same shape as importExport's ExportedCard): non-empty keyPoints ⇒ concept
 * card, labels are suggested topic tags.
 */
export interface CandidateCardWire {
  front: string;
  back: string;
  alternateAnswers: string[];
  keyPoints: string[];
  labels: string[];
}

export interface GenerateResponseBody {
  /** Empty is legitimate — thin source material. */
  cards: CandidateCardWire[];
}
