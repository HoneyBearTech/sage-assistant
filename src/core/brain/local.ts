import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type Brain,
  type BrainReply,
  type ChatMessage,
  type FetchLike,
  isTimeout,
  parseArgs,
  type ToolSpec,
} from "./brain.js";

/** The local model runner (Ollama) always lives on this computer. The host can't be changed. */
export const LOCAL_HOST = "127.0.0.1";
export const LOCAL_PORT = 11434;

export const UNREACHABLE_MESSAGE =
  "Sage can't reach the local model runner. Is Ollama running? Start it, then try again.";

const ollamaReply = z.object({
  message: z.object({
    role: z.string(),
    content: z.string().nullish(),
    tool_calls: z
      .array(
        z.object({
          function: z.object({
            name: z.string().min(1),
            arguments: z.unknown(),
          }),
        }),
      )
      .nullish(),
  }),
});

export interface LocalBrainOptions {
  model: string;
  /** For tests only: the port of a fake runner on 127.0.0.1. */
  port?: number;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class LocalBrain implements Brain {
  readonly kind = "local";
  private readonly url: string;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: LocalBrainOptions) {
    this.url = `http://${LOCAL_HOST}:${options.port ?? LOCAL_PORT}/api/chat`;
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<BrainReply> {
    const body = {
      model: this.options.model,
      stream: false,
      messages: messages.map(toOllamaMessage),
      tools: tools.map((tool) => ({ type: "function", function: tool })),
    };
    let response: Response;
    try {
      response = await this.fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeout(error)) {
        return { ok: false, message: "The local model took too long to answer. Try again." };
      }
      // Connection refused, or any other network failure talking to 127.0.0.1: either way the
      // runner isn't there to answer.
      return { ok: false, message: UNREACHABLE_MESSAGE };
    }
    if (response.status === 404) {
      return {
        ok: false,
        message: `The local model "${this.options.model}" isn't downloaded yet. Run: ollama pull ${this.options.model}`,
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        message: `The local model runner returned an error (HTTP ${response.status}). Try again, or check Ollama.`,
      };
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, message: "The local model runner sent a reply Sage couldn't read." };
    }
    const parsed = ollamaReply.safeParse(json);
    if (!parsed.success) {
      return { ok: false, message: "The local model runner sent a reply Sage couldn't read." };
    }
    const message = parsed.data.message;
    return {
      ok: true,
      content: message.content ?? "",
      toolCalls: (message.tool_calls ?? []).map((call) => ({
        id: randomUUID(),
        name: call.function.name,
        args: parseArgs(call.function.arguments),
      })),
    };
  }
}

function toOllamaMessage(message: ChatMessage): Record<string, unknown> {
  switch (message.role) {
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                function: { name: call.name, arguments: call.args },
              })),
            }
          : {}),
      };
    case "tool":
      return { role: "tool", content: message.content, tool_name: message.name };
    default:
      return { role: message.role, content: message.content };
  }
}
