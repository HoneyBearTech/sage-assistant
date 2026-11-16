import { z } from "zod";
import type { SupportCode } from "../../shared/support-codes.js";
import type { Timers } from "../voice/download.js";
import { systemTimers } from "../voice/download.js";
import { type FetchLike, isTimeout, readJsonCapped } from "./brain.js";
import { LOCAL_HOST, LOCAL_PORT } from "./local.js";

// The local model runner's own requests besides chat: which models it has, downloading one, and
// whether a model can use tools. Same fixed address as chat (127.0.0.1 only), no redirects, and
// every reply checked and size-capped. Nothing the runner says is shown to the user or logged:
// Sage maps it to its own fixed messages.

/** How long a quick question (the model list, a model's details) may take. */
export const STATUS_TIMEOUT_MS = 5_000;
/**
 * A download with no real progress (more bytes in all, a new layer, or a status not seen before)
 * for this long is stopped.
 */
export const PULL_STALL_MS = 120_000;
/** The longest single progress line Sage reads; the runner's lines are a few hundred bytes. */
export const MAX_PULL_LINE_BYTES = 64 * 1024;
/** The most layers (digests) one download may report; a model has a handful. */
export const MAX_PULL_LAYERS = 1_000;
/** The most different statuses one download may report: one per layer, and a few more. */
export const MAX_PULL_STATUSES = MAX_PULL_LAYERS + 20;
/** The largest model list or model details Sage reads. */
export const MAX_STATUS_BYTES = 1024 * 1024;

export const PULL_MESSAGES = {
  unreachable:
    "Sage can't reach the local model runner. Check that it is installed and running, then try again.",
  offline:
    "The local model runner couldn't download the model. Check that this PC is online, then try again.",
  disk: "There isn't enough free disk space for the model. Free up some space, then try again.",
  notFound:
    "The local model runner couldn't find that model. Check that the runner is up to date, then try again.",
  other: "The local model runner couldn't download the model. Try again.",
  unreadable:
    "The local model runner gave an answer Sage couldn't read, so Sage stopped the download. Try again, or update the runner.",
  stalled:
    "The download made no progress for 2 minutes, so Sage stopped it. Check that this PC is online, then try again.",
} as const;

/** The support code for each of the download's messages (src/shared/support-codes.ts). */
export const PULL_CODES: Record<keyof typeof PULL_MESSAGES, SupportCode> = {
  unreachable: "SAGE-RUN-01",
  unreadable: "SAGE-RUN-02",
  offline: "SAGE-NET-01",
  stalled: "SAGE-NET-02",
  disk: "SAGE-MOD-02",
  notFound: "SAGE-MOD-03",
  other: "SAGE-MOD-01",
};

/** The support code for one of PULL_MESSAGES; anything else counts as "other". */
export function pullCode(message: string): SupportCode {
  for (const [key, text] of Object.entries(PULL_MESSAGES)) {
    if (text === message) return PULL_CODES[key as keyof typeof PULL_MESSAGES];
  }
  return PULL_CODES.other;
}

/**
 * The runner's version, as Sage reads it: digits and dots with an optional short suffix, and
 * nothing else. Anything else counts as not reported, so no other text from the runner is ever kept.
 */
const RUNNER_VERSION = /^\d{1,6}(?:\.\d{1,6}){1,3}(?:[-+][0-9A-Za-z.-]{1,32})?$/;

export type ModelList = { ok: true; names: string[] } | { ok: false; reason: "unreachable" | "unreadable" };

export type PullOutcome =
  | { status: "done" }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

/** "unknown": the runner didn't say (an older version), so Sage carries on. */
export type ToolSupport = "tools" | "no-tools" | "unknown";

export interface PullProgress {
  completed: number;
  total: number;
}

export interface PullOptions {
  /** Cancel. */
  signal: AbortSignal;
  onProgress?: (progress: PullProgress) => void;
  /** For tests: the stall limit and the timer it runs on. */
  stallMs?: number;
  timers?: Timers;
}

export interface RunnerClientOptions {
  /** For tests only: the port of a fake runner on 127.0.0.1. */
  port?: number;
  fetch?: FetchLike;
  statusTimeoutMs?: number;
}

const tagsReply = z.object({
  models: z.array(z.object({ name: z.string().min(1).max(500) })).max(10_000),
});

const versionReply = z.object({ version: z.string().regex(RUNNER_VERSION) });

const showReply = z.object({ capabilities: z.array(z.string().max(200)).max(1_000).nullish() });

const pullLine = z.object({
  status: z.string().max(1_000).optional(),
  digest: z.string().max(500).optional(),
  total: z.number().finite().nonnegative().optional(),
  completed: z.number().finite().nonnegative().optional(),
  error: z.unknown().optional(),
});

/** A model name with no tag means its "latest" tag, as the runner treats it. */
function withTag(name: string): string {
  const lastPart = name.slice(name.lastIndexOf("/") + 1);
  return lastPart.includes(":") ? name : `${name}:latest`;
}

/** True when the runner's model `listed` is the model Sage calls `wanted`. */
export function sameModel(listed: string, wanted: string): boolean {
  return listed === wanted || withTag(listed) === withTag(wanted);
}

export function hasModel(names: readonly string[], wanted: string): boolean {
  return names.some((name) => sameModel(name, wanted));
}

/**
 * Sage's own message for a failed download, from the runner's error text by simple keyword
 * checks. The runner's text itself is never shown or logged.
 */
export function pullErrorMessage(text: string, httpStatus?: number): string {
  const lower = text.toLowerCase();
  if (/no space|disk|not enough space|insufficient space/.test(lower)) return PULL_MESSAGES.disk;
  if (/not found|does not exist|manifest unknown|no such model/.test(lower) || httpStatus === 404) {
    return PULL_MESSAGES.notFound;
  }
  if (/dial tcp|lookup|no such host|network|connection|timeout|timed out|tls|unreachable/.test(lower)) {
    return PULL_MESSAGES.offline;
  }
  return PULL_MESSAGES.other;
}

class LineTooLong extends Error {}

export class RunnerClient {
  private readonly base: string;
  private readonly fetch: FetchLike;
  private readonly statusTimeoutMs: number;

  constructor(options: RunnerClientOptions = {}) {
    this.base = `http://${LOCAL_HOST}:${options.port ?? LOCAL_PORT}`;
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.statusTimeoutMs = options.statusTimeoutMs ?? STATUS_TIMEOUT_MS;
  }

  /** The models the runner has downloaded, or why Sage couldn't find out. */
  /** `signal` cancels the request (on top of the short time limit). */
  async models(signal?: AbortSignal): Promise<ModelList> {
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(this.statusTimeoutMs);
      response = await this.fetch(`${this.base}/api/tags`, {
        method: "GET",
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      return { ok: false, reason: "unreachable" };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "unreadable" };
    }
    let body: unknown;
    try {
      body = await readJsonCapped(response, MAX_STATUS_BYTES);
    } catch (error) {
      // Started answering, then stopped: as good as not there.
      return { ok: false, reason: isTimeout(error) ? "unreachable" : "unreadable" };
    }
    const parsed = tagsReply.safeParse(body);
    if (!parsed.success) return { ok: false, reason: "unreadable" };
    return { ok: true, names: parsed.data.models.map((model) => model.name) };
  }

  /**
   * The runner's version, or null when it doesn't say (or says something that isn't a plain version
   * number). Asked at the same time as the model list, with the same time limit.
   */
  async version(): Promise<string | null> {
    try {
      const response = await this.fetch(`${this.base}/api/version`, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(this.statusTimeoutMs),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      const parsed = versionReply.safeParse(await readJsonCapped(response, MAX_STATUS_BYTES));
      return parsed.success ? parsed.data.version : null;
    } catch {
      return null;
    }
  }

  /** Whether `model` can use tools (Sage's skills), as far as the runner says. */
  async toolSupport(model: string): Promise<ToolSupport> {
    try {
      const response = await this.fetch(`${this.base}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model }),
        redirect: "error",
        signal: AbortSignal.timeout(this.statusTimeoutMs),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return "unknown";
      }
      const parsed = showReply.safeParse(await readJsonCapped(response, MAX_STATUS_BYTES));
      if (!parsed.success || !parsed.data.capabilities) return "unknown";
      return parsed.data.capabilities.includes("tools") ? "tools" : "no-tools";
    } catch {
      return "unknown";
    }
  }

  /**
   * Asks the runner to download `model`, reading its progress line by line. The runner downloads
   * and checks the files itself. Ends on the runner's final "success" line, an error, a cancel,
   * or a stall (no line for `stallMs`).
   */
  async pull(model: string, options: PullOptions): Promise<PullOutcome> {
    const timers = options.timers ?? systemTimers;
    const stall = new AbortController();
    const signal = AbortSignal.any([options.signal, stall.signal]);
    let timer: unknown;
    const alive = () => {
      timers.clearTimeout(timer);
      timer = timers.setTimeout(() => stall.abort(new Error("stalled")), options.stallMs ?? PULL_STALL_MS);
    };
    const stopped = (): PullOutcome | undefined => {
      if (options.signal.aborted) return { status: "cancelled" };
      if (stall.signal.aborted) return { status: "failed", message: PULL_MESSAGES.stalled };
      return undefined;
    };
    alive();
    try {
      let response: Response;
      try {
        response = await this.fetch(`${this.base}/api/pull`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, stream: true }),
          redirect: "error",
          signal,
        });
      } catch {
        return stopped() ?? { status: "failed", message: PULL_MESSAGES.unreachable };
      }
      alive();
      if (!response.ok) {
        let text = "";
        try {
          const body = await readJsonCapped(response, MAX_PULL_LINE_BYTES);
          const error = z.object({ error: z.string().max(MAX_PULL_LINE_BYTES) }).safeParse(body);
          if (error.success) text = error.data.error;
        } catch {
          // Only the status is left to go on.
        }
        return stopped() ?? { status: "failed", message: pullErrorMessage(text, response.status) };
      }
      if (!response.body) return { status: "failed", message: PULL_MESSAGES.unreadable };
      return await this.readProgress(response.body, signal, alive, stopped, options.onProgress);
    } finally {
      timers.clearTimeout(timer);
    }
  }

  /**
   * Reads the progress lines. The stall limit restarts only on a complete, valid line that moves
   * the download on: more bytes downloaded in all than ever before, a layer never seen before, or a
   * status never seen before in this download. Repeated or alternating lines, blank lines and bytes
   * with no end of line don't count as progress.
   */
  private async readProgress(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    alive: () => void,
    stopped: () => PullOutcome | undefined,
    onProgress: ((progress: PullProgress) => void) | undefined,
  ): Promise<PullOutcome> {
    const reader = body.getReader();
    // Ends a read that is waiting, whatever the fetch underneath does with the signal.
    const onAbort = () => void reader.cancel().catch(() => undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    const layers = new Map<string, PullProgress>();
    let completed = 0;
    let total = 0;
    /** Every status seen in this download, and the most bytes downloaded so far. */
    const statuses = new Set<string>();
    let best = 0;
    const unreadable: PullOutcome = { status: "failed", message: PULL_MESSAGES.unreadable };

    const handle = (text: string): PullOutcome | undefined => {
      if (!text.trim()) return undefined;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return unreadable;
      }
      const parsed = pullLine.safeParse(json);
      if (!parsed.success) return unreadable;
      const line = parsed.data;
      if (line.error !== undefined) {
        return {
          status: "failed",
          message: pullErrorMessage(typeof line.error === "string" ? line.error : ""),
        };
      }
      if (line.status === "success") return { status: "done" };
      // Real progress only: a status never seen before in this download, a layer never seen
      // before, or more bytes downloaded in all than ever before. Alternating between statuses
      // or layers already seen, or bytes going down and up again, doesn't count.
      let moved = false;
      if (line.status !== undefined && !statuses.has(line.status)) {
        if (statuses.size >= MAX_PULL_STATUSES) return unreadable;
        statuses.add(line.status);
        moved = true;
      }
      if (line.digest !== undefined && line.total !== undefined) {
        const layer = { total: line.total, completed: Math.min(line.completed ?? 0, line.total) };
        const before = layers.get(line.digest);
        if (!before && layers.size >= MAX_PULL_LAYERS) return unreadable;
        if (!before) moved = true;
        // A layer's count only goes up (a line with fewer bytes is ignored), so the bar never jumps back.
        if (!before || layer.completed > before.completed || layer.total !== before.total) {
          // Running totals: only this layer's change is added.
          completed += layer.completed - (before?.completed ?? 0);
          total += layer.total - (before?.total ?? 0);
          layers.set(line.digest, layer);
          onProgress?.({ completed, total });
        }
        if (completed > best) {
          best = completed;
          moved = true;
        }
      }
      if (moved) alive();
      return undefined;
    };

    let parts: Buffer[] = [];
    let size = 0;
    const take = (piece: Uint8Array) => {
      size += piece.byteLength;
      if (size > MAX_PULL_LINE_BYTES) throw new LineTooLong();
      if (piece.byteLength > 0) parts.push(Buffer.from(piece));
    };
    const endLine = (): PullOutcome | undefined => {
      const text = Buffer.concat(parts).toString("utf8");
      parts = [];
      size = 0;
      return handle(text);
    };
    try {
      for (;;) {
        let chunk: Awaited<ReturnType<typeof reader.read>>;
        try {
          chunk = await reader.read();
        } catch {
          return stopped() ?? { status: "failed", message: PULL_MESSAGES.other };
        }
        if (chunk.done) {
          const cut = stopped();
          if (cut) return cut;
          // The last line may come without a newline after it.
          return endLine() ?? { status: "failed", message: PULL_MESSAGES.other };
        }
        const bytes = chunk.value;
        let start = 0;
        for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
          take(bytes.subarray(start, end));
          start = end + 1;
          const outcome = endLine();
          if (outcome) return outcome;
        }
        take(bytes.subarray(start));
      }
    } catch (error) {
      if (error instanceof LineTooLong) return unreadable;
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
      await reader.cancel().catch(() => undefined);
    }
  }
}
