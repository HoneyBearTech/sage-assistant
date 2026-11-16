/** What every brain (local or online) offers the rest of Sage. */

export interface ToolCall {
  /** Sage's own id for this call. Never taken from the model, so it can't be reused or guessed. */
  id: string;
  name: string;
  /** The arguments exactly as the model sent them. Validated by the skill's schema before use. */
  args: unknown;
  /**
   * The id the service gave this call, if it gave one. It goes back only to the same brain, with
   * this call's result, so the service can match them; it is never used for approval (Sage's own
   * `id` is). The local and chat-completions brains never set it.
   */
  serviceId?: string;
}

/**
 * A service's own reply, kept exactly as it arrived so the same brain can send it back unchanged
 * on the next request of the same message (thinking blocks, signatures and all). It lives only in
 * the current message's request list: never shown, logged, saved or put in the chat history.
 */
export interface Replay {
  format: "messages" | "generate" | "responses";
  items: unknown[];
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; replay?: Replay }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  /** A JSON Schema object describing the arguments. */
  parameters: Record<string, unknown>;
}

export type BrainReply =
  | { ok: true; content: string; toolCalls: ToolCall[]; replay?: Replay }
  | { ok: false; message: string };

export interface Brain {
  readonly kind: "local" | "online";
  /**
   * One request. `tools` is the same list for every request of a message; once the skill limit is
   * reached `allowTools` is false, and the brain must not let the model ask for a skill (an online
   * service that checks its earlier replies against the request is sent the same tools with tool
   * use switched off; the others are sent none).
   */
  chat(messages: ChatMessage[], tools: ToolSpec[], allowTools?: boolean): Promise<BrainReply>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** True when a fetch failed because nothing answered on the other end. */
export function isConnectionRefused(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "UND_ERR_SOCKET") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** Parses a tool call's arguments when they arrive as a JSON string. Bad JSON stays a string. */
export function parseArgs(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const LEADING_THINKING = /^\s*<think>[\s\S]*?<\/think>/i;

/**
 * Some models put their private reasoning at the start of the reply, between <think> tags; drop
 * it. Only reasoning at the very start is removed: a closed block (or several in a row), or an
 * opening tag at the start that is never closed (the model was still thinking). Tags anywhere
 * else are left as they are, so no part of a real answer is ever deleted because of them.
 */
export function stripThinking(text: string): string {
  let out = text;
  for (let match = LEADING_THINKING.exec(out); match; match = LEADING_THINKING.exec(out)) {
    out = out.slice(match[0].length);
  }
  if (/^\s*<think>/i.test(out)) return "";
  return out.trim();
}

/** The largest reply body Sage reads from a model or the search page: about 2 MB. */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * Reads a response body as text, but stops and returns null once it is larger than `maxBytes`, so
 * a misbehaving server can't make Sage hold or parse an enormous reply.
 */
export async function readTextCapped(
  response: Response,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads a capped body and parses it as JSON. Returns undefined for too large or not JSON. */
export async function readJsonCapped(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<unknown> {
  const text = await readTextCapped(response, maxBytes);
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Applies `clean` to every string inside a value (strings, arrays and plain objects, keys too). */
export function scrubStrings(value: unknown, clean: (text: string) => string): unknown {
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.map((item) => scrubStrings(item, clean));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [clean(k), scrubStrings(v, clean)]),
    );
  }
  return value;
}
