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
import { GEMINI_ORIGIN } from "./services.js";

/**
 * Gemini, through Google's own generateContent API: POST
 * https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent with the key in
 * x-goog-api-key (never in the address). The host is fixed and the model name is checked before it
 * goes into the path. Google's OpenAI-compatible address isn't used: current Gemini models need
 * their "thought signatures" sent back with each skill request in the same turn, and Google
 * documents where they go only for this API.
 */

/** A model name as it may appear in the path: letters, digits, dots, dashes and underscores. */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The model name without Google's "models/" prefix, or null if it can't safely go in the path. */
export function geminiModel(model: string): string | null {
  const name = model.trim().replace(/^models\//, "");
  return MODEL_NAME.test(name) ? name : null;
}

export function generateUrl(model: string): string {
  return `${GEMINI_ORIGIN}/v1beta/models/${model}:generateContent`;
}

/** A thought signature as Google sends it: base64 text, kept only within a sensible size. */
const SIGNATURE = /^[A-Za-z0-9+/=_-]{1,200000}$/;

const part = z.looseObject({
  text: z.string().nullish(),
  thought: z.boolean().nullish(),
  functionCall: z.object({ name: z.string().min(1), args: z.unknown() }).nullish(),
  thoughtSignature: z.string().nullish(),
});
const generateReply = z.object({
  candidates: z
    .array(z.object({ content: z.object({ parts: z.array(part).nullish() }).nullish() }))
    .nullish(),
});

type Part = Record<string, unknown>;
interface Content {
  role: "user" | "model";
  parts: Part[];
}

export interface GeminiBrainOptions {
  model: string;
  /** Reads the key at call time, for the exact address the request goes to. The brain never keeps it. */
  getKey: (url: string) => Promise<string | null>;
  /** Removes known secrets from text (Sage's redactor). The key itself is always removed. */
  redact?: (text: string) => string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class GeminiBrain implements Brain {
  readonly kind = "online";
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly service: ServiceName = serviceName("Gemini");

  constructor(private readonly options: GeminiBrainOptions) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<BrainReply> {
    if (!this.options.model.trim()) {
      return { ok: false, message: "Choose the model for Gemini in Settings first." };
    }
    const model = geminiModel(this.options.model);
    if (!model) {
      return {
        ok: false,
        message: "The Gemini model name in Settings isn't valid. Use a name like the ones Load models shows.",
      };
    }
    const url = generateUrl(model);
    // The key for exactly this address: checked here, at the point of the request.
    const key = await this.options.getKey(url);
    if (!key) return { ok: false, message: "Add your Gemini key in Settings first." };
    const reply = await requestService(
      this.fetch,
      url,
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify(generateRequest(messages, tools)),
      },
      this.service,
      this.timeoutMs,
    );
    if (!reply.ok) return reply;
    const parsed = generateReply.safeParse(reply.body);
    if (!parsed.success) return { ok: false, message: unreadableMessage(this.service) };
    // A service can echo the key back even in a successful reply. Remove it (and any other secret
    // the redactor knows) from the text and the tool-call arguments before anything else sees them.
    const redact = this.options.redact ?? ((text: string) => text);
    const clean = (text: string) => redact(text.split(key).join("[redacted]"));
    let text = "";
    const toolCalls: ToolCall[] = [];
    // No candidate (a message the service wouldn't answer): an empty reply.
    for (const item of parsed.data.candidates?.[0]?.content?.parts ?? []) {
      // The model's own reasoning, if the service ever includes it, isn't part of the answer.
      if (item.thought) continue;
      if (item.functionCall) {
        const signature = item.thoughtSignature;
        toolCalls.push({
          id: randomUUID(),
          name: clean(item.functionCall.name),
          args: scrubStrings(item.functionCall.args ?? {}, clean),
          ...(signature && SIGNATURE.test(signature) && !signature.includes(key) ? { signature } : {}),
        });
        continue;
      }
      if (item.text) text += item.text;
    }
    return { ok: true, content: clean(stripThinking(text)), toolCalls };
  }
}

/**
 * Sage's conversation in Google's format: system messages become `systemInstruction`; a skill
 * request is a functionCall part in the model's turn (with its thought signature, if it had one);
 * skill results are functionResponse parts in the next user turn. Turns of the same role are joined.
 */
export function generateRequest(messages: ChatMessage[], tools: ToolSpec[]): Part {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const contents: Content[] = [];
  const add = (role: Content["role"], parts: Part[]) => {
    if (parts.length === 0) return;
    const last = contents.at(-1);
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  };
  const used = new Set<string>();
  for (const message of messages) {
    switch (message.role) {
      case "system":
        break;
      case "user":
        add("user", message.content ? [{ text: message.content }] : []);
        break;
      case "assistant": {
        const parts: Part[] = message.content ? [{ text: message.content }] : [];
        for (const call of message.toolCalls ?? []) {
          used.add(call.name);
          parts.push({
            functionCall: { name: call.name, args: asObject(call.args) },
            ...(call.signature ? { thoughtSignature: call.signature } : {}),
          });
        }
        add("model", parts);
        break;
      }
      case "tool":
        add("user", [{ functionResponse: { name: message.name, response: { result: message.content } } }]);
        break;
    }
  }
  // Once the skill limit for a message is reached Sage offers no more skills, but the conversation
  // may still hold earlier skill requests: those skills are named (without their details) and
  // switched off, so the model can only answer.
  const offered = tools.length
    ? {
        tools: [{ functionDeclarations: tools.map(toDeclaration) }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      }
    : used.size
      ? {
          tools: [
            {
              functionDeclarations: [...used].map((name) => ({
                name,
                description: "Not available now.",
                parametersJsonSchema: { type: "object" },
              })),
            },
          ],
          toolConfig: { functionCallingConfig: { mode: "NONE" } },
        }
      : {};
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    ...offered,
  };
}

function toDeclaration(tool: ToolSpec): Part {
  // Sage's skills describe their arguments in JSON Schema, which this field takes as it is.
  return { name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters };
}

/** A functionCall's args must be an object. */
function asObject(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}
