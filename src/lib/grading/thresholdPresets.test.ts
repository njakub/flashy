import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLD_PRESET_KEY,
  THRESHOLD_PRESETS,
  getThresholdPreset,
} from "./thresholdPresets";
import { EMBEDDING_FAIL_THRESHOLD, EMBEDDING_PASS_THRESHOLD } from "@/lib/constants";

describe("THRESHOLD_PRESETS", () => {
  it("the default preset matches the existing global constants exactly", () => {
    const def = getThresholdPreset(DEFAULT_THRESHOLD_PRESET_KEY);
    expect(def.passThreshold).toBe(EMBEDDING_PASS_THRESHOLD);
    expect(def.failThreshold).toBe(EMBEDDING_FAIL_THRESHOLD);
  });

  it("every preset keeps passThreshold strictly above failThreshold (a real ambiguous band)", () => {
    for (const p of THRESHOLD_PRESETS) {
      expect(p.passThreshold).toBeGreaterThan(p.failThreshold);
    }
  });

  it("presets are ordered strict -> lenient (monotonically decreasing thresholds)", () => {
    for (let i = 1; i < THRESHOLD_PRESETS.length; i++) {
      expect(THRESHOLD_PRESETS[i].passThreshold).toBeLessThanOrEqual(
        THRESHOLD_PRESETS[i - 1].passThreshold,
      );
      expect(THRESHOLD_PRESETS[i].failThreshold).toBeLessThanOrEqual(
        THRESHOLD_PRESETS[i - 1].failThreshold,
      );
    }
  });
});

describe("getThresholdPreset", () => {
  it("looks up a known preset by key", () => {
    expect(getThresholdPreset("strict").key).toBe("strict");
  });

  it("falls back to the default preset for an unknown key", () => {
    expect(getThresholdPreset("not-a-real-key").key).toBe(DEFAULT_THRESHOLD_PRESET_KEY);
  });
});
