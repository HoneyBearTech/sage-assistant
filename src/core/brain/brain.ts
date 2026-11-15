/** What every brain (local or online) offers the rest of Sage. */

export interface ToolCall {
  /** Sage's own id for this call. Never taken from the model, so it can't be reused or guessed. */
  id: string;
  name: string;
  /** The arguments exactly as the model sent them. Validated by the skill's schema before use. */
  args: unknown;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  /** A JSON Schema object describing the arguments. */
  parameters: Record<string, unknown>;
}

export type BrainReply =
  | { ok: true; content: string; toolCalls: ToolCall[] }
  | { ok: false; message: string };

export interface Brain {
  readonly kind: "local" | "online";
  chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<BrainReply>;
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

/** Some local models put their private reasoning in the reply between <think> tags; drop it. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
