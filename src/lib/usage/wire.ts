/**
 * Wire protocol for GET /usage/summary and GET /usage/recommendations —
 * mirrors flashy-api's src/usage/usage.controller.ts + aggregate.ts +
 * recommendation.ts. Hand-maintained mirror, same convention as
 * src/lib/settings/wire.ts.
 */

export type UsageRange = "7d" | "30d" | "90d";
export type LlmTaskId = "grading" | "generation";

export interface AgreementWire {
  userAgreeRate: number | null;
  userSamples: number;
  localDisagreeRate: number | null;
  localSamples: number;
}

export interface ModelSummaryWire {
  model: string;
  provider: string;
  displayName: string;
  task: LlmTaskId;
  calls: number;
  costUsd: number;
  avgCostPerCallUsd: number;
  avgLatencyMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  /** Only populated for grading rows — null for generation. */
  agreement: AgreementWire | null;
}

export interface DailyPointWire {
  date: string; // YYYY-MM-DD, UTC
  costUsdByModel: Record<string, number>;
  calls: number;
}

export interface UsageSummaryResponseBody {
  range: { from: string; to: string };
  totals: { costUsd: number; calls: number; failedCalls: number };
  byModel: ModelSummaryWire[];
  daily: DailyPointWire[];
}

export interface RecommendationWire {
  task: LlmTaskId;
  currentModel: string;
  recommendedModel: string;
  estCallsPerMonth: number;
  currentMonthlyCostUsd: number;
  projectedMonthlyCostUsd: number;
  projectedMonthlySavingsUsd: number;
  qualityNote: string;
  reason: string;
}

export interface RecommendationsResponseBody {
  recommendations: RecommendationWire[];
}
