import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type Brain,
  type BrainReply,
  type ChatMessage,
  type FetchLike,
  parseArgs,
  scrubStrings,
  stripThinking,
  type ToolSpec,
} from "./brain.js";
import { OTHER_SERVICE, type ServiceName, unreadableMessage } from "./errors.js";
import { requestService } from "./request.js";

/**
 * An online model service that speaks the widely used chat-completions format: POST
 * <base>/v1/chat/completions with a bearer key (another online service), or a ready-made service's
 * fixed chat-completions address (OpenAI).
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
  /** Another online service: the address the user typed. Ignored when `endpoint` is given. */
  baseUrl?: string;
  /** A ready-made service: its fixed chat-completions address. */
  endpoint?: string;
  /** How messages name the service; "The online service" by default. */
  service?: ServiceName;
  model: string;
  /**
   * Reads the key from the key store at call time, for the exact address the request goes to; the
   * key store hands it out only if it is bound to that address's origin. The brain never keeps it.
   */
  getKey: (url: string) => Promise<string | null>;
  /** Removes known secrets from text (Sage's redactor). The key itself is always removed. */
  redact?: (text: string) => string;
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

/** The scheme, host and port the key would be sent to, or null if the base URL isn't usable. */
export function serviceOrigin(baseUrl: string): string | null {
  const url = completionsUrl(baseUrl);
  return url ? new URL(url).origin : null;
}

export class OnlineBrain implements Brain {
  readonly kind = "online";
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly service: ServiceName;

  constructor(private readonly options: OnlineBrainOptions) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 90_000;
    this.service = options.service ?? OTHER_SERVICE;
  }

  async chat(messages: ChatMessage[], allTools: ToolSpec[], allowTools = true): Promise<BrainReply> {
    // Past the skill limit no tools are offered at all.
    const tools = allowTools ? allTools : [];
    const url = this.options.endpoint ?? completionsUrl(this.options.baseUrl ?? "");
    if (!url) {
      return {
        ok: false,
        message:
          "The online service address in Settings isn't valid. It must start with https:// (for example https://api.example.com).",
      };
    }
    if (!this.options.model.trim()) {
      return { ok: false, message: `Choose the model for ${this.service.ref} in Settings first.` };
    }
    // The key for exactly this address: checked here, at the point of the request.
    const key = await this.options.getKey(url);
    if (!key) {
      return {
        ok: false,
        message: this.service.other
          ? "Add your online service key in Settings first."
          : `Add your ${this.service.ref} key in Settings first.`,
      };
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
    const reply = await requestService(
      this.fetch,
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      },
      this.service,
      this.timeoutMs,
    );
    if (!reply.ok) return { ok: false, message: reply.message };
    const parsed = completionReply.safeParse(reply.body);
    if (!parsed.success) return { ok: false, message: unreadableMessage(this.service) };
    // A service can echo the key back even in a successful reply. Remove it (and any other secret
    // the redactor knows) from the text and the tool-call arguments before anything else sees them.
    const redact = this.options.redact ?? ((text: string) => text);
    const clean = (text: string) => redact(text.split(key).join("[redacted]"));
    // min(1) above guarantees a first choice.
    const message = parsed.data.choices[0]?.message;
    return {
      ok: true,
      content: clean(stripThinking(message?.content ?? "")),
      toolCalls: (message?.tool_calls ?? []).map((call) => ({
        id: randomUUID(),
        name: clean(call.function.name),
        args: scrubStrings(parseArgs(call.function.arguments), clean),
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
