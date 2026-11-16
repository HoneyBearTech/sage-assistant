// Short sound effects, made by the window itself with the standard Web Audio oscillators: no sound
// files. A blip when you send, a rising two-note tone when you allow an action, and a low tone when
// Sage's box asks. Off unless switched on (the top bar's Sound switch). Nothing is made, not even
// the audio context, until the first sound is wanted while sound is on.
//
// Written against the few audio calls it uses (not the DOM's types), so the tests can run it with a
// stand-in.

export type SoundName = "send" | "allowed" | "asking";

/** One note: a wave from `from` Hz (sliding to `to`), starting `start` s in, `length` s long. */
export interface Tone {
  wave: "sine" | "triangle";
  from: number;
  to?: number;
  start: number;
  length: number;
  /** The loudest it gets, 0 to 1: all of them are quiet. */
  peak: number;
}

export const TONES: Record<SoundName, readonly Tone[]> = {
  // A short upward chirp.
  send: [{ wave: "sine", from: 740, to: 1110, start: 0, length: 0.07, peak: 0.05 }],
  // Two rising notes, C then G.
  allowed: [
    { wave: "triangle", from: 523.25, start: 0, length: 0.09, peak: 0.07 },
    { wave: "triangle", from: 783.99, start: 0.1, length: 0.13, peak: 0.07 },
  ],
  // A soft, low tone that falls a little.
  asking: [{ wave: "sine", from: 196, to: 174.61, start: 0, length: 0.34, peak: 0.09 }],
};

interface Param {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}

interface ToneNode {
  connect(destination: never): unknown;
}

/** The parts of the window's AudioContext the sounds use. */
export interface ToneContext {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly state: string;
  resume(): Promise<void>;
  createOscillator(): ToneNode & {
    type: string;
    frequency: Param;
    start(when: number): void;
    stop(when: number): void;
  };
  createGain(): ToneNode & { gain: Param };
}

export interface Sounds {
  readonly on: boolean;
  setOn(on: boolean): void;
  play(name: SoundName): void;
}

/** `makeContext` gives the window's audio context, or undefined where there is none. */
export function createSounds(makeContext: () => ToneContext | undefined): Sounds {
  let on = false;
  let context: ToneContext | undefined;

  function playTone(audio: ToneContext, tone: Tone): void {
    const at = audio.currentTime + tone.start;
    const end = at + tone.length;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = tone.wave;
    oscillator.frequency.setValueAtTime(tone.from, at);
    if (tone.to) oscillator.frequency.exponentialRampToValueAtTime(tone.to, end);
    // A quick rise and a smooth fall, so there is no click at either end.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(tone.peak, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain as never);
    gain.connect(audio.destination as never);
    oscillator.start(at);
    oscillator.stop(end + 0.02);
  }

  return {
    get on() {
      return on;
    },
    setOn(value) {
      on = value;
    },
    play(name) {
      if (!on) return;
      try {
        context ??= makeContext();
        const audio = context;
        if (!audio) return;
        if (audio.state === "suspended") void audio.resume().catch(() => undefined);
        for (const tone of TONES[name]) playTone(audio, tone);
      } catch {
        // A sound is never worth an error: without audio, Sage is simply quiet.
      }
    },
  };
}
