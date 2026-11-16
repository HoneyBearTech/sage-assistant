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
 * documents where they go only for this API. The model's own turns are sent back exactly as they
 * came within one message, so the signatures, ids and parts are the service's own.
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

const part = z.looseObject({
  text: z.string().nullish(),
  thought: z.boolean().nullish(),
  // Both the arguments and the id are optional: a skill with no arguments may come without any.
  functionCall: z
    .object({
      name: z.string().min(1),
      args: z.unknown().optional(),
      id: z.string().min(1).max(200).nullish(),
    })
    .nullish(),
});
const generateReply = z.object({
  candidates: z
    .array(z.object({ content: z.object({ parts: z.array(part).nullish() }).nullish() }))
    .nullish(),
});

type Part = Record<string, unknown>;
interface Content {
  role: "user" | "model";
  parts: unknown[];
}

export interface GeminiBrainOptions {
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

export class GeminiBrain implements Brain {
  readonly kind = "online";
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly service: ServiceName = serviceName("Gemini");

  constructor(private readonly options: GeminiBrainOptions) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[], allowTools = true): Promise<BrainReply> {
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
        body: JSON.stringify(generateRequest(messages, tools, allowTools)),
      },
      this.service,
      this.timeoutMs,
      this.options.timeoutSignal,
    );
    if (!reply.ok) return { ok: false, message: reply.message };
    const parsed = generateReply.safeParse(reply.body);
    if (!parsed.success) return { ok: false, message: unreadableMessage(this.service) };
    // A service can echo the key back even in a successful reply. Remove it (and any other secret
    // the redactor knows) from what Sage shows, keeps or acts on. The model's turn itself goes
    // back to the service unchanged (below), with its thought signatures.
    const redact = this.options.redact ?? ((text: string) => text);
    const clean = (text: string) => redact(text.split(key).join("[redacted]"));
    let text = "";
    const toolCalls: ToolCall[] = [];
    // No candidate (a message the service wouldn't answer): an empty reply.
    const parts = parsed.data.candidates?.[0]?.content?.parts ?? [];
    for (const item of parts) {
      // The model's own reasoning, if the service ever includes it, isn't part of the answer.
      if (item.thought) continue;
      if (item.functionCall) {
        toolCalls.push({
          id: randomUUID(),
          name: clean(item.functionCall.name),
          args: scrubStrings(item.functionCall.args ?? {}, clean),
          ...(item.functionCall.id ? { serviceId: item.functionCall.id } : {}),
        });
        continue;
      }
      if (item.text) text += item.text;
    }
    const raw = (reply.body as { candidates: { content: { parts: unknown[] } }[] }).candidates?.[0]?.content
      ?.parts;
    return {
      ok: true,
      content: clean(stripThinking(text)),
      toolCalls,
      ...(raw?.length ? { replay: { format: "generate" as const, items: raw } } : {}),
    };
  }
}

/**
 * Sage's conversation in Google's format: system messages become `systemInstruction`. A model turn
 * this brain received is sent back exactly as it came (`replay`: every part, with its thought
 * signature and id); one from the chat history is its text. Skill results are functionResponse
 * parts in the next user turn, with the id of the call they answer. The declarations are the same
 * for every request of a message; past the skill limit the mode is NONE.
 */
export function generateRequest(messages: ChatMessage[], tools: ToolSpec[], allowTools = true): Part {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const contents: Content[] = [];
  const add = (role: Content["role"], parts: unknown[]) => {
    if (parts.length === 0) return;
    const last = contents.at(-1);
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts: [...parts] });
  };
  const serviceIds = new Map<string, string>();
  for (const message of messages) {
    switch (message.role) {
      case "system":
        break;
      case "user":
        add("user", message.content ? [{ text: message.content }] : []);
        break;
      case "assistant": {
        for (const call of message.toolCalls ?? []) {
          if (call.serviceId) serviceIds.set(call.id, call.serviceId);
        }
        if (message.replay?.format === "generate") {
          add("model", message.replay.items);
          break;
        }
        const parts: Part[] = message.content ? [{ text: message.content }] : [];
        for (const call of message.toolCalls ?? []) {
          parts.push({
            functionCall: {
              name: call.name,
              args: asObject(call.args),
              ...(call.serviceId ? { id: call.serviceId } : {}),
            },
          });
        }
        add("model", parts);
        break;
      }
      case "tool": {
        const id = serviceIds.get(message.toolCallId);
        add("user", [
          {
            functionResponse: {
              ...(id ? { id } : {}),
              name: message.name,
              response: { result: message.content },
            },
          },
        ]);
        break;
      }
    }
  }
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    ...(tools.length
      ? {
          tools: [{ functionDeclarations: tools.map(toDeclaration) }],
          toolConfig: { functionCallingConfig: { mode: allowTools ? "AUTO" : "NONE" } },
        }
      : {}),
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
