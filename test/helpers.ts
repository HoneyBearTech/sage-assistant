import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Brain, BrainReply, ChatMessage, ToolCall, ToolSpec } from "../src/core/brain/brain.js";
import type { Encryptor, KeyStore } from "../src/core/keystore.js";
import { createLogger, type Logger, SecretRedactor } from "../src/core/log.js";
import type { Clock } from "../src/core/scheduler.js";
import type { ConfirmPresenter, ConfirmRequest } from "../src/core/skills/gate.js";

export async function tempDir(t: { after(fn: () => Promise<void> | void): void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sage-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

/** A fake HTTP server on 127.0.0.1, started by the test. Tests never use the real network. */
export async function fakeServer(
  t: { after(fn: () => Promise<void> | void): void },
  handler: (request: Recorded, response: ServerResponse) => void,
): Promise<{ port: number; url: string; requests: Recorded[] }> {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const recorded = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return { port, url: `http://127.0.0.1:${port}`, requests };
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * A port on 127.0.0.1 with nothing listening on it. Picking a free port and closing it again is a
 * race: another test running in parallel can start a server on it in between. Port 3 is below 1024,
 * so no test (and no program without administrator rights) can listen on it, it has no service in
 * use today, and it isn't on fetch's list of blocked ports.
 */
export const REFUSED_PORT = 3;

export function captureLogs(): { logger: Logger; lines: string[]; redactor: SecretRedactor } {
  const lines: string[] = [];
  const redactor = new SecretRedactor();
  return { logger: createLogger((_level, line) => lines.push(line), redactor), lines, redactor };
}

/** Answers every confirmation with `answer` and records what was asked. */
export class FakePresenter implements ConfirmPresenter {
  readonly asked: ConfirmRequest[] = [];
  constructor(public answer: boolean | ((request: ConfirmRequest) => boolean) = false) {}
  async ask(request: ConfirmRequest): Promise<boolean> {
    this.asked.push(request);
    return typeof this.answer === "function" ? this.answer(request) : this.answer;
  }
}

export class MemoryKeyStore implements KeyStore {
  constructor(private key: string | null = null) {}
  async has() {
    return this.key !== null;
  }
  async get() {
    return this.key;
  }
  async set(key: string) {
    this.key = key.trim();
  }
  async clear() {
    this.key = null;
  }
}

/** Stands in for the operating system's encryption. Its output never contains the input. */
export const fakeEncryptor = (available = true): Encryptor => ({
  isAvailable: () => available,
  encrypt: (plain) =>
    Buffer.from(`FAKE-OS-ENC:${Buffer.from(plain).toString("base64").split("").reverse().join("")}`),
  decrypt: (data) => {
    const text = data.toString("utf8");
    if (!text.startsWith("FAKE-OS-ENC:")) throw new Error("not ours");
    return Buffer.from(text.slice(12).split("").reverse().join(""), "base64").toString("utf8");
  },
});

export class FakeClock implements Clock {
  private callback: (() => void) | undefined;
  constructor(private time: Date) {}
  now() {
    return new Date(this.time);
  }
  set(time: Date) {
    this.time = time;
  }
  advance(ms: number) {
    this.time = new Date(this.time.getTime() + ms);
  }
  setInterval(callback: () => void) {
    this.callback = callback;
    return 1;
  }
  clearInterval() {
    this.callback = undefined;
  }
  get scheduled() {
    return this.callback !== undefined;
  }
  fire() {
    this.callback?.();
  }
}

/** A brain that replays scripted replies and records what it was sent. */
export class ScriptedBrain implements Brain {
  readonly kind = "local";
  readonly calls: { messages: ChatMessage[]; tools: ToolSpec[] }[] = [];
  private index = 0;
  constructor(private readonly replies: (BrainReply | ((messages: ChatMessage[]) => BrainReply))[]) {}
  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<BrainReply> {
    this.calls.push({ messages: structuredClone(messages), tools });
    const next = this.replies[Math.min(this.index++, this.replies.length - 1)];
    if (!next) return { ok: true, content: "", toolCalls: [] };
    return typeof next === "function" ? next(messages) : next;
  }
}

let counter = 0;
export function toolCall(name: string, args: unknown, id = `call-${++counter}`): ToolCall {
  return { id, name, args };
}

export function toolReply(...calls: ToolCall[]): BrainReply {
  return { ok: true, content: "", toolCalls: calls };
}

export function textReply(content: string): BrainReply {
  return { ok: true, content, toolCalls: [] };
}
