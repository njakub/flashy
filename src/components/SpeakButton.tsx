"use client";

import { useSpeaker } from "@/lib/speech/useSpeaker";
import { useSpeechPrefs } from "@/lib/speech/useSpeechPrefs";
import { isCodeOnly, speakableText } from "@/lib/content/markdown";

interface Props {
  text: string;
  className?: string;
}

/**
 * Button-initiated read-aloud (🔊) — never auto-speaks (C5): screen-reader
 * users whose SR shares the same OS TTS engine shouldn't get double audio
 * they didn't request. Renders nothing when the user has hidden speak
 * buttons, the platform has no SpeechSynthesis, or there's nothing to say.
 */
export function SpeakButton({ text, className }: Props) {
  const { speak, cancel, speaking, supported } = useSpeaker();
  const { showSpeakButtons } = useSpeechPrefs();

  const spoken = speakableText(text);
  if (!showSpeakButtons || !supported || spoken === "") return null;

  const codeOnly = isCodeOnly(text);

  return (
    <button
      type="button"
      onClick={() => (speaking ? cancel() : speak(spoken))}
      disabled={codeOnly}
      aria-pressed={speaking}
      aria-label={speaking ? "Stop reading aloud" : "Read aloud"}
      title={
        codeOnly
          ? "This card is code-only — nothing to read aloud"
          : speaking
            ? "Stop reading aloud"
            : "Read aloud"
      }
      className={`text-meta transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        speaking ? "text-accent-hi" : "text-ink-3 hover:text-ink-1"
      } ${className ?? ""}`}
    >
      {speaking ? "◼" : "🔊"}
    </button>
  );
}
