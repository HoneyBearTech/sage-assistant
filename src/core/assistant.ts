import type { Brain, ChatMessage } from "./brain/brain.js";
import type { Logger } from "./log.js";
import { systemPrompt } from "./prompt.js";
import type { SkillRegistry } from "./skills/registry.js";

/** The most tool calls Sage will run for one message, and the most rounds with the model. */
export const MAX_TOOL_CALLS_PER_TURN = 6;
export const MAX_ROUNDS_PER_TURN = 6;
/** How many earlier messages are sent with each new one. */
export const HISTORY_LIMIT = 20;

export interface AssistantDeps {
  getBrain: () => Promise<Brain>;
  registry: SkillRegistry;
  logger: Logger;
  now?: () => Date;
}

export type ChatEntry = { role: "user" | "assistant"; content: string };

/**
 * Runs one conversation. Tool calls are taken only from the model's structured tool-call output;
 * text in a reply, a web page or a note is never parsed for commands.
 */
export class Assistant {
  private readonly history: ChatEntry[] = [];
  private busy = false;
  private readonly now: () => Date;

  constructor(private readonly deps: AssistantDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  get transcript(): readonly ChatEntry[] {
    return this.history;
  }

  reset(): void {
    this.history.length = 0;
  }

  async send(text: string): Promise<string> {
    if (this.busy) return "I'm still working on your last message.";
    this.busy = true;
    try {
      const reply = await this.turn(text);
      this.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
      if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
      return reply;
    } finally {
      this.busy = false;
    }
  }

  private async turn(text: string): Promise<string> {
    const brain = await this.deps.getBrain();
    const tools = this.deps.registry.toolSpecs();
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(this.now()) },
      ...this.history,
      { role: "user", content: text },
    ];
    let callsUsed = 0;
    for (let round = 0; round < MAX_ROUNDS_PER_TURN; round++) {
      const reply = await brain.chat(messages, callsUsed < MAX_TOOL_CALLS_PER_TURN ? tools : []);
      if (!reply.ok) return reply.message;
      if (reply.toolCalls.length === 0) return reply.content.trim() || "(Sage had nothing to say.)";

      messages.push({ role: "assistant", content: reply.content, toolCalls: reply.toolCalls });
      for (const call of reply.toolCalls) {
        if (callsUsed >= MAX_TOOL_CALLS_PER_TURN) {
          messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content:
              "Not run: the limit of tool calls for one message was reached. Answer with what you have.",
          });
          continue;
        }
        callsUsed++;
        const result = await this.deps.registry.execute(call);
        if (result.final !== undefined) return result.final;
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: result.text });
      }
    }
    this.deps.logger.warn("A turn stopped after the maximum number of rounds");
    return "I stopped because this was taking too many steps. Try asking in a simpler way.";
  }
}
