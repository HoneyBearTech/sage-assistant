import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type Brain,
  type BrainReply,
  type ChatMessage,
  type FetchLike,
  isConnectionRefused,
  isTimeout,
  parseArgs,
  type ToolSpec,
} from "./brain.js";

/**
 * An online model service that speaks the widely used chat-completions format:
 * POST <base>/v1/chat/completions with a bearer key.
 */

const completionReply = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().nullish(),
                type: z.string().nullish(),
                function: z.object({
                  name: z.string().min(1),
                  arguments: z.unknown(),
                }),
              }),
            )
            .nullish(),
        }),
      }),
    )
    .min(1),
});

export interface OnlineBrainOptions {
  baseUrl: string;
  model: string;
  /** Reads the key from the key store at call time; the brain never keeps it. */
  getKey: () => Promise<string | null>;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * Turns what the user typed into the endpoint URL. Accepts a base with or without a trailing
 * "/v1". Only https is allowed, except plain http to this computer (for a self-hosted server).
 */
export function completionsUrl(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return null;
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${url.origin}${path}/v1/chat/completions`;
}

export class OnlineBrain implements Brain {
  readonly kind = "online";
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: OnlineBrainOptions) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<BrainReply> {
    const url = completionsUrl(this.options.baseUrl);
    if (!url) {
      return {
        ok: false,
        message:
          "The online service address in Settings isn't valid. It must start with https:// (for example https://api.example.com).",
      };
    }
    if (!this.options.model.trim()) {
      return { ok: false, message: "Choose the online model's name in Settings first." };
    }
    const key = await this.options.getKey();
    if (!key) {
      return { ok: false, message: "Add your online service key in Settings first." };
    }
    const body = {
      model: this.options.model,
      messages: messages.map(toCompletionMessage),
      ...(tools.length
        ? {
            tools: tools.map((tool) => ({ type: "function", function: tool })),
            tool_choice: "auto",
          }
        : {}),
    };
    let response: Response;
    try {
      response = await this.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeout(error)) {
        return { ok: false, message: "The online service took too long to answer. Try again." };
      }
      if (isConnectionRefused(error)) {
        return { ok: false, message: "Sage can't reach the online service. Check the address." };
      }
      return {
        ok: false,
        message: "Sage can't reach the online service. Check your internet connection.",
      };
    }
    // The body of an error reply is never shown or logged: some services echo the request back.
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: "The online service didn't accept the key. Check it in Settings." };
    }
    if (response.status === 404) {
      return {
        ok: false,
        message: "The online service didn't recognise the address or the model name. Check Settings.",
      };
    }
    if (response.status === 429) {
      return { ok: false, message: "The online service is busy or your quota is used up. Try later." };
    }
    if (!response.ok) {
      return {
        ok: false,
        message: `The online service returned an error (HTTP ${response.status}). Try again later.`,
      };
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, message: "The online service sent a reply Sage couldn't read." };
    }
    const parsed = completionReply.safeParse(json);
    if (!parsed.success) {
      return { ok: false, message: "The online service sent a reply Sage couldn't read." };
    }
    // min(1) above guarantees a first choice.
    const message = parsed.data.choices[0]?.message;
    return {
      ok: true,
      content: message?.content ?? "",
      toolCalls: (message?.tool_calls ?? []).map((call) => ({
        id: randomUUID(),
        name: call.function.name,
        args: parseArgs(call.function.arguments),
      })),
    };
  }
}

function toCompletionMessage(message: ChatMessage): Record<string, unknown> {
  switch (message.role) {
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
              })),
            }
          : {}),
      };
    case "tool":
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    default:
      return { role: message.role, content: message.content };
  }
}
