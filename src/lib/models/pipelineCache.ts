"use client";

/**
 * Shared, keyed transformers.js pipeline cache — extracted from
 * EmbeddingGrader's original module-level pipelinePromise pattern so
 * WhisperTranscriber (voice input) can reuse the exact same lazy-load /
 * cache-once / reset-on-failure semantics without duplicating them.
 *
 * Keyed by `${task}:${modelId}` so independent task/model pairs (the
 * feature-extraction embedding model, the automatic-speech-recognition
 * Whisper model) don't collide. Each entry is deleted on rejection so the
 * next call can retry rather than permanently failing.
 */

export type PipelineTask = "feature-extraction" | "automatic-speech-recognition";

export interface PipelineProgressInfo {
  status?: string;
  file?: string;
  /** 0-100 once known; absent for status-only events (e.g. "done"). */
  progress?: number;
}

const cache = new Map<string, Promise<unknown>>();

/**
 * Resolves (loading + caching as needed) the pipeline for `task`/`modelId`.
 * `onProgress` is only wired to the call that actually triggers the load —
 * a concurrent caller joining an in-flight load won't see progress events
 * from this call, which is an acceptable simplification since nothing in
 * this app calls getPipeline for the same key from two places at once.
 */
export async function getPipeline<T>(
  task: PipelineTask,
  modelId: string,
  options: Record<string, unknown> = {},
  onProgress?: (info: PipelineProgressInfo) => void,
): Promise<T> {
  const key = `${task}:${modelId}`;
  let promise = cache.get(key);
  if (!promise) {
    promise = import("@huggingface/transformers")
      .then(({ pipeline }) =>
        pipeline(task, modelId, {
          ...options,
          progress_callback: onProgress,
        }),
      )
      .catch((err) => {
        cache.delete(key);
        throw err;
      });
    cache.set(key, promise);
  }
  return promise as Promise<T>;
}
