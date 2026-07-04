import { EMBEDDING_FAIL_THRESHOLD, EMBEDDING_PASS_THRESHOLD } from "@/lib/constants";

/**
 * Named strictness presets for the embedding grader's pass/fail cosine
 * thresholds (see docs/feature-analysis-report.md §E6). "default" is
 * exactly EMBEDDING_PASS_THRESHOLD/EMBEDDING_FAIL_THRESHOLD so a user who
 * never touches this setting gets identical behavior to before.
 */
export interface ThresholdPreset {
  key: string;
  label: string;
  description: string;
  passThreshold: number;
  failThreshold: number;
}

export const THRESHOLD_PRESETS: readonly ThresholdPreset[] = [
  {
    key: "strict",
    label: "Strict",
    description: "Needs a near-exact match — good for vocabulary/terminology decks.",
    passThreshold: 0.92,
    failThreshold: 0.75,
  },
  {
    key: "firm",
    label: "Firm",
    description: "A bit stricter than default.",
    passThreshold: 0.88,
    failThreshold: 0.68,
  },
  {
    key: "default",
    label: "Default",
    description: "Balanced for most decks.",
    passThreshold: EMBEDDING_PASS_THRESHOLD,
    failThreshold: EMBEDDING_FAIL_THRESHOLD,
  },
  {
    key: "relaxed",
    label: "Relaxed",
    description: "A bit more forgiving than default.",
    passThreshold: 0.78,
    failThreshold: 0.5,
  },
  {
    key: "lenient",
    label: "Lenient",
    description: "Forgiving of paraphrasing — good for essay-style answers.",
    passThreshold: 0.7,
    failThreshold: 0.4,
  },
] as const;

export const DEFAULT_THRESHOLD_PRESET_KEY = "default";

export function getThresholdPreset(key: string): ThresholdPreset {
  return (
    THRESHOLD_PRESETS.find((p) => p.key === key) ??
    THRESHOLD_PRESETS.find((p) => p.key === DEFAULT_THRESHOLD_PRESET_KEY)!
  );
}
