import { z } from "zod";
import type { ToolCall, ToolSpec } from "../brain/brain.js";
import { describeError, type Logger } from "../log.js";
import type { ActionLog } from "./action-log.js";
import { dialogText } from "./display.js";
import { type ApprovalGate, hashCall } from "./gate.js";
import { wrapUntrusted } from "./untrusted.js";

/** "safe" skills run straight away. "confirm" skills ask the user first, every time. */
export type Risk = "safe" | "confirm";

export interface SkillOutput {
  text: string;
  /** When set, the skill's text is the final reply to the user and the turn ends. */
  final?: boolean;
}

/**
 * What a confirm skill's prepare step found. `summary` is the sentence the user sees. `action` is
 * exactly what will be done (for example the program path and arguments looked up from Settings);
 * it is part of the approval, and the skill's run step receives that approved action and must do
 * only that.
 */
export type Prepared<P = unknown> =
  | { ok: true; summary: string; action?: P }
  | { ok: false; message: string };

export interface SkillDefinition<A, P = undefined> {
  name: string;
  description: string;
  risk: Risk;
  args: z.ZodType<A>;
  /** Set for skills whose output comes from outside (web pages, files): it is wrapped as untrusted. */
  untrustedSource?: string;
  /**
   * Required for "confirm" skills: checks the call is allowed (the app is on the list, the file is
   * in an approved folder), works out exactly what will be done, and says it in plain words.
   */
  prepare?: (args: A) => Promise<Prepared<P>>;
  /**
   * For a confirm skill, `action` is the approved action from prepare. A run step that awaits
   * anything before its effect calls `stillWanted()` right before acting, and throws NotWanted if
   * it returns false.
   */
  run: (args: A, action: P | undefined, stillWanted: StillWanted) => Promise<SkillOutput>;
}

/** Thrown by a run step that finds its conversation was stopped before it acted. */
export class NotWanted extends Error {
  constructor() {
    super("the conversation was stopped before this was done");
  }
}

export interface Skill {
  name: string;
  description: string;
  risk: Risk;
  untrustedSource: string | undefined;
  parameters: Record<string, unknown>;
  parse(raw: unknown): { ok: true; args: unknown } | { ok: false; message: string };
  prepare(args: unknown): Promise<Prepared>;
  run(args: unknown, action?: unknown, stillWanted?: StillWanted): Promise<SkillOutput>;
}

/**
 * Called between steps; returns false once the conversation the call belongs to was cleared or
 * stopped (New chat, or a change of brain settings).
 */
export type StillWanted = () => boolean;

export function defineSkill<A, P = undefined>(definition: SkillDefinition<A, P>): Skill {
  if (definition.risk === "confirm" && !definition.prepare) {
    throw new Error(`Skill ${definition.name} asks first, so it needs a prepare step`);
  }
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(definition.args, {
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return {
    name: definition.name,
    description: definition.description,
    risk: definition.risk,
    untrustedSource: definition.untrustedSource,
    parameters,
    parse(raw) {
      const result = definition.args.safeParse(raw);
      if (result.success) return { ok: true, args: result.data };
      return { ok: false, message: z.prettifyError(result.error) };
    },
    // Only values returned by parse() and prepare() reach these two, so the casts are safe.
    prepare: (args) =>
      definition.prepare
        ? definition.prepare(args as A)
        : Promise.resolve({ ok: true, summary: definition.name }),
    run: (args, action, stillWanted = () => true) =>
      definition.run(args as A, action as P | undefined, stillWanted),
  };
}

/** What the approval covers: the arguments, the exact action, and the sentence that was shown. */
function approvalSubject(args: unknown, prepared: { summary: string; action?: unknown }): unknown {
  return { args, action: prepared.action ?? null, summary: prepared.summary };
}

/** The tool result when a call's conversation was cleared or stopped before it acted. */
export const STOPPED_TEXT =
  "The conversation was stopped (New chat or a settings change), so this was not done.";

export interface ExecuteResult {
  /** What goes back to the model as the tool result. */
  text: string;
  /** Set when the skill produced the final reply for the user. */
  final?: string;
  ran: boolean;
}

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  constructor(
    private readonly gate: ApprovalGate,
    private readonly actionLog: ActionLog,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  register(skill: Skill): void {
    if (this.skills.has(skill.name)) throw new Error(`Skill ${skill.name} is already registered`);
    this.skills.set(skill.name, skill);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  toolSpecs(): ToolSpec[] {
    return this.list().map((skill) => ({
      name: skill.name,
      description:
        skill.risk === "confirm"
          ? `${skill.description} The user is always asked to confirm this first.`
          : skill.description,
      parameters: skill.parameters,
    }));
  }

  /**
   * Runs one tool call from the model. A "confirm" skill reaches its handler only through the
   * gate: the user is asked, and the handler runs only if `consume` finds the matching approval.
   */
  async execute(call: ToolCall, stillWanted: StillWanted = () => true): Promise<ExecuteResult> {
    const skill = this.skills.get(call.name);
    if (!skill) {
      return { text: `There is no skill called "${call.name}". Use only the listed tools.`, ran: false };
    }
    const parsed = skill.parse(call.args);
    if (!parsed.ok) {
      return { text: `The arguments for ${skill.name} were not valid:\n${parsed.message}`, ran: false };
    }
    if (skill.risk === "safe") {
      if (!stillWanted()) return { text: STOPPED_TEXT, ran: false };
      return this.runSkill(skill, parsed.args, undefined, stillWanted);
    }

    const first = await skill.prepare(parsed.args);
    if (!first.ok) return { text: first.message, ran: false };
    // Never show the box for a conversation that is already gone.
    if (!stillWanted()) return { text: STOPPED_TEXT, ran: false };
    const prepared = { ...first, summary: dialogText(first.summary) };
    const subject = approvalSubject(parsed.args, prepared);
    const notRun = async (): Promise<ExecuteResult> => {
      await this.log(call, skill, prepared.summary, "allowed", "not run: the conversation was stopped");
      return { text: STOPPED_TEXT, ran: false };
    };

    const allowed = await this.gate.ask(call.id, skill.name, subject, prepared.summary);
    if (!allowed) {
      await this.log(call, skill, prepared.summary, "declined", "not run");
      return {
        text: "The user chose not to allow this, so it was not done. Don't try it again unless they ask.",
        ran: false,
      };
    }
    if (!stillWanted()) {
      this.gate.consume(call.id, skill.name, subject);
      return notRun();
    }
    if (!this.gate.consume(call.id, skill.name, subject)) {
      await this.log(call, skill, prepared.summary, "allowed", "blocked: the approval didn't match");
      return { text: "This action was not approved, so it was not done.", ran: false };
    }
    // Check again just before acting, in case something changed while the dialog was open. The
    // action must be exactly the approved one; the skill then runs with the approved action.
    const again = await skill.prepare(parsed.args);
    const sameAction =
      again.ok &&
      hashCall(skill.name, approvalSubject(parsed.args, { ...again, summary: dialogText(again.summary) })) ===
        hashCall(skill.name, subject);
    if (!sameAction) {
      await this.log(call, skill, prepared.summary, "allowed", "blocked: changed after approval");
      return {
        text: again.ok ? "Something changed after approval, so it was not done." : again.message,
        ran: false,
      };
    }
    // The second check awaited; the conversation may have been stopped meanwhile. Nothing awaits
    // between here and the run step, which checks again itself before any later await.
    if (!stillWanted()) return notRun();
    const result = await this.runSkill(skill, parsed.args, prepared.action, stillWanted);
    if (result.stopped) return notRun();
    await this.log(call, skill, prepared.summary, "allowed", result.ran ? "done" : "failed");
    return result;
  }

  private async runSkill(
    skill: Skill,
    args: unknown,
    action: unknown,
    stillWanted: StillWanted,
  ): Promise<ExecuteResult & { stopped?: true }> {
    try {
      const output = await skill.run(args, action, stillWanted);
      const text = skill.untrustedSource ? wrapUntrusted(skill.untrustedSource, output.text) : output.text;
      return output.final ? { text, final: output.text, ran: true } : { text, ran: true };
    } catch (error) {
      if (error instanceof NotWanted) return { text: STOPPED_TEXT, ran: false, stopped: true };
      this.logger.error(`Skill ${skill.name} failed`, error);
      return { text: `${skill.name} failed: ${describeError(error)}`, ran: false };
    }
  }

  private async log(
    call: ToolCall,
    skill: Skill,
    summary: string,
    decision: "allowed" | "declined",
    outcome: string,
  ): Promise<void> {
    try {
      await this.actionLog.append({
        time: this.now().toISOString(),
        callId: call.id,
        skill: skill.name,
        summary,
        decision,
        outcome,
      });
    } catch (error) {
      this.logger.error("Couldn't write to the action log", error);
    }
  }
}
