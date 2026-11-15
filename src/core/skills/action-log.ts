import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type ActionDecision = "allowed" | "declined";

export interface ActionLogEntry {
  time: string;
  callId: string;
  skill: string;
  /** What the confirmation dialog said would happen. */
  summary: string;
  decision: ActionDecision;
  /** What happened after the decision: "done", or why it didn't run. */
  outcome: string;
}

/** An append-only JSONL file with one line for every action the user allowed or declined. */
export class ActionLog {
  constructor(
    private readonly path: string,
    private readonly redact: (text: string) => string = (text) => text,
  ) {}

  async append(entry: ActionLogEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${this.redact(JSON.stringify(entry))}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}
