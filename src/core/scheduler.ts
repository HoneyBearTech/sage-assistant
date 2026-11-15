import type { Logger } from "./log.js";
import type { RemindersStore } from "./reminders.js";
import { Serial } from "./serial.js";

export interface Clock {
  now(): Date;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => new Date(),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** Shows a desktop notification. In the app this is Electron's Notification. */
export type Notifier = (title: string, body: string) => void;

/** Checks for due reminders on a timer and shows a notification for each one, once. */
export class ReminderScheduler {
  private handle: unknown;
  private readonly serial = new Serial();

  constructor(
    private readonly store: RemindersStore,
    private readonly notify: Notifier,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  start(intervalMs = 15_000): void {
    if (this.handle !== undefined) return;
    this.handle = this.clock.setInterval(() => {
      void this.tick();
    }, intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.handle === undefined) return;
    this.clock.clearInterval(this.handle);
    this.handle = undefined;
  }

  /** Fires every reminder that is due now (including ones missed while Sage was closed). */
  tick(): Promise<number> {
    return this.serial.run(() => this.fireDue());
  }

  private async fireDue(): Promise<number> {
    try {
      const due = await this.store.takeDue(this.clock.now());
      for (const reminder of due) {
        try {
          this.notify("Sage reminder", reminder.text);
        } catch (error) {
          this.logger.error("Couldn't show a reminder notification", error);
        }
      }
      return due.length;
    } catch (error) {
      this.logger.error("Couldn't check reminders", error);
      return 0;
    }
  }
}
