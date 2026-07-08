import type { Grader } from "./Grader";
import type { GradeResult } from "@/lib/types";
import { API_BASE_URL } from "@/lib/config";
import type {
  GradeFeedbackRequestBody,
  GradeRequestBody,
  GradeResponseBody,
  LocalSignalWire,
} from "./wire";

/** Same shape as SyncEngine's AccessTokenGetter — resolves (and refreshes)
 *  the current access token, or null if there's no signed-in session. */
export type AccessTokenGetter = () => Promise<string | null>;

/**
 * Phase 2 grader — sends the question, accepted answers, and the user's
 * typed answer to flashy-api's POST /grade, which proxies to the user's
 * configured grading model so no provider key ever reaches the client. Only
 * fires when the caller (the AI Grade button, or the cascade) invokes it —
 * no automatic calls.
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
    localSignal?: LocalSignalWire,
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
      ...(localSignal ? { localSignal } : {}),
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

    return {
      outcome: data.outcome,
      rationale: data.rationale,
      coverage: data.coverage,
      usageId: data.usageId,
    };
  }

  /**
   * Records the user's own final verdict against a prior AI grade — the
   * primary grading-quality signal behind the usage dashboard's agreement
   * metric. Best-effort: swallows failures, since it's telemetry, not a
   * user-visible action.
   */
  async sendFeedback(
    usageId: string,
    userVerdict: "correct" | "incorrect",
  ): Promise<void> {
    const token = await this.getAccessToken();
    if (!token) return;
    const body: GradeFeedbackRequestBody = { usageId, userVerdict };
    try {
      await fetch(`${API_BASE_URL}/grade/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      // Best-effort — losing a feedback sample doesn't affect the user.
    }
  }
}
