import type { DownloadResult, TranscribeResult, VoiceStatus } from "../../shared/api.js";
import type { FetchLike } from "../brain/brain.js";
import type { Logger } from "../log.js";
import { DOWNLOAD_MESSAGES, DownloadError, downloadModel, removeLeftovers } from "./download.js";
import {
  isModelReady,
  MAX_SAMPLES,
  MOONSHINE_TINY_EN,
  modelDir,
  type SpeechModel,
  totalSize,
} from "./model.js";
import type { Transcriber } from "./transcriber.js";

export const VOICE_MESSAGES = {
  needsDownload: "Voice needs its speech file first. Choose Download to get it (44 MB, once).",
  busy: "Sage is still working out the last recording. Try again in a moment.",
  alreadyDownloading: "The speech file is already downloading.",
} as const;

export interface VoiceDeps {
  dataDir: string;
  /** The main process's own question box; true only when the user chose Download. */
  confirmDownload: () => Promise<boolean>;
  transcriber: Transcriber;
  logger: Logger;
  fetch?: FetchLike;
  /** For tests only: the files to download (a fake server's addresses). */
  model?: SpeechModel;
}

/**
 * Voice in the main process: whether the speech file is there, its one-time download (only after
 * the user agrees in the main process's own box), and turning a recording into text. One
 * download and one recording at a time. Sound and words are never logged or written to disk.
 */
export class Voice {
  private readonly model: SpeechModel;
  private readonly fetch: FetchLike;
  private download: { controller: AbortController; received: number } | undefined;
  private working = false;

  constructor(private readonly deps: VoiceDeps) {
    this.model = deps.model ?? MOONSHINE_TINY_EN;
    this.fetch = deps.fetch ?? ((input, init) => fetch(input, init));
  }

  /** At start-up: deletes half-finished files from a download that was cut off. */
  async removeLeftovers(): Promise<void> {
    if (this.download) return;
    try {
      await removeLeftovers(this.deps.dataDir);
    } catch (error) {
      this.deps.logger.warn(`Leftover download files couldn't be deleted: ${String(error)}`);
    }
  }

  async status(): Promise<VoiceStatus> {
    const total = totalSize(this.model);
    if (this.download) return { model: "downloading", received: this.download.received, total };
    return {
      model: (await isModelReady(this.deps.dataDir, this.model)) ? "ready" : "missing",
      received: 0,
      total,
    };
  }

  /** Asks first (in the main process's box), then downloads and checks the speech file. */
  async downloadModel(): Promise<DownloadResult> {
    if (this.download) return { status: "failed", message: VOICE_MESSAGES.alreadyDownloading };
    if (await isModelReady(this.deps.dataDir, this.model)) return { status: "done" };
    let agreed: boolean;
    try {
      agreed = await this.deps.confirmDownload();
    } catch {
      agreed = false;
    }
    if (!agreed) return { status: "declined" };
    // The box may have been answered twice over (two windows' worth of clicks); one download only.
    if (this.download) return { status: "failed", message: VOICE_MESSAGES.alreadyDownloading };
    const current = { controller: new AbortController(), received: 0 };
    this.download = current;
    try {
      await downloadModel({
        dataDir: this.deps.dataDir,
        model: this.model,
        fetch: this.fetch,
        signal: current.controller.signal,
        onProgress: (progress) => {
          current.received = progress.received;
        },
      });
      this.deps.logger.info("The speech file was downloaded and checked.");
      return { status: "done" };
    } catch (error) {
      if (current.controller.signal.aborted) return { status: "cancelled" };
      if (error instanceof DownloadError) {
        this.deps.logger.warn(`The speech file download failed: ${error.message}`);
        return { status: "failed", message: error.message };
      }
      this.deps.logger.error("The speech file download failed", error);
      return { status: "failed", message: DOWNLOAD_MESSAGES.disk };
    } finally {
      this.download = undefined;
    }
  }

  /** Stops a download in progress; its half-finished files are deleted. */
  cancelDownload(): void {
    this.download?.controller.abort(new Error("cancelled"));
  }

  /** `samples` is 16 kHz mono sound, already checked for type and length by the IPC handler. */
  async transcribe(samples: Int16Array): Promise<TranscribeResult> {
    if (samples.length === 0 || samples.length > MAX_SAMPLES) {
      return { ok: false, message: "Sage couldn't read that recording." };
    }
    if (this.working) return { ok: false, message: VOICE_MESSAGES.busy };
    this.working = true;
    try {
      if (this.download || !(await isModelReady(this.deps.dataDir, this.model))) {
        return { ok: false, message: VOICE_MESSAGES.needsDownload, needsDownload: true };
      }
      const floats = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) floats[i] = (samples[i] ?? 0) / 32_768;
      return await this.deps.transcriber.transcribe(modelDir(this.deps.dataDir, this.model), floats);
    } finally {
      this.working = false;
    }
  }

  /** When Sage closes: stops the download and the helper. */
  dispose(): void {
    this.cancelDownload();
    this.deps.transcriber.dispose();
  }
}
