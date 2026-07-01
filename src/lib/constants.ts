/**
 * Application-wide constants.
 *
 * LOCAL_USER_ID — placeholder owner for all local records.
 * Phase 2: replaced by real auth user IDs; no schema change needed.
 */
export const LOCAL_USER_ID = "local-user" as const;

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
