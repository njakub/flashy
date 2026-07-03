"use client";

import { useCallback, useEffect, useState } from "react";
import { webSpeechSpeaker } from "./WebSpeechSpeaker";
import type { Speaker } from "./Speaker";

/**
 * Thin React-facing wrapper around the webSpeechSpeaker singleton: subscribes
 * to speaking-state changes so callers get a reactive boolean, and cancels
 * any in-flight utterance when the component using it unmounts (leaving the
 * page mid-speech shouldn't leave audio playing against a gone screen).
 */
export function useSpeaker(): Speaker {
  const [, bump] = useState(0);

  useEffect(() => webSpeechSpeaker.subscribe(() => bump((n) => n + 1)), []);
  useEffect(() => () => webSpeechSpeaker.cancel(), []);

  const speak = useCallback((text: string) => webSpeechSpeaker.speak(text), []);
  const cancel = useCallback(() => webSpeechSpeaker.cancel(), []);

  return {
    speak,
    cancel,
    speaking: webSpeechSpeaker.speaking,
    supported: webSpeechSpeaker.supported,
  };
}
