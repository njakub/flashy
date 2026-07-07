import type { Grader } from "./Grader";
import type { GradeResult } from "@/lib/types";
import { API_BASE_URL } from "@/lib/config";
import type { GradeRequestBody, GradeResponseBody } from "./wire";

/** Same shape as SyncEngine's AccessTokenGetter — resolves (and refreshes)
 *  the current access token, or null if there's no signed-in session. */
export type AccessTokenGetter = () => Promise<string | null>;

/**
 * Phase 2 grader — sends the question, accepted answers, and the user's
 * typed answer to flashy-api's POST /grade, which proxies to Claude so the
 * API key never reaches the client. Only fires when the caller (the AI
 * Grade button) invokes it — no automatic calls.
 *
 * Requires a signed-in session (the endpoint is JWT-guarded). Any failure —
 * signed out, network error, non-2xx response — throws, which TestSession's
 * handleSubmit already routes to the ambiguous/self-grade fallback, same as
 * an EmbeddingGrader failure.
 */
export class LlmGrader implements Grader {
  constructor(private readonly getAccessToken: AccessTokenGetter) {}

  async grade(
    cardFront: string,
    correctAnswers: string[],
    userAnswer: string,
    keyPoints?: string[],
  ): Promise<GradeResult> {
    const token = await this.getAccessToken();
    if (!token) {
      throw new Error("Sign in to use AI grade.");
    }

    const body: GradeRequestBody = {
      question: cardFront,
      acceptedAnswers: correctAnswers,
      userAnswer,
      ...(keyPoints && keyPoints.length > 0 ? { keyPoints } : {}),
    };

    const res = await fetch(`${API_BASE_URL}/grade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`AI grade failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as GradeResponseBody;

    return { outcome: data.outcome, rationale: data.rationale, coverage: data.coverage };
  }
}
