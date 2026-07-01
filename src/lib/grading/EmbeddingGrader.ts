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

// Module-level cache so the model is only loaded once per page session.
let pipelinePromise: Promise<unknown> | null = null;

async function getPipeline() {
  if (!pipelinePromise) {
    // Dynamic import keeps the large WASM bundle out of the initial JS payload.
    pipelinePromise = import("@huggingface/transformers")
      .then(async ({ pipeline }) => {
        return pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
          dtype: "q8",
        });
      })
      .catch((err) => {
        // Reset so the next call can retry rather than permanently failing.
        pipelinePromise = null;
        throw err;
      });
  }
  return pipelinePromise as Promise<
    (
      text: string,
      opts: Record<string, unknown>,
    ) => Promise<{ data: Float32Array }>
  >;
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

async function embed(
  extractor: Awaited<ReturnType<typeof getPipeline>>,
  text: string,
): Promise<Float32Array> {
  const output = await extractor(text, {
    pooling: "mean",
    normalize: true,
  });
  return output.data as Float32Array;
}

export class EmbeddingGrader implements Grader {
  private passThreshold: number;
  private failThreshold: number;

  constructor(
    passThreshold = EMBEDDING_PASS_THRESHOLD,
    failThreshold = EMBEDDING_FAIL_THRESHOLD,
  ) {
    this.passThreshold = passThreshold;
    this.failThreshold = failThreshold;
  }

  async grade(
    _cardFront: string,
    correctAnswer: string,
    userAnswer: string,
  ): Promise<GradeResult> {
    const extractor = await getPipeline();
    const [correctVec, userVec] = await Promise.all([
      embed(extractor, correctAnswer),
      embed(extractor, userAnswer),
    ]);

    const similarity = cosineSimilarity(correctVec, userVec);

    let outcome: GradeResult["outcome"];
    if (similarity >= this.passThreshold) {
      outcome = "correct";
    } else if (similarity <= this.failThreshold) {
      outcome = "incorrect";
    } else {
      outcome = "ambiguous";
    }

    return { outcome, similarity };
  }
}

/**
 * Convenience: pre-warm the embedding model so the first card in test mode
 * does not incur the full load delay. Call this on test-mode page mount.
 */
export function preloadEmbeddingModel(): void {
  // Fire-and-forget warm-up. Errors are intentionally ignored here because
  // getPipeline() resets pipelinePromise on failure, so the next grade() call
  // will retry. A network error at preload time is not fatal.
  getPipeline().catch(() => undefined);
}
