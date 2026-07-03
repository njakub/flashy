"use client";

import { useCallback, useState } from "react";

/**
 * Whether to show read-aloud (🔊) buttons — a device-local preference,
 * deliberately NOT synced through /users/me like gradingDefault: voices are
 * per-device (a voice chosen on macOS doesn't exist on Windows), so unlike
 * grading preference this has no meaningful cross-device value.
 */
const STORAGE_KEY = "flashy_speech_buttons_visible";

function readInitial(): boolean {
  if (typeof window === "undefined") return true;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? true : raw === "1";
}

export function useSpeechPrefs(): {
  showSpeakButtons: boolean;
  setShowSpeakButtons(value: boolean): void;
} {
  const [showSpeakButtons, setState] = useState<boolean>(readInitial);

  const setShowSpeakButtons = useCallback((value: boolean) => {
    setState(value);
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  }, []);

  return { showSpeakButtons, setShowSpeakButtons };
}
