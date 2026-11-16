import { createHash } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { FetchLike } from "../brain/brain.js";
import { type ModelFile, modelDir, modelsDir, partialDir, type SpeechModel } from "./model.js";

/** Hugging Face forwards each address to its download servers; more than this is refused. */
export const MAX_FORWARDS = 5;

/** A download that receives nothing (no reply, or no bytes) for this long is stopped. */
export const STALL_TIMEOUT_MS = 30_000;

/** The timer the stall check uses; the tests pass one they fire by hand. */
export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout> | undefined),
};

export const DOWNLOAD_MESSAGES = {
  offline:
    "Sage couldn't reach Hugging Face to download the speech file. Check that this PC is online, then try again.",
  refused: "Hugging Face didn't send the speech file. Try again later.",
  untrusted: "The download was sent somewhere Sage doesn't trust, so Sage stopped it. Try again later.",
  mismatch:
    "The downloaded speech file wasn't the one Sage expected, so Sage deleted it and didn't use it. Try again later.",
  disk: "Sage couldn't save the speech file. Check there is free space on this PC, then try again.",
  stalled:
    "The download of the speech file stopped making progress, so Sage stopped it. Check that this PC is online, then try again.",
} as const;

/** A download failure with a message for the user; nothing in it comes from the server. */
export class DownloadError extends Error {}

export interface Progress {
  received: number;
  total: number;
}

export interface DownloadOptions {
  dataDir: string;
  model: SpeechModel;
  fetch: FetchLike;
  signal: AbortSignal;
  onProgress?: (progress: Progress) => void;
  /** How long to wait for a reply or the next bytes; STALL_TIMEOUT_MS unless a test says otherwise. */
  stallMs?: number;
  timers?: Timers;
}

/** The options inside one download: the signal includes the stall check, and `alive` resets it. */
type Running = DownloadOptions & { alive: () => void };

/**
 * Downloads every file of `model` into a temporary folder in `<userData>/models`, checks each
 * one's size and SHA-256 fingerprint, and only when all of them match moves the folder into place
 * as the model folder. On any failure or a cancel, the temporary folder is deleted and the model
 * folder is left as it was. Throws `DownloadError` (a plain message) or the abort reason.
 */
export async function downloadModel(options: DownloadOptions): Promise<void> {
  const { dataDir, model } = options;
  const temp = partialDir(dataDir);
  const total = model.files.reduce((sum, file) => sum + file.size, 0);
  let done = 0;
  // Waiting for a reply or for the next bytes for longer than stallMs stops the download, with the
  // same clean-up as a cancel.
  const timers = options.timers ?? systemTimers;
  const stall = new AbortController();
  let timer: unknown;
  const running: Running = {
    ...options,
    signal: AbortSignal.any([options.signal, stall.signal]),
    alive: () => {
      timers.clearTimeout(timer);
      timer = timers.setTimeout(
        () => stall.abort(new DownloadError(DOWNLOAD_MESSAGES.stalled)),
        options.stallMs ?? STALL_TIMEOUT_MS,
      );
    },
  };
  try {
    await rm(temp, { recursive: true, force: true });
    await mkdir(temp, { recursive: true });
    for (const file of model.files) {
      await downloadFile(file, join(temp, file.name), running, (received) =>
        options.onProgress?.({ received: done + received, total }),
      );
      done += file.size;
    }
    timers.clearTimeout(timer);
    running.signal.throwIfAborted();
    const target = modelDir(dataDir, model);
    await rm(target, { recursive: true, force: true });
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    timers.clearTimeout(timer);
  }
}

/** Deletes what a download left behind when Sage closed or crashed in the middle of it. */
export async function removeLeftovers(dataDir: string): Promise<void> {
  await rm(partialDir(dataDir), { recursive: true, force: true });
}

async function downloadFile(
  file: ModelFile,
  path: string,
  options: Running,
  onBytes: (received: number) => void,
): Promise<void> {
  const response = await follow(file.url, options);
  options.alive();
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) !== file.size) {
    await response.body?.cancel().catch(() => undefined);
    throw new DownloadError(DOWNLOAD_MESSAGES.mismatch);
  }
  if (!response.body) throw new DownloadError(DOWNLOAD_MESSAGES.mismatch);

  const hash = createHash("sha256");
  let received = 0;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    await mkdir(modelsDir(options.dataDir), { recursive: true });
    handle = await open(path, "w", 0o600);
  } catch {
    await response.body.cancel().catch(() => undefined);
    throw new DownloadError(DOWNLOAD_MESSAGES.disk);
  }
  try {
    const reader = response.body.getReader();
    for (;;) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (error) {
        throw networkError(error, options.signal);
      }
      if (chunk.done) break;
      options.alive();
      received += chunk.value.byteLength;
      // Stopped as soon as it is bigger than it should be, whatever the server said.
      if (received > file.size) {
        await reader.cancel().catch(() => undefined);
        throw new DownloadError(DOWNLOAD_MESSAGES.mismatch);
      }
      hash.update(chunk.value);
      try {
        await handle.write(chunk.value);
      } catch {
        await reader.cancel().catch(() => undefined);
        throw new DownloadError(DOWNLOAD_MESSAGES.disk);
      }
      onBytes(received);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (received !== file.size || hash.digest("hex") !== file.sha256) {
    throw new DownloadError(DOWNLOAD_MESSAGES.mismatch);
  }
}

/**
 * Fetches `url`, following forwards by hand: at most MAX_FORWARDS, each to an https address
 * (a relative one is resolved against the current address). No cookies or credentials are sent.
 */
async function follow(url: string, options: Running): Promise<Response> {
  let current = url;
  for (let forwards = 0; ; forwards++) {
    if (!isHttps(current)) throw new DownloadError(DOWNLOAD_MESSAGES.untrusted);
    options.alive();
    let response: Response;
    try {
      response = await options.fetch(current, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        signal: options.signal,
      });
    } catch (error) {
      throw networkError(error, options.signal);
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      const location = response.headers.get("location");
      if (!location || forwards >= MAX_FORWARDS) throw new DownloadError(DOWNLOAD_MESSAGES.untrusted);
      try {
        current = new URL(location, current).href;
      } catch {
        throw new DownloadError(DOWNLOAD_MESSAGES.untrusted);
      }
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new DownloadError(DOWNLOAD_MESSAGES.refused);
    }
    return response;
  }
}

function isHttps(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

/** A cancel stays a cancel; anything else on the wire is "couldn't reach". */
function networkError(error: unknown, signal: AbortSignal): unknown {
  if (signal.aborted) return signal.reason;
  return error instanceof DownloadError ? error : new DownloadError(DOWNLOAD_MESSAGES.offline);
}
