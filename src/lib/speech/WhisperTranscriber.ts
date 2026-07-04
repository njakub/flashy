"use client";

/**
 * WhisperTranscriber — the primary (and only) Transcriber implementation
 * (see Transcriber.ts and docs/feature-analysis-report.md §D). On-device
 * Whisper via @huggingface/transformers: the only option that works in
 * Firefox (no SpeechRecognition) *and* honors local-first privacy (Chrome's
 * SpeechRecognition streams audio to Google servers).
 *
 * Not preloaded — the model (~40 MB q8) only starts downloading once the
 * user actually taps the mic (kicked off in start(), so it warms in the
 * background while they're speaking; stop() awaits the same cached promise).
 *
 * Pipeline: getUserMedia -> MediaRecorder captures a Blob in whatever
 * container the browser defaults to -> decodeAudioData -> OfflineAudioContext
 * resamples/downmixes to 16 kHz mono (the shape transformers.js expects) ->
 * automatic-speech-recognition pipeline.
 */

import { getPipeline } from "@/lib/models/pipelineCache";
import { WHISPER_MODEL_ID } from "@/lib/constants";
import type { Transcriber, TranscriberState } from "./Transcriber";

type WhisperPipeline = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text: string } | { text: string }[]>;

function getWhisperPipeline(
  onProgress?: (info: { progress?: number }) => void,
): Promise<WhisperPipeline> {
  return getPipeline<WhisperPipeline>(
    "automatic-speech-recognition",
    WHISPER_MODEL_ID,
    { dtype: "q8" },
    onProgress,
  );
}

/** Standalone capability check (D2) — a plain function rather than an
 * instance getter accessed off a ref, so useTranscriber() can call it
 * directly during render without touching ref.current. */
export function isVoiceInputSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined" &&
    typeof WebAssembly !== "undefined"
  );
}

/** Decodes a recorded clip and resamples/downmixes it to 16 kHz mono —
 * OfflineAudioContext does both in one render pass. */
async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    void decodeCtx.close();
  }

  const targetSampleRate = 16000;
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.max(1, Math.ceil(decoded.duration * targetSampleRate)),
    targetSampleRate,
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

export class WhisperTranscriber implements Transcriber {
  private _state: TranscriberState = "idle";
  private _modelProgress: number | null = null;
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private cancelled = false;
  private listeners = new Set<() => void>();

  get state(): TranscriberState {
    return this._state;
  }

  get modelProgress(): number | null {
    return this._modelProgress;
  }

  get supported(): boolean {
    return isVoiceInputSupported();
  }

  /** Internal — subscribed by useTranscriber(); not part of the Transcriber port. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(state: TranscriberState): void {
    this._state = state;
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  async start(): Promise<void> {
    if (!this.supported) {
      throw new Error("Voice input isn't supported on this device.");
    }
    this.cancelled = false;
    this._modelProgress = null;
    this.setState("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.setState("idle");
      throw new Error("Microphone access was denied.");
    }
    if (this.cancelled) {
      stream.getTracks().forEach((t) => t.stop());
      this.setState("idle");
      return;
    }

    this.stream = stream;
    this.chunks = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder = recorder;
    recorder.start();
    this.setState("recording");

    // Warm the model while the user is speaking so stop() (usually) doesn't
    // have to wait for the download on top of transcription.
    void getWhisperPipeline((info) => {
      if (typeof info.progress === "number") {
        this._modelProgress = Math.round(info.progress);
        this.notify();
      }
    }).catch(() => {
      // Swallowed here — stop() below retries via the same cache key and
      // surfaces the real error to its caller if it fails again.
    });
  }

  async stop(): Promise<string> {
    if (this._state !== "recording" || !this.mediaRecorder) return "";

    const recorder = this.mediaRecorder;
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;
    this.releaseStream();

    if (this.cancelled) {
      this.setState("idle");
      return "";
    }

    this.setState("transcribing");
    try {
      const mimeType = this.chunks[0]?.type || "audio/webm";
      const blob = new Blob(this.chunks, { type: mimeType });
      const audio = await decodeToMono16k(blob);
      const pipeline = await getWhisperPipeline((info) => {
        if (typeof info.progress === "number") {
          this._modelProgress = Math.round(info.progress);
          this.notify();
        }
      });
      const result = await pipeline(audio, { language: "english" });
      const text = Array.isArray(result) ? (result[0]?.text ?? "") : result.text;
      return text.trim();
    } finally {
      this._modelProgress = null;
      this.setState("idle");
    }
  }

  cancel(): void {
    this.cancelled = true;
    if (this.mediaRecorder && this._state === "recording") {
      this.mediaRecorder.stop();
    }
    this.releaseStream();
    this._modelProgress = null;
    this.setState("idle");
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.mediaRecorder = null;
  }
}
