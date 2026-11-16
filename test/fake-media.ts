// Stand-ins for the window's microphone, recorder, audio decoding and built-in speech, so the real
// window script's voice code can run under the tests. Nothing here records or plays anything.

type Listener = (event: any) => void;

class Emitter {
  private readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

export class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

export class FakeStream {
  readonly tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
  get open() {
    return this.tracks.some((track) => !track.stopped);
  }
}

export class FakeMediaRecorder extends Emitter {
  static readonly made: FakeMediaRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  readonly mimeType = "audio/webm";
  constructor(readonly stream: FakeStream) {
    super();
    FakeMediaRecorder.made.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    // As in the browser, the data and the stop event come a moment later.
    queueMicrotask(() => {
      this.emit("dataavailable", { data: new Blob([new Uint8Array([1, 2, 3, 4])]) });
      this.emit("stop");
    });
  }
}

export interface FakeVoice {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
  voiceURI: string;
}

export class FakeUtterance extends Emitter {
  voice: FakeVoice | null = null;
  lang = "";
  constructor(readonly text: string) {
    super();
  }
}

export class FakeSpeech extends Emitter {
  voices: FakeVoice[] = [];
  readonly spoken: FakeUtterance[] = [];
  current: FakeUtterance | null = null;
  cancels = 0;
  get speaking() {
    return this.current !== null;
  }
  getVoices() {
    return [...this.voices];
  }
  speak(utterance: FakeUtterance) {
    this.spoken.push(utterance);
    this.current = utterance;
  }
  cancel() {
    this.cancels++;
    const current = this.current;
    this.current = null;
    current?.emit("end");
  }
  /** The current utterance finishes by itself. */
  finish() {
    const current = this.current;
    this.current = null;
    current?.emit("end");
  }
  /** The voice list arrives (late, as in Chromium). */
  loadVoices(voices: FakeVoice[]) {
    this.voices = voices;
    this.emit("voiceschanged");
  }
}

export function voice(name: string, extra: Partial<FakeVoice> = {}): FakeVoice {
  return { name, lang: "en-US", localService: true, default: false, voiceURI: name, ...extra };
}

/** What the tests control: the microphone's answer, the recording's length, and the speech object. */
export interface FakeMedia {
  /** The next getUserMedia answer; by default a fresh stream. */
  nextMic: () => Promise<FakeStream>;
  readonly streams: FakeStream[];
  readonly constraints: unknown[];
  /** How long each decoded recording is, in seconds. */
  recordingSeconds: number;
  /** The level of every sample the "recording" turns into. */
  level: number;
  speech: FakeSpeech;
  /** Every audio context the window made (for decoding recordings, or for sounds). */
  readonly audioContexts: unknown[];
  /** Every note the window's sounds started, by starting frequency. */
  readonly tones: number[];
}

const saved = new Map<string, PropertyDescriptor | undefined>();
const NAMES = [
  "navigator",
  "MediaRecorder",
  "AudioContext",
  "OfflineAudioContext",
  "speechSynthesis",
  "SpeechSynthesisUtterance",
] as const;

export function installFakeMedia(): FakeMedia {
  const media: FakeMedia = {
    nextMic: async () => new FakeStream(),
    streams: [],
    constraints: [],
    recordingSeconds: 2,
    level: 0.5,
    speech: new FakeSpeech(),
    audioContexts: [],
    tones: [],
  };
  media.speech.voices = [voice("Local English", { default: true })];

  const param = () => {
    const values: number[] = [];
    return {
      values,
      setValueAtTime: (value: number) => values.push(value),
      linearRampToValueAtTime: (value: number) => values.push(value),
      exponentialRampToValueAtTime: (value: number) => values.push(value),
    };
  };
  class FakeAudioContext {
    closed = false;
    readonly currentTime = 0;
    readonly destination = {};
    state = "running";
    constructor() {
      media.audioContexts.push(this);
    }
    async resume() {}
    createOscillator() {
      const frequency = param();
      return {
        type: "sine",
        frequency,
        connect() {},
        start() {
          media.tones.push(frequency.values[0] ?? 0);
        },
        stop() {},
      };
    }
    createGain() {
      return { gain: param(), connect() {} };
    }
    async decodeAudioData(data: ArrayBuffer) {
      if (data.byteLength === 0) throw new DOMException("empty", "EncodingError");
      return { duration: media.recordingSeconds, numberOfChannels: 2, sampleRate: 48_000 };
    }
    async close() {
      this.closed = true;
    }
  }
  class FakeOfflineAudioContext {
    readonly destination = {};
    constructor(
      readonly channels: number,
      readonly length: number,
      readonly sampleRate: number,
    ) {}
    createBufferSource() {
      return { buffer: null as unknown, connect() {}, start() {} };
    }
    async startRendering() {
      const data = new Float32Array(this.length).fill(media.level);
      return { getChannelData: () => data };
    }
  }

  const values: Record<(typeof NAMES)[number], unknown> = {
    navigator: {
      mediaDevices: {
        getUserMedia: async (constraints: unknown) => {
          media.constraints.push(constraints);
          const stream = await media.nextMic();
          media.streams.push(stream);
          return stream;
        },
      },
    },
    MediaRecorder: FakeMediaRecorder,
    AudioContext: FakeAudioContext,
    OfflineAudioContext: FakeOfflineAudioContext,
    speechSynthesis: media.speech,
    SpeechSynthesisUtterance: FakeUtterance,
  };
  for (const name of NAMES) {
    if (!saved.has(name)) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value: values[name], configurable: true, writable: true });
  }
  FakeMediaRecorder.made.length = 0;
  return media;
}

export function removeFakeMedia(): void {
  for (const name of NAMES) {
    const descriptor = saved.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  saved.clear();
}

/** A microphone error as getUserMedia gives it. */
export function micError(name: string): () => Promise<FakeStream> {
  return async () => {
    throw new DOMException("refused", name);
  };
}
