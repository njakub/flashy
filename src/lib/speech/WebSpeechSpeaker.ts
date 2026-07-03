"use client";

/**
 * WebSpeechSpeaker — the only Speaker implementation (see Speaker.ts).
 * Wraps window.speechSynthesis, the only TTS API compatible with "works
 * fully offline with no account" (OS-local voices, zero network, zero cost).
 *
 * Module-level singleton, not a class instantiated per-component:
 * speechSynthesis is itself a global singleton with no per-user state, and
 * no component needs to observe another component's speech — same
 * reasoning as the `scheduler` singleton export.
 *
 * Caveats handled here:
 * - Chrome pauses long utterances after ~15s in some versions, so text is
 *   split and queued sentence-by-sentence rather than spoken as one
 *   utterance (the Web Speech API plays multiple queued utterances in
 *   order automatically).
 * - speak() always cancels any in-flight utterance first so calls never
 *   overlap or queue up behind a stale one.
 */

import type { Speaker } from "./Speaker";

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

class WebSpeechSpeaker implements Speaker {
  private _speaking = false;
  private listeners = new Set<() => void>();

  get supported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  get speaking(): boolean {
    return this._speaking;
  }

  /** Internal — subscribed by useSpeaker(); not part of the public Speaker port. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setSpeaking(value: boolean): void {
    if (this._speaking === value) return;
    this._speaking = value;
    this.listeners.forEach((l) => l());
  }

  speak(text: string): void {
    if (!this.supported) return;
    this.cancel();
    const sentences = text.split(SENTENCE_SPLIT_RE).filter((s) => s.trim());
    if (sentences.length === 0) return;

    this.setSpeaking(true);
    let remaining = sentences.length;
    const settle = () => {
      remaining -= 1;
      if (remaining <= 0) this.setSpeaking(false);
    };
    for (const sentence of sentences) {
      const utterance = new SpeechSynthesisUtterance(sentence);
      utterance.onend = settle;
      utterance.onerror = settle;
      window.speechSynthesis.speak(utterance);
    }
  }

  cancel(): void {
    if (!this.supported) return;
    window.speechSynthesis.cancel();
    this.setSpeaking(false);
  }
}

/** The active speaker instance used throughout the app. */
export const webSpeechSpeaker: Speaker & { subscribe(listener: () => void): () => void } =
  new WebSpeechSpeaker();
