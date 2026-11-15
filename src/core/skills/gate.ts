import { createHash } from "node:crypto";

/**
 * The ask-first gate. It lives in the main process, and it is the only place approvals come from.
 *
 * A skill marked "confirm" runs only after `consume` finds an approval for that exact call: the
 * same call id and the same skill and arguments (compared by hash). An approval is created only
 * when the confirmation dialog, which the user answers, returns "Allow". Each approval works once.
 * There is no way to approve in advance, approve a whole skill, or switch the gate off.
 */

export interface ConfirmRequest {
  callId: string;
  skill: string;
  /** Plain words saying exactly what will happen. */
  summary: string;
}

/** Shows the confirmation dialog. Resolves true only when the user chose "Allow". */
export interface ConfirmPresenter {
  ask(request: ConfirmRequest): Promise<boolean>;
}

/** A stable hash of a skill name and its arguments; key order doesn't matter. */
export function hashCall(skill: string, args: unknown): string {
  return createHash("sha256").update(canonicalJson({ skill, args })).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export class ApprovalGate {
  private readonly approvals = new Map<string, string>();

  constructor(private readonly presenter: ConfirmPresenter) {}

  /** Asks the user. On "Allow", records a single-use approval for exactly this call. */
  async ask(callId: string, skill: string, args: unknown, summary: string): Promise<boolean> {
    let allowed = false;
    try {
      allowed = (await this.presenter.ask({ callId, skill, summary })) === true;
    } catch {
      allowed = false;
    }
    if (allowed) this.approvals.set(callId, hashCall(skill, args));
    return allowed;
  }

  /**
   * Uses up the approval for this call. Returns false, and removes any approval for the id, when
   * there is none or it was given for a different skill or different arguments.
   */
  consume(callId: string, skill: string, args: unknown): boolean {
    const expected = this.approvals.get(callId);
    this.approvals.delete(callId);
    return expected !== undefined && expected === hashCall(skill, args);
  }

  /** How many approvals are waiting to be used (normally zero between calls). */
  get outstanding(): number {
    return this.approvals.size;
  }
}
