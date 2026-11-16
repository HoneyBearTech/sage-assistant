import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type Brain,
  type BrainReply,
  type ChatMessage,
  type ChatOptions,
  type FetchLike,
  parseArgs,
  scrubStrings,
  stripThinking,
  type ToolCall,
  type ToolSpec,
} from "./brain.js";
import { failureMessage, type ServiceName, serviceName, unreadableMessage } from "./errors.js";
import { requestService } from "./request.js";
import { OPENAI_ORIGIN } from "./services.js";

/**
 * OpenAI, through its Responses API: POST https://api.openai.com/v1/responses with the key as a
 * bearer token. The address is fixed. OpenAI's current models take skills (function tools) only
 * through this API, not through chat completions. Sage's skills go as function tools; the model only
 * answers, or asks to use a skill, which Sage runs itself through the ask-first gate.
 *
 * Nothing is stored at OpenAI (`store: false`): each request carries the whole message so far. The
 * model's own output items (its encrypted reasoning, skill requests and text) are sent back exactly
 * as they came within one message.
 */

export const RESPONSES_URL = `${OPENAI_ORIGIN}/v1/responses`;
/** The most tokens one reply may use, reasoning included. */
export const MAX_OUTPUT_TOKENS = 16_000;
/** Reasoning takes time: the whole exchange may take up to three minutes. */
export const CHAT_TIMEOUT_MS = 180_000;

export const CUT_OFF_NOTE = "(OpenAI's reply was cut off because it was too long.)";
export const CUT_OFF_MESSAGE =
  "OpenAI's reply was cut off because it was too long. Try asking for something shorter.";
export const REFUSAL_MESSAGE = "OpenAI declined to answer that. Try asking in another way.";

const outputText = z.object({ type: z.literal("output_text"), text: z.string() });
const refusal = z.object({ type: z.literal("refusal") });
const messageItem = z.object({
  type: z.literal("message"),
  content: z.array(z.looseObject({ type: z.string() })).nullish(),
});
const functionCallItem = z.object({
  type: z.literal("function_call"),
  call_id: z.string().min(1).max(200),
  name: z.string().min(1),
  arguments: z.unknown(),
});
const responsesReply = z.object({
  status: z.string().nullish(),
  // Only the code is read, and only compared; the message is never shown or kept.
  error: z.looseObject({ code: z.unknown() }).nullish(),
  incomplete_details: z.object({ reason: z.string().nullish() }).nullish(),
  // Other item types (reasoning, a future kind) are kept for the replay but not read.
  output: z.array(z.looseObject({ type: z.string() })),
});

type Item = Record<string, unknown>;

export interface ResponsesBrainOptions {
  model: string;
  /** Reads the key at call time, for the exact address the request goes to. The brain never keeps it. */
  getKey: (url: string) => Promise<string | null>;
  /** Removes known secrets from text (Sage's redactor). The key itself is always removed. */
  redact?: (text: string) => string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Makes the time limit's signal (tests fire it themselves). */
  timeoutSignal?: (ms: number) => AbortSignal;
}

export class ResponsesBrain implements Brain {
  readonly kind = "online";
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly service: ServiceName = serviceName("OpenAI");

  constructor(private readonly options: ResponsesBrainOptions) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? CHAT_TIMEOUT_MS;
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[], options: ChatOptions = {}): Promise<BrainReply> {
    const allowTools = options.allowTools !== false;
    if (!this.options.model.trim()) {
      return { ok: false, message: "Choose the model for OpenAI in Settings first." };
    }
    // The key for exactly this address: checked here, at the point of the request.
    const key = await this.options.getKey(RESPONSES_URL);
    if (!key) return { ok: false, message: "Add your OpenAI key in Settings first." };
    const reply = await requestService(
      this.fetch,
      RESPONSES_URL,
      {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(responsesRequest(this.options.model, messages, tools, allowTools)),
        ...(options.signal ? { signal: options.signal } : {}),
      },
      this.service,
      this.timeoutMs,
      this.options.timeoutSignal,
    );
    if (!reply.ok) return { ok: false, message: reply.message };
    const parsed = responsesReply.safeParse(reply.body);
    if (!parsed.success) return { ok: false, message: unreadableMessage(this.service) };
    const { status } = parsed.data;
    // A reply that arrived but says the service couldn't finish it: a plain message, from its error
    // code only (a busy service, a rate limit, credit used up) or the general one.
    if (status === "failed" || status === "cancelled") {
      const code = parsed.data.error?.code;
      const kinds = new Set(
        typeof code === "string" && /^[A-Za-z0-9_.]{1,64}$/.test(code) ? [code.toLowerCase()] : [],
      );
      return { ok: false, message: failureMessage(this.service, null, kinds) };
    }
    const reason = parsed.data.incomplete_details?.reason;
    if (parsed.data.status === "incomplete" && reason === "content_filter") {
      return { ok: false, message: REFUSAL_MESSAGE };
    }
    // A service can echo the key back even in a successful reply. Remove it (and any other secret
    // the redactor knows) from what Sage shows, keeps or acts on. The output items themselves go
    // back to the service unchanged (below).
    const redact = this.options.redact ?? ((text: string) => text);
    const clean = (text: string) => redact(text.split(key).join("[redacted]"));
    let text = "";
    let refused = false;
    const toolCalls: ToolCall[] = [];
    for (const item of parsed.data.output) {
      const asMessage = messageItem.safeParse(item);
      if (asMessage.success) {
        for (const part of asMessage.data.content ?? []) {
          const asText = outputText.safeParse(part);
          if (asText.success) text += asText.data.text;
          else if (refusal.safeParse(part).success) refused = true;
        }
        continue;
      }
      const asCall = functionCallItem.safeParse(item);
      if (asCall.success) {
        toolCalls.push({
          id: randomUUID(),
          name: clean(asCall.data.name),
          args: scrubStrings(parseArgs(asCall.data.arguments), clean),
          serviceId: asCall.data.call_id,
        });
      }
    }
    const content = clean(stripThinking(text));
    if (refused && !content && toolCalls.length === 0) return { ok: false, message: REFUSAL_MESSAGE };
    if (parsed.data.status === "incomplete" && reason === "max_output_tokens") {
      // Cut off: a half-written skill request is never run; whatever text came is kept.
      return {
        ok: true,
        content: content ? `${content}\n\n${CUT_OFF_NOTE}` : CUT_OFF_MESSAGE,
        toolCalls: [],
      };
    }
    const raw = (reply.body as { output: unknown[] }).output;
    return { ok: true, content, toolCalls, replay: { format: "responses", items: raw } };
  }
}

/**
 * Sage's conversation in the Responses format: system messages become `instructions`; a model turn
 * this brain received is sent back as its output items exactly as they came (`replay`); one from
 * the chat history is its text. Skill results are function_call_output items with the service's
 * call id. The tools are the same for every request of a message; past the skill limit,
 * `tool_choice` is "none".
 */
export function responsesRequest(
  model: string,
  messages: ChatMessage[],
  tools: ToolSpec[],
  allowTools = true,
): Item {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const input: unknown[] = [];
  const serviceIds = new Map<string, string>();
  for (const message of messages) {
    switch (message.role) {
      case "system":
        break;
      case "user":
        if (message.content) input.push({ role: "user", content: message.content });
        break;
      case "assistant":
        for (const call of message.toolCalls ?? []) serviceIds.set(call.id, call.serviceId ?? call.id);
        if (message.replay?.format === "responses") {
          input.push(...message.replay.items);
          break;
        }
        if (message.content) input.push({ role: "assistant", content: message.content });
        for (const call of message.toolCalls ?? []) {
          input.push({
            type: "function_call",
            call_id: call.serviceId ?? call.id,
            name: call.name,
            arguments: JSON.stringify(call.args ?? {}),
          });
        }
        break;
      case "tool":
        input.push({
          type: "function_call_output",
          call_id: serviceIds.get(message.toolCallId) ?? message.toolCallId,
          output: message.content,
        });
        break;
    }
  }
  return {
    model,
    ...(instructions ? { instructions } : {}),
    input,
    ...(tools.length ? { tools: tools.map(toFunctionTool), tool_choice: allowTools ? "auto" : "none" } : {}),
    // Nothing kept at OpenAI; its reasoning comes back encrypted, to be sent with the next request.
    store: false,
    include: ["reasoning.encrypted_content"],
    max_output_tokens: MAX_OUTPUT_TOKENS,
  };
}

function toFunctionTool(tool: ToolSpec): Item {
  // Not strict: Sage's skills have optional arguments, which strict mode doesn't allow.
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  };
}
