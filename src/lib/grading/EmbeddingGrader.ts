"use client";

/**
 * EmbeddingGrader — local, on-device Grader implementation.
 *
 * Uses transformers.js (WASM) to embed both the correct answer and the user's
 * answer, then computes cosine similarity.
 *
 * Model is lazy-loaded on first call and cached in module scope.
 *
 * Thresholds come from constants.ts so they are easy to tune.
 * Phase 2: expose per-deck threshold overrides via the options parameter;
 * the interface already accepts them — no grader rewrite needed.
 */

import type { GradeResult } from "@/lib/types";
import type { Grader } from "./Grader";
import {
  EMBEDDING_MODEL_ID,
  EMBEDDING_PASS_THRESHOLD,
  EMBEDDING_FAIL_THRESHOLD,
} from "@/lib/constants";
import { getPipeline } from "@/lib/models/pipelineCache";

type EmbeddingPipeline = (
  text: string,
  opts: Record<string, unknown>,
) => Promise<{ data: Float32Array }>;

function getEmbeddingPipeline(): Promise<EmbeddingPipeline> {
  return getPipeline<EmbeddingPipeline>("feature-extraction", EMBEDDING_MODEL_ID, {
    dtype: "q8",
  });
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class EmbeddingGrader implements Grader {
  private passThreshold: number;
  private failThreshold: number;

  /**
   * Per-instance embedding cache.  Keys are the raw text strings; values are
   * the normalised Float32Array embeddings.  Accepted-answer strings are stable
   * within a session, so they're embedded once and reused on every subsequent
   * call.  The user's typed answer is also cached (useful when the same phrasing
   * is submitted across cards, and harmless otherwise).
   *
   * The cache lives for the lifetime of the grader instance (one page session)
   * and is cleared automatically on navigation.
   */
  private embeddingCache = new Map<string, Float32Array>();

  constructor(
    passThreshold = EMBEDDING_PASS_THRESHOLD,
    failThreshold = EMBEDDING_FAIL_THRESHOLD,
  ) {
    this.passThreshold = passThreshold;
    this.failThreshold = failThreshold;
  }

  /** Returns a cached embedding or computes + caches a new one. */
  private async getCachedEmbedding(
    extractor: EmbeddingPipeline,
    text: string,
  ): Promise<Float32Array> {
    const cached = this.embeddingCache.get(text);
    if (cached) return cached;
    const output = await extractor(text, { pooling: "mean", normalize: true });
    const vec = output.data as Float32Array;
    this.embeddingCache.set(text, vec);
    return vec;
  }

  async grade(
    _cardFront: string,
    correctAnswers: string[],
    userAnswer: string,
  ): Promise<GradeResult> {
    if (correctAnswers.length === 0) {
      throw new Error("correctAnswers must contain at least one answer");
    }
    const extractor = await getEmbeddingPipeline();

    // Embed all accepted answers + user answer, reusing cache for repeated strings.
    const [userVec, ...acceptedVecs] = await Promise.all([
      this.getCachedEmbedding(extractor, userAnswer),
      ...correctAnswers.map((a) => this.getCachedEmbedding(extractor, a)),
    ]);

    // Take the best (maximum) similarity across all accepted answers, and
    // remember which one it was — callers use this to look up a stored
    // justification for the matched answer.
    let bestSimilarity = 0;
    let bestAnswer = correctAnswers[0];
    acceptedVecs.forEach((vec, i) => {
      const sim = cosineSimilarity(userVec, vec);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestAnswer = correctAnswers[i];
      }
    });

    let outcome: GradeResult["outcome"];
    if (bestSimilarity >= this.passThreshold) {
      outcome = "correct";
    } else if (bestSimilarity <= this.failThreshold) {
      outcome = "incorrect";
    } else {
      outcome = "ambiguous";
    }

    return { outcome, similarity: bestSimilarity, matchedAnswer: bestAnswer };
  }
}

/**
 * Convenience: pre-warm the embedding model so the first card in test mode
 * does not incur the full load delay. Call this on test-mode page mount.
 */
export function preloadEmbeddingModel(): void {
  // Fire-and-forget warm-up. Errors are intentionally ignored here because
  // the shared pipeline cache deletes its entry on rejection, so the next
  // grade() call will retry. A network error at preload time is not fatal.
  getEmbeddingPipeline().catch(() => undefined);
}
