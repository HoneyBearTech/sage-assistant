import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type Brain,
  type BrainReply,
  type ChatMessage,
  type ChatOptions,
  type FetchLike,
  type Replay,
  STOPPED_MESSAGE,
  scrubStrings,
  stripThinking,
  type ToolCall,
  type ToolSpec,
} from "./brain.js";
import { type ServiceName, serviceName, THINKING_SIGNATURE, unreadableMessage } from "./errors.js";
import { requestService } from "./request.js";
import { ANTHROPIC_ORIGIN } from "./services.js";

/**
 * Claude, through Anthropic's Messages API: POST https://api.anthropic.com/v1/messages with the key
 * in x-api-key. The address is fixed. Sage's skills go as tools; the model only answers, or asks to
 * use a skill, which Sage runs itself through the ask-first gate.
 */

export const MESSAGES_URL = `${ANTHROPIC_ORIGIN}/v1/messages`;
export const ANTHROPIC_VERSION = "2023-06-01";
/**
 * The most tokens one reply may use. Current models think before answering (on by default, with
 * no setting sent), and the thinking counts toward this limit, so it leaves room for both.
 */
export const MAX_TOKENS = 16_000;
/** Thinking takes time: the whole exchange may take up to three minutes. */
export const CHAT_TIMEOUT_MS = 180_000;

/** The headers for every request to Anthropic, list of models included. */
export function anthropicHeaders(key: string): Record<string, string> {
  return { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" };
}

const textBlock = z.object({ type: z.literal("text"), text: z.string() });
const toolUseBlock = z.object({
  type: z.literal("tool_use"),
  id: z.string().min(1).max(200).nullish(),
  name: z.string().min(1),
  input: z.unknown(),
});
const messagesReply = z.object({
  // Other block types (thinking, a future kind) are kept for the replay but not read.
  content: z.array(z.looseObject({ type: z.string() })),
  stop_reason: z.string().nullish(),
});

/** Blocks that hold the model's thinking: sent back exactly as they came, or (on recovery) not at all. */
const THINKING_TYPES = new Set(["thinking", "redacted_thinking"]);

export const CUT_OFF_NOTE = "(Claude's reply was cut off because it was too long.)";
export const CUT_OFF_MESSAGE =
  "Claude's reply was cut off because it was too long. Try asking for something shorter.";
export const REFUSAL_MESSAGE = "Claude declined to answer that. Try asking in another way.";

type Block = Record<string, unknown>;
interface WireMessage {
  role: "user" | "assistant";
  content: unknown[];
}

export interface MessagesBrainOptions {
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

export class MessagesBrain implements Brain {
  readonly kind = "online";
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly service: ServiceName = serviceName("Claude");

  constructor(private readonly options: MessagesBrainOptions) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? CHAT_TIMEOUT_MS;
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[], options: ChatOptions = {}): Promise<BrainReply> {
    if (!this.options.model.trim()) {
      return { ok: false, message: "Choose the model for Claude in Settings first." };
    }
    const { signal } = options;
    // Every request, a retry included, is checked here first: a stopped turn sends nothing more,
    // and the key is read again for exactly this address (it may have been removed or replaced).
    const send = async (dropThinking: boolean) => {
      if (signal?.aborted) return { ok: false as const, message: STOPPED_MESSAGE };
      const key = await this.options.getKey(MESSAGES_URL);
      if (!key) return { ok: false as const, message: "Add your Claude key in Settings first." };
      const body = messagesRequest(this.options.model, messages, tools, {
        allowTools: options.allowTools !== false,
        dropThinking: () => dropThinking,
      });
      const reply = await requestService(
        this.fetch,
        MESSAGES_URL,
        {
          method: "POST",
          headers: anthropicHeaders(key),
          body: JSON.stringify(body),
          ...(signal ? { signal } : {}),
        },
        this.service,
        this.timeoutMs,
        this.options.timeoutSignal,
      );
      return { ...reply, key };
    };
    let reply = await send(false);
    // The service refused a thinking block it sent earlier in this message (it can bind them to a
    // conversation): send the same request once more with every thinking block left out, which it
    // allows.
    if (!reply.ok && "status" in reply && reply.status === 400 && reply.kinds?.has(THINKING_SIGNATURE)) {
      reply = await send(true);
    }
    if (!reply.ok) return { ok: false, message: reply.message };
    const { key } = reply;
    const parsed = messagesReply.safeParse(reply.body);
    if (!parsed.success) return { ok: false, message: unreadableMessage(this.service) };
    const { stop_reason: stopReason } = parsed.data;
    if (stopReason === "refusal") return { ok: false, message: REFUSAL_MESSAGE };
    // A service can echo the key back even in a successful reply. Remove it (and any other secret
    // the redactor knows) from what Sage shows, keeps or acts on. The reply itself goes back to
    // the service unchanged (below), as the format requires.
    const redact = this.options.redact ?? ((text: string) => text);
    const clean = (text: string) => redact(text.split(key).join("[redacted]"));
    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const block of parsed.data.content) {
      const asText = textBlock.safeParse(block);
      if (asText.success) {
        text += asText.data.text;
        continue;
      }
      const asTool = toolUseBlock.safeParse(block);
      if (asTool.success) {
        toolCalls.push({
          id: randomUUID(),
          name: clean(asTool.data.name),
          args: scrubStrings(asTool.data.input ?? {}, clean),
          ...(asTool.data.id ? { serviceId: asTool.data.id } : {}),
        });
      }
    }
    const content = clean(stripThinking(text));
    if (stopReason === "max_tokens" || stopReason === "model_context_window_exceeded") {
      // Cut off: a half-written skill request is never run; whatever text came is kept.
      return {
        ok: true,
        content: content ? `${content}\n\n${CUT_OFF_NOTE}` : CUT_OFF_MESSAGE,
        toolCalls: [],
      };
    }
    const raw = (reply.body as { content: unknown[] }).content;
    return { ok: true, content, toolCalls, replay: { format: "messages", items: raw } };
  }
}

export interface MessagesRequestOptions {
  /** False once the skill limit is reached: the same tools are sent, with tool use switched off. */
  allowTools?: boolean;
  /** Which earlier replies to send without their thinking blocks (recovery after the service refused one). */
  dropThinking?: (replay: Replay) => boolean;
}

/**
 * Sage's conversation in the Messages format. System messages become the `system` field. An
 * assistant turn this brain received is sent back exactly as it came (`replay`: every block, in
 * order, thinking blocks and their signatures included); one from the chat history is its text.
 * Skill results are tool_result blocks in the next user turn, matched by the service's own id.
 * The tools list is the same for every request of a message (only `tool_choice` changes), and the
 * result depends only on the messages so far, so each request starts with the previous one.
 */
export function messagesRequest(
  model: string,
  messages: ChatMessage[],
  tools: ToolSpec[],
  options: MessagesRequestOptions = {},
): Block {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const wire: WireMessage[] = [];
  const add = (role: WireMessage["role"], blocks: unknown[]) => {
    if (blocks.length === 0) return;
    const last = wire.at(-1);
    if (last && last.role === role) last.content.push(...blocks);
    else wire.push({ role, content: [...blocks] });
  };
  const serviceIds = new Map<string, string>();
  for (const message of messages) {
    switch (message.role) {
      case "system":
        break;
      case "user":
        add("user", message.content ? [{ type: "text", text: message.content }] : []);
        break;
      case "assistant": {
        for (const call of message.toolCalls ?? []) serviceIds.set(call.id, call.serviceId ?? call.id);
        if (message.replay?.format === "messages") {
          add(
            "assistant",
            options.dropThinking?.(message.replay)
              ? message.replay.items.filter(
                  (block) => !THINKING_TYPES.has((block as Block | null)?.type as string),
                )
              : message.replay.items,
          );
          break;
        }
        const blocks: Block[] = message.content ? [{ type: "text", text: message.content }] : [];
        for (const call of message.toolCalls ?? []) {
          blocks.push({
            type: "tool_use",
            id: call.serviceId ?? call.id,
            name: call.name,
            input: asObject(call.args),
          });
        }
        add("assistant", blocks);
        break;
      }
      case "tool":
        add("user", [
          {
            type: "tool_result",
            tool_use_id: serviceIds.get(message.toolCallId) ?? message.toolCallId,
            content: message.content,
          },
        ]);
        break;
    }
  }
  return {
    model,
    max_tokens: MAX_TOKENS,
    ...(system ? { system } : {}),
    messages: wire,
    ...(tools.length
      ? {
          tools: tools.map(toAnthropicTool),
          tool_choice: { type: options.allowTools === false ? "none" : "auto" },
        }
      : {}),
  };
}

function toAnthropicTool(tool: ToolSpec): Block {
  return { name: tool.name, description: tool.description, input_schema: tool.parameters };
}

/** A tool_use block's input must be an object. */
function asObject(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}
