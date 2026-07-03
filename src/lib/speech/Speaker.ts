// ---------------------------------------------------------------------------
// Speaker port — mirrors Grader (src/lib/grading/Grader.ts): one interface,
// one implementation today (WebSpeechSpeaker), swappable later behind the
// same shape (e.g. an ApiSpeaker proxied through flashy-api for signed-in
// users) without touching call sites.
// ---------------------------------------------------------------------------

export interface Speaker {
  /** Speaks `text` aloud. Cancels any utterance already in progress first —
   * speak() never queues behind a previous call. */
  speak(text: string): void;
  cancel(): void;
  readonly speaking: boolean;
  readonly supported: boolean;
}
