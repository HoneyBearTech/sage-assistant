import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type Brain,
  type BrainReply,
  type ChatMessage,
  type FetchLike,
  scrubStrings,
  stripThinking,
  type ToolCall,
  type ToolSpec,
} from "./brain.js";
import { type ServiceName, serviceName, unreadableMessage } from "./errors.js";
import { requestService } from "./request.js";
import { ANTHROPIC_ORIGIN } from "./services.js";

/**
 * Claude, through Anthropic's Messages API: POST https://api.anthropic.com/v1/messages with the key
 * in x-api-key. The address is fixed. Sage's skills go as tools; the model only answers, or asks to
 * use a skill, which Sage runs itself through the ask-first gate.
 */

export const MESSAGES_URL = `${ANTHROPIC_ORIGIN}/v1/messages`;
export const ANTHROPIC_VERSION = "2023-06-01";
/** The longest answer asked for, in tokens: plenty for Sage's short replies. */
export const MAX_TOKENS = 2048;

/** The headers for every request to Anthropic, list of models included. */
export function anthropicHeaders(key: string): Record<string, string> {
  return { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" };
}

const textBlock = z.object({ type: z.literal("text"), text: z.string() });
const toolUseBlock = z.object({
  type: z.literal("tool_use"),
  id: z.string().nullish(),
  name: z.string().min(1),
  input: z.unknown(),
});
const messagesReply = z.object({
  // Other block types (a future kind, say) are skipped, not refused.
  content: z.array(z.looseObject({ type: z.string() })),
});

type Block = Record<string, unknown>;
interface WireMessage {
  role: "user" | "assistant";
  content: Block[];
}

export interface MessagesBrainOptions {
  model: string;
  /** Reads the key at call time, for the exact address the request goes to. The brain never keeps it. */
  getKey: (url: string) => Promise<string | null>;
  /** Removes known secrets from text (Sage's redactor). The key itself is always removed. */
  redact?: (text: string) => string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class MessagesBrain implements Brain {
  readonly kind = "online";
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly service: ServiceName = serviceName("Claude");

  constructor(private readonly options: MessagesBrainOptions) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<BrainReply> {
    if (!this.options.model.trim()) {
      return { ok: false, message: "Choose the model for Claude in Settings first." };
    }
    // The key for exactly this address: checked here, at the point of the request.
    const key = await this.options.getKey(MESSAGES_URL);
    if (!key) return { ok: false, message: "Add your Claude key in Settings first." };
    const reply = await requestService(
      this.fetch,
      MESSAGES_URL,
      {
        method: "POST",
        headers: anthropicHeaders(key),
        body: JSON.stringify(messagesRequest(this.options.model, messages, tools)),
      },
      this.service,
      this.timeoutMs,
    );
    if (!reply.ok) return reply;
    const parsed = messagesReply.safeParse(reply.body);
    if (!parsed.success) return { ok: false, message: unreadableMessage(this.service) };
    // A service can echo the key back even in a successful reply. Remove it (and any other secret
    // the redactor knows) from the text and the tool-call arguments before anything else sees them.
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
        });
      }
    }
    return { ok: true, content: clean(stripThinking(text)), toolCalls };
  }
}

/**
 * Sage's conversation in the Messages format: system messages become the `system` field; a skill
 * request is a tool_use block in the assistant's turn; skill results are tool_result blocks in the
 * next user turn (first in it, as the format asks). Turns of the same role are joined.
 */
export function messagesRequest(model: string, messages: ChatMessage[], tools: ToolSpec[]): Block {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const wire: WireMessage[] = [];
  const add = (role: WireMessage["role"], blocks: Block[]) => {
    if (blocks.length === 0) return;
    const last = wire.at(-1);
    if (last && last.role === role) last.content.push(...blocks);
    else wire.push({ role, content: blocks });
  };
  const used = new Set<string>();
  for (const message of messages) {
    switch (message.role) {
      case "system":
        break;
      case "user":
        add("user", message.content ? [{ type: "text", text: message.content }] : []);
        break;
      case "assistant": {
        const blocks: Block[] = message.content ? [{ type: "text", text: message.content }] : [];
        for (const call of message.toolCalls ?? []) {
          used.add(call.name);
          blocks.push({ type: "tool_use", id: call.id, name: call.name, input: asObject(call.args) });
        }
        add("assistant", blocks);
        break;
      }
      case "tool":
        add("user", [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }]);
        break;
    }
  }
  // Once the skill limit for a message is reached Sage offers no more skills, but the conversation
  // may still hold earlier skill requests: those skills are named (without their details) and
  // switched off, so the model can only answer.
  const offered = tools.length
    ? { tools: tools.map(toAnthropicTool), tool_choice: { type: "auto" } }
    : used.size
      ? {
          tools: [...used].map((name) => ({
            name,
            description: "Not available now.",
            input_schema: { type: "object" },
          })),
          tool_choice: { type: "none" },
        }
      : {};
  return {
    model,
    max_tokens: MAX_TOKENS,
    ...(system ? { system } : {}),
    messages: wire,
    ...offered,
  };
}

function toAnthropicTool(tool: ToolSpec): Block {
  return { name: tool.name, description: tool.description, input_schema: tool.parameters };
}

/** A tool_use block's input must be an object. */
function asObject(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}
