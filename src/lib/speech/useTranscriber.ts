"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WhisperTranscriber, isVoiceInputSupported } from "./WhisperTranscriber";
import type { Transcriber } from "./Transcriber";

/**
 * Thin React-facing wrapper around a WhisperTranscriber instance. Unlike
 * useSpeaker (a shared singleton), each call owns its own transcriber —
 * a recording session is inherently per-use state — created once via
 * useRef and cancelled on unmount so a stray mic/model session never
 * outlives the component that started it.
 *
 * ref.current is only ever read inside effects/callbacks below, never
 * assigned to a render-body variable — reading a ref during render isn't
 * safe under React's rules (the value could be stale/inconsistent across a
 * retried render), even though in practice this instance never changes
 * after the lazy-init check.
 */
export function useTranscriber(): Transcriber {
  const transcriberRef = useRef<WhisperTranscriber | null>(null);
  if (transcriberRef.current == null) {
    transcriberRef.current = new WhisperTranscriber();
  }

  const [state, setState] = useState<Transcriber["state"]>("idle");
  const [modelProgress, setModelProgress] = useState<number | null>(null);

  useEffect(() => {
    const transcriber = transcriberRef.current;
    if (!transcriber) return;
    return transcriber.subscribe(() => {
      setState(transcriber.state);
      setModelProgress(transcriber.modelProgress);
    });
  }, []);

  useEffect(() => {
    return () => transcriberRef.current?.cancel();
  }, []);

  const start = useCallback(() => {
    const transcriber = transcriberRef.current;
    return transcriber ? transcriber.start() : Promise.resolve();
  }, []);
  const stop = useCallback(() => {
    const transcriber = transcriberRef.current;
    return transcriber ? transcriber.stop() : Promise.resolve("");
  }, []);
  const cancel = useCallback(() => {
    transcriberRef.current?.cancel();
  }, []);

  return {
    start,
    stop,
    cancel,
    state,
    supported: isVoiceInputSupported(),
    modelProgress,
  };
}
