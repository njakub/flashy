/**
 * Application-wide constants.
 *
 * LOCAL_USER_ID — placeholder owner for all local records.
 * Phase 2: replaced by real auth user IDs; no schema change needed.
 */
export const LOCAL_USER_ID = "local-user" as const;

/**
 * Reserved label used to flag a card "needs review" from Study/Test result
 * screens. Just an ordinary entry in Card.labels — no schema, wire, or
 * server change — so it syncs as regular content and shows up in the
 * existing label filter/history views for free.
 */
export const FLAGGED_LABEL = "flagged" as const;

/**
 * Cosine-similarity thresholds for the embedding grader.
 *
 * >= PASS_THRESHOLD  → auto-correct
 * <= FAIL_THRESHOLD  → auto-incorrect
 * between the two   → ambiguous → self-grade
 *
 * These are top-level named constants so they are easy to tune.
 * Phase 2: expose per-deck overrides stored in DeckSettings; the grader
 * already receives them as parameters so no grader code changes are needed.
 */
export const EMBEDDING_PASS_THRESHOLD = 0.85;
export const EMBEDDING_FAIL_THRESHOLD = 0.6;

/**
 * The Hugging Face model id used by the local embedding grader.
 * Xenova/all-MiniLM-L6-v2 is 384-dim, ~23 MB WASM — small and fast.
 */
export const EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/**
 * The Hugging Face model id used by the on-device Whisper transcriber for
 * voice input (English-only, ~40 MB q8 WASM). Not preloaded — only fetched
 * on first mic tap (see src/lib/speech/WhisperTranscriber.ts).
 */
export const WHISPER_MODEL_ID = "onnx-community/whisper-tiny.en";

/**
 * Shown on a correct answer when no AI-authored justification is stored for
 * the matched answer (e.g. an exact/near-exact match graded by the free
 * embedding model). Picked at random purely for variety.
 */
export const GENERIC_SUCCESS_MESSAGES = [
  "You've nailed it!",
  "Exactly right!",
  "Spot on!",
  "Nice work!",
  "Correct!",
] as const;

export function randomSuccessMessage(): string {
  return GENERIC_SUCCESS_MESSAGES[
    Math.floor(Math.random() * GENERIC_SUCCESS_MESSAGES.length)
  ];
}
