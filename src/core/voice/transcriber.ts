import { type HelperReply, replySchema, type TranscribeRequest } from "./helper-protocol.js";
import { SAMPLE_RATE } from "./model.js";

export type TranscribeOutcome = { ok: true; text: string } | { ok: false; message: string };

/** Turns 16 kHz mono sound into text, one recording at a time. */
export interface Transcriber {
  transcribe(modelDir: string, samples: Float32Array): Promise<TranscribeOutcome>;
  /** Stops the helper, if one is running. */
  dispose(): void;
}

/** A running speech helper. The main process supplies Electron's utility process. */
export interface HelperProcess {
  send(message: TranscribeRequest): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
}

export type StartHelper = () => HelperProcess;

/** The longest one recording may take to turn into text before the helper is stopped. */
export const TRANSCRIBE_TIMEOUT_MS = 60_000;

export const TRANSCRIBE_MESSAGES = {
  busy: "Sage is still working out the last recording. Try again in a moment.",
  timeout: "Working out what you said took too long, so Sage stopped. Try again with a shorter recording.",
  crashed: "Sage's speech helper stopped unexpectedly. Try again.",
  failed: "Sage couldn't work out what you said. Try again.",
} as const;

interface Job {
  id: number;
  finish(outcome: TranscribeOutcome): void;
}

/**
 * Runs recognition in a separate helper process, started on first use. One job at a time; a job
 * that takes longer than TRANSCRIBE_TIMEOUT_MS stops the helper. If the helper crashes or is
 * stopped, the job gets a plain message and the next recording starts a fresh helper.
 */
export class HelperTranscriber implements Transcriber {
  private helper: HelperProcess | undefined;
  private job: Job | undefined;
  private nextId = 1;

  constructor(
    private readonly start: StartHelper,
    private readonly timeoutMs = TRANSCRIBE_TIMEOUT_MS,
  ) {}

  transcribe(modelDir: string, samples: Float32Array): Promise<TranscribeOutcome> {
    if (this.job) return Promise.resolve({ ok: false, message: TRANSCRIBE_MESSAGES.busy });
    return new Promise<TranscribeOutcome>((resolve) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.stopHelper();
        finish({ ok: false, message: TRANSCRIBE_MESSAGES.timeout });
      }, this.timeoutMs);
      const finish = (outcome: TranscribeOutcome) => {
        if (this.job?.id !== id) return;
        clearTimeout(timer);
        this.job = undefined;
        resolve(outcome);
      };
      this.job = { id, finish };
      let helper: HelperProcess;
      try {
        helper = this.ensureHelper();
        helper.send({ type: "transcribe", id, modelDir, sampleRate: SAMPLE_RATE, samples });
      } catch {
        this.stopHelper();
        finish({ ok: false, message: TRANSCRIBE_MESSAGES.crashed });
      }
    });
  }

  dispose(): void {
    this.stopHelper();
    this.job?.finish({ ok: false, message: TRANSCRIBE_MESSAGES.crashed });
  }

  private ensureHelper(): HelperProcess {
    if (this.helper) return this.helper;
    const helper = this.start();
    this.helper = helper;
    helper.onMessage((message) => {
      if (this.helper !== helper) return;
      this.onReply(message);
    });
    helper.onExit(() => {
      if (this.helper !== helper) return;
      // Started again for the next recording.
      this.helper = undefined;
      this.job?.finish({ ok: false, message: TRANSCRIBE_MESSAGES.crashed });
    });
    return helper;
  }

  private onReply(message: unknown): void {
    const parsed = replySchema.safeParse(message);
    if (!parsed.success || !this.job) return;
    const reply: HelperReply = parsed.data;
    if (reply.id !== this.job.id) return;
    this.job.finish(
      reply.type === "result"
        ? { ok: true, text: reply.text }
        : { ok: false, message: TRANSCRIBE_MESSAGES.failed },
    );
  }

  private stopHelper(): void {
    const helper = this.helper;
    this.helper = undefined;
    try {
      helper?.kill();
    } catch {
      // Already gone.
    }
  }
}
