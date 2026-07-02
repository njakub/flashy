/**
 * Wire protocol for POST /grade — mirrors flashy-api's src/grade/grade.schema.ts.
 * Kept as a hand-written mirror rather than a shared package since the two
 * projects deploy independently; the shapes must be changed in lockstep by
 * hand (same convention as src/lib/sync/wire.ts).
 */

export interface GradeRequestBody {
  question: string;
  acceptedAnswers: string[];
  userAnswer: string;
}

export interface GradeResponseBody {
  outcome: "correct" | "incorrect";
  rationale: string;
}
