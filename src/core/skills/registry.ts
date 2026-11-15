import { z } from "zod";
import type { ToolCall, ToolSpec } from "../brain/brain.js";
import { describeError, type Logger } from "../log.js";
import type { ActionLog } from "./action-log.js";
import type { ApprovalGate } from "./gate.js";
import { wrapUntrusted } from "./untrusted.js";

/** "safe" skills run straight away. "confirm" skills ask the user first, every time. */
export type Risk = "safe" | "confirm";

export interface SkillOutput {
  text: string;
  /** When set, the skill's text is the final reply to the user and the turn ends. */
  final?: boolean;
}

export type Prepared = { ok: true; summary: string } | { ok: false; message: string };

export interface SkillDefinition<A> {
  name: string;
  description: string;
  risk: Risk;
  args: z.ZodType<A>;
  /** Set for skills whose output comes from outside (web pages, files): it is wrapped as untrusted. */
  untrustedSource?: string;
  /**
   * Required for "confirm" skills: checks the call is allowed (the app is on the list, the file is
   * in an approved folder) and says in plain words exactly what will happen.
   */
  prepare?: (args: A) => Promise<Prepared>;
  run: (args: A) => Promise<SkillOutput>;
}

export interface Skill {
  name: string;
  description: string;
  risk: Risk;
  untrustedSource: string | undefined;
  parameters: Record<string, unknown>;
  parse(raw: unknown): { ok: true; args: unknown } | { ok: false; message: string };
  prepare(args: unknown): Promise<Prepared>;
  run(args: unknown): Promise<SkillOutput>;
}

export function defineSkill<A>(definition: SkillDefinition<A>): Skill {
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
    // Only values returned by parse() reach these two, so the cast is safe.
    prepare: (args) =>
      definition.prepare
        ? definition.prepare(args as A)
        : Promise.resolve({ ok: true, summary: definition.name }),
    run: (args) => definition.run(args as A),
  };
}

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
  async execute(call: ToolCall): Promise<ExecuteResult> {
    const skill = this.skills.get(call.name);
    if (!skill) {
      return { text: `There is no skill called "${call.name}". Use only the listed tools.`, ran: false };
    }
    const parsed = skill.parse(call.args);
    if (!parsed.ok) {
      return { text: `The arguments for ${skill.name} were not valid:\n${parsed.message}`, ran: false };
    }
    if (skill.risk === "safe") return this.runSkill(skill, parsed.args);

    const prepared = await skill.prepare(parsed.args);
    if (!prepared.ok) return { text: prepared.message, ran: false };

    const allowed = await this.gate.ask(call.id, skill.name, parsed.args, prepared.summary);
    if (!allowed) {
      await this.log(call, skill, prepared.summary, "declined", "not run");
      return {
        text: "The user chose not to allow this, so it was not done. Don't try it again unless they ask.",
        ran: false,
      };
    }
    if (!this.gate.consume(call.id, skill.name, parsed.args)) {
      await this.log(call, skill, prepared.summary, "allowed", "blocked: the approval didn't match");
      return { text: "This action was not approved, so it was not done.", ran: false };
    }
    // Check again just before acting, in case something changed while the dialog was open.
    const again = await skill.prepare(parsed.args);
    if (!again.ok || again.summary !== prepared.summary) {
      await this.log(call, skill, prepared.summary, "allowed", "blocked: changed after approval");
      return {
        text: again.ok ? "Something changed after approval, so it was not done." : again.message,
        ran: false,
      };
    }
    const result = await this.runSkill(skill, parsed.args);
    await this.log(call, skill, prepared.summary, "allowed", result.ran ? "done" : "failed");
    return result;
  }

  private async runSkill(skill: Skill, args: unknown): Promise<ExecuteResult> {
    try {
      const output = await skill.run(args);
      const text = skill.untrustedSource ? wrapUntrusted(skill.untrustedSource, output.text) : output.text;
      return output.final ? { text, final: output.text, ran: true } : { text, ran: true };
    } catch (error) {
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
