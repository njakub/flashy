// ---------------------------------------------------------------------------
// Transcriber port — mic → text. Mirrors Speaker/Grader in spirit, but is
// NOT a module-level singleton: unlike speechSynthesis, a recording session
// has real per-use state (an active MediaStream/MediaRecorder), so each
// useTranscriber() call owns its own instance (see useTranscriber.ts).
// ---------------------------------------------------------------------------

export type TranscriberState = "idle" | "requesting" | "recording" | "transcribing";

export interface Transcriber {
  /** Requests mic access and starts recording. Throws on permission denial
   * or an unsupported environment — callers should catch and degrade to the
   * typed path. */
  start(): Promise<void>;
  /** Stops recording, decodes + resamples the clip, and runs it through the
   * ASR model — returns the transcript (possibly empty). */
  stop(): Promise<string>;
  /** Abandons an in-progress recording/transcription without returning text. */
  cancel(): void;
  readonly state: TranscriberState;
  readonly supported: boolean;
  /** 0-100 while the ASR model is downloading; null once loaded or not yet
   * requested. Only meaningful during "recording"/"transcribing". */
  readonly modelProgress: number | null;
}
