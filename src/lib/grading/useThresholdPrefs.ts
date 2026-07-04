"use client";

import { useCallback, useState } from "react";
import {
  DEFAULT_THRESHOLD_PRESET_KEY,
  getThresholdPreset,
  type ThresholdPreset,
} from "./thresholdPresets";

/**
 * Grading strictness preset — device-local (localStorage), NOT synced
 * through /users/me. The right band is content-dependent (vocab decks want
 * strict, essay-style decks want lenient) and, unlike gradingDefault, there's
 * no cross-device reason this needs to follow the account; keeping it local
 * avoids a flashy-api change (Prisma schema + hand-mirrored wire protocol)
 * for a preference a user is just as likely to want to vary per-device
 * anyway. See docs/feature-analysis-report.md §E6.
 */
const STORAGE_KEY = "flashy_threshold_preset";

function readInitialKey(): string {
  if (typeof window === "undefined") return DEFAULT_THRESHOLD_PRESET_KEY;
  return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THRESHOLD_PRESET_KEY;
}

export function useThresholdPrefs(): {
  preset: ThresholdPreset;
  setPresetKey(key: string): void;
} {
  const [key, setKey] = useState<string>(readInitialKey);

  const setPresetKey = useCallback((next: string) => {
    setKey(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  return { preset: getThresholdPreset(key), setPresetKey };
}
