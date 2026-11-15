import type { Brain, ChatMessage } from "./brain/brain.js";
import type { Logger } from "./log.js";
import { systemPrompt } from "./prompt.js";
import type { SkillRegistry } from "./skills/registry.js";

/** The most tool calls Sage will run for one message, and the most rounds with the model. */
export const MAX_TOOL_CALLS_PER_TURN = 6;
export const MAX_ROUNDS_PER_TURN = 6;
/**
 * Skills that write something are capped lower, so a model talked into it by a web page can't
 * fill the notes or reminders in one go.
 */
export const PER_TURN_SKILL_LIMITS: Readonly<Record<string, number>> = { add_note: 3, add_reminder: 3 };
/** How many earlier messages are sent with each new one. */
export const HISTORY_LIMIT = 20;
/** What send() returns for a message whose chat was cleared before the reply arrived. */
export const CLEARED_REPLY = "(This chat was cleared, so the reply was dropped.)";
/** What send() returns for a message whose turn was stopped because the brain settings changed. */
export const SETTINGS_CHANGED_REPLY =
  "(The brain settings changed while Sage was answering, so that answer was stopped. Ask again.)";

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
  /** Goes up on every reset; a turn started under an older value is abandoned. */
  private generation = 0;
  /** The reply for each stopped turn, by the generation it started under. */
  private readonly stopped = new Map<number, string>();
  private readonly now: () => Date;

  constructor(private readonly deps: AssistantDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  get transcript(): readonly ChatEntry[] {
    return this.history;
  }

  /**
   * Starts a new chat. A reply still in progress is abandoned: it runs no further tool calls,
   * writes nothing to the history, and a new message can be sent straight away.
   */
  reset(): void {
    this.history.length = 0;
    this.stopTurn(CLEARED_REPLY);
  }

  /**
   * Stops a turn in progress without clearing the chat: it runs no further tool calls, sends
   * nothing more to the brain, and its reply is `reply` instead. Used when the brain settings
   * change, so a turn never carries on against a service the user has moved away from.
   */
  stopTurn(reply = SETTINGS_CHANGED_REPLY): void {
    if (this.busy) this.stopped.set(this.generation, reply);
    this.generation++;
    this.busy = false;
  }

  async send(text: string): Promise<string> {
    if (this.busy) return "I'm still working on your last message.";
    this.busy = true;
    const generation = this.generation;
    const current = () => this.generation === generation;
    const stoppedReply = () => {
      const reply = this.stopped.get(generation) ?? CLEARED_REPLY;
      this.stopped.delete(generation);
      return reply;
    };
    try {
      const reply = await this.turn(text, current);
      if (!current()) return stoppedReply();
      this.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
      if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
      return reply;
    } finally {
      if (current()) this.busy = false;
    }
  }

  private async turn(text: string, current: () => boolean): Promise<string> {
    const brain = await this.deps.getBrain();
    const tools = this.deps.registry.toolSpecs();
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(this.now()) },
      ...this.history,
      { role: "user", content: text },
    ];
    let callsUsed = 0;
    const perSkill = new Map<string, number>();
    for (let round = 0; round < MAX_ROUNDS_PER_TURN; round++) {
      if (!current()) return CLEARED_REPLY;
      const reply = await brain.chat(messages, callsUsed < MAX_TOOL_CALLS_PER_TURN ? tools : []);
      if (!current()) return CLEARED_REPLY;
      if (!reply.ok) return reply.message;
      if (reply.toolCalls.length === 0) return reply.content.trim() || "(Sage had nothing to say.)";

      messages.push({ role: "assistant", content: reply.content, toolCalls: reply.toolCalls });
      for (const call of reply.toolCalls) {
        if (!current()) return CLEARED_REPLY;
        const skillLimit = PER_TURN_SKILL_LIMITS[call.name];
        const skillUsed = perSkill.get(call.name) ?? 0;
        let refusal: string | undefined;
        if (callsUsed >= MAX_TOOL_CALLS_PER_TURN) {
          refusal =
            "Not run: the limit of tool calls for one message was reached. Answer with what you have.";
        } else if (skillLimit !== undefined && skillUsed >= skillLimit) {
          refusal = `Not run: ${call.name} can be used at most ${skillLimit} times for one message.`;
        }
        if (refusal) {
          messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: refusal });
          continue;
        }
        callsUsed++;
        perSkill.set(call.name, skillUsed + 1);
        const result = await this.deps.registry.execute(call, current);
        if (!current()) return CLEARED_REPLY;
        if (result.final !== undefined) return result.final;
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: result.text });
      }
    }
    this.deps.logger.warn("A turn stopped after the maximum number of rounds");
    return "I stopped because this was taking too many steps. Try asking in a simpler way.";
  }
}
