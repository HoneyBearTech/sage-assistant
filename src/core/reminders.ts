import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "./json-file.js";
import type { Logger } from "./log.js";
import { Serial } from "./serial.js";

export const MAX_REMINDER_TEXT = 500;

const reminderSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  due: z.iso.datetime({ offset: true }),
  created: z.string(),
  firedAt: z.string().nullable(),
});
export type Reminder = z.infer<typeof reminderSchema>;

const remindersFile = z.object({ version: z.literal(1), reminders: z.array(reminderSchema) });

export class RemindersStore {
  private readonly path: string;
  private readonly serial = new Serial();

  constructor(
    dataDir: string,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.path = join(dataDir, "reminders.json");
  }

  list(): Promise<Reminder[]> {
    return this.serial.run(() => this.load());
  }

  async get(id: string): Promise<Reminder | undefined> {
    return (await this.list()).find((reminder) => reminder.id === id);
  }

  add(text: string, due: Date): Promise<Reminder> {
    return this.serial.run(async () => {
      const reminders = await this.load();
      const reminder: Reminder = {
        id: randomUUID().slice(0, 8),
        text: text.trim().slice(0, MAX_REMINDER_TEXT),
        due: due.toISOString(),
        created: this.now().toISOString(),
        firedAt: null,
      };
      reminders.push(reminder);
      await this.save(reminders);
      return reminder;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.serial.run(async () => {
      const reminders = await this.load();
      const kept = reminders.filter((reminder) => reminder.id !== id);
      if (kept.length === reminders.length) return false;
      await this.save(kept);
      return true;
    });
  }

  /** Marks every reminder due at `at` or earlier as fired, and returns the ones it marked. */
  takeDue(at: Date): Promise<Reminder[]> {
    return this.serial.run(async () => {
      const reminders = await this.load();
      const due = reminders.filter(
        (reminder) => reminder.firedAt === null && Date.parse(reminder.due) <= at.getTime(),
      );
      if (due.length === 0) return [];
      const firedAt = at.toISOString();
      for (const reminder of due) reminder.firedAt = firedAt;
      await this.save(reminders);
      return due;
    });
  }

  private async load(): Promise<Reminder[]> {
    const result = await readJson(this.path, remindersFile, this.now);
    if (result.status === "ok") return result.value.reminders;
    if (result.status === "invalid") {
      this.logger.warn(`reminders.json couldn't be read; it was kept as ${result.movedTo}`);
    }
    return [];
  }

  private save(reminders: Reminder[]): Promise<void> {
    return writeJsonAtomic(this.path, { version: 1, reminders });
  }
}
