import type { PublicSettings } from "../shared/api.js";

// The window's voice texts and small rules, without the browser's audio objects, so the tests
// can check them directly.

/** A tap shorter than this records almost nothing, so it is ignored. */
export const MIN_RECORDING_MS = 400;
/** At most 30 seconds per recording; it stops by itself after that. */
export const MAX_RECORDING_MS = 30_000;
/** How long to wait for the PC's voice list before deciding there is no voice. */
export const VOICE_LIST_WAIT_MS = 10_000;

export const VOICE_TEXT = {
  listening: (ms: number) => `Listening… ${formatSeconds(ms)}`,
  working: "Working out what you said…",
  tap: "Hold the key or the Talk button while you speak, and let go when you're done.",
  nothingHeard: "Sage didn't catch any words. Hold the key and try again.",
  lostFocus: "Sage stopped listening because its window lost focus.",
  badRecording: "Sage couldn't use that recording. Try again.",
  offer: "Voice needs a one-time 44 MB speech file before it can work.",
  asking: "Sage is asking whether to download the speech file…",
  downloading: (received: number, total: number) =>
    `Downloading the speech file… ${megabytes(received)} of ${megabytes(total)} MB`,
  waitForDownload: "Wait for the speech file to finish downloading.",
  ready: "Voice is ready. Hold Ctrl+Space or the Talk button while you speak.",
  declined: "The speech file wasn't downloaded. Voice needs it to work.",
  cancelled: "The download was cancelled.",
  downloadFailed: "Sage couldn't download the speech file. Try again.",
  noVoice: "This PC has no voice installed for reading replies aloud, so replies stay as text.",
} as const;

export function formatSeconds(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function megabytes(bytes: number): number {
  return Math.round(bytes / 1_000_000);
}

/** Plain messages for the microphone errors getUserMedia gives. */
export function micErrorMessage(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Sage can't use the microphone because it's blocked. On Windows, open Settings > Privacy & security > Microphone, turn on microphone access and \"Let desktop apps access your microphone\", then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Sage can't find a microphone. Plug one in, then try again.";
    case "NotReadableError":
    case "AbortError":
      return "The microphone is busy or isn't working. Close other apps that use it, then try again.";
    default:
      return "Sage couldn't start the microphone. Try again.";
  }
}

/** The transcript goes into the message box, after anything already there. */
export function appendTranscript(current: string, text: string): string {
  const words = text.trim();
  if (!words) return current;
  if (!current.trim()) return words;
  return /\s$/.test(current) ? `${current}${words}` : `${current} ${words}`;
}

export function shouldSpeak(setting: PublicSettings["speakReplies"], fromVoice: boolean): boolean {
  return setting === "always" || (setting === "voice" && fromVoice);
}
