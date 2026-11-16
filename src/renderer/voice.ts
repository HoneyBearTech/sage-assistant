import { MAX_VOICE_SAMPLES, VOICE_SAMPLE_RATE } from "../shared/api.js";
import { VOICE_LIST_WAIT_MS } from "./voice-text.js";

// Voice in the window: recording while the talk key or button is held, turning the recording into
// plain 16 kHz mono sound, and reading replies aloud with the PC's own voices. Nothing here keeps
// state between window loads, and nothing is logged: not the sound, not the words. The texts and
// small rules are in voice-text.ts.

/**
 * One recording from the microphone with the browser's standard recorder. The microphone is
 * opened by `start` and closed as soon as the recording stops or is cancelled.
 */
export class Recording {
  private readonly chunks: Blob[] = [];
  private readonly stopped: Promise<void>;

  private constructor(
    private readonly stream: MediaStream,
    private readonly recorder: MediaRecorder,
  ) {
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    this.stopped = new Promise((resolve) => recorder.addEventListener("stop", () => resolve()));
    recorder.start();
  }

  static async start(): Promise<Recording> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      return new Recording(stream, new MediaRecorder(stream));
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      throw error;
    }
  }

  /** Stops recording, closes the microphone at once, and gives back what was recorded. */
  async stop(): Promise<Blob> {
    this.end();
    await this.stopped;
    return new Blob(this.chunks, { type: this.recorder.mimeType });
  }

  /** Stops and throws the recording away. */
  cancel(): void {
    this.end();
    this.chunks.length = 0;
  }

  private end(): void {
    if (this.recorder.state !== "inactive") this.recorder.stop();
    for (const track of this.stream.getTracks()) track.stop();
  }
}

/**
 * Decodes a recording and turns it into 16-bit, 16 kHz, one-channel sound, cut to at most
 * 30 seconds. Uses only the window's standard audio objects: no worklets, no workers.
 */
export async function toPcm16k(data: ArrayBuffer): Promise<Int16Array> {
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(data);
  } finally {
    void context.close().catch(() => undefined);
  }
  const length = Math.min(Math.ceil(decoded.duration * VOICE_SAMPLE_RATE), MAX_VOICE_SAMPLES);
  if (length <= 0) return new Int16Array(0);
  const offline = new OfflineAudioContext(1, length, VOICE_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const floats = rendered.getChannelData(0);
  const pcm = new Int16Array(Math.min(floats.length, MAX_VOICE_SAMPLES));
  for (let i = 0; i < pcm.length; i++) {
    const sample = Math.max(-1, Math.min(1, floats[i] ?? 0));
    pcm[i] = sample < 0 ? Math.round(sample * 32_768) : Math.round(sample * 32_767);
  }
  return pcm;
}

export type VoiceAvailability = "unknown" | "available" | "none";

/**
 * Reads replies aloud with the window's built-in speech, using only voices installed on this PC
 * (`localService`), so the text never goes to an online voice. The voice list loads late, so
 * "no voice" is decided only after the list says so, or after VOICE_LIST_WAIT_MS with no list.
 */
export class Speaker {
  availability: VoiceAvailability = "unknown";
  private current: SpeechSynthesisUtterance | null = null;

  constructor(
    private readonly synth: SpeechSynthesis | undefined,
    private readonly onChange: (speaker: Speaker) => void,
  ) {
    if (!synth) {
      this.availability = "none";
      return;
    }
    synth.addEventListener("voiceschanged", () => this.check(true));
    this.check(false);
    if (this.availability === "unknown") setTimeout(() => this.check(true), VOICE_LIST_WAIT_MS);
  }

  get speaking(): boolean {
    return this.current !== null;
  }

  /** Speaks `text`, replacing anything being spoken. False if there is no voice to speak with. */
  speak(text: string): boolean {
    const voice = this.localVoices()[0];
    if (!this.synth || !voice || !text.trim()) return false;
    this.synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    const done = () => {
      if (this.current !== utterance) return;
      this.current = null;
      this.onChange(this);
    };
    utterance.addEventListener("end", done);
    utterance.addEventListener("error", done);
    this.current = utterance;
    this.synth.speak(utterance);
    this.onChange(this);
    return true;
  }

  stop(): void {
    if (!this.synth || (!this.current && !this.synth.speaking)) return;
    this.current = null;
    this.synth.cancel();
    this.onChange(this);
  }

  /** Voices on this PC, the default one first, then English ones. */
  private localVoices(): SpeechSynthesisVoice[] {
    if (!this.synth) return [];
    const local = this.synth.getVoices().filter((voice) => voice.localService);
    const rank = (voice: SpeechSynthesisVoice) =>
      (voice.default ? 0 : 2) + (voice.lang.toLowerCase().startsWith("en") ? 0 : 1);
    return local.sort((a, b) => rank(a) - rank(b));
  }

  private check(final: boolean): void {
    const next: VoiceAvailability =
      this.localVoices().length > 0 ? "available" : final ? "none" : this.availability;
    if (next === this.availability) return;
    this.availability = next;
    this.onChange(this);
  }
}
