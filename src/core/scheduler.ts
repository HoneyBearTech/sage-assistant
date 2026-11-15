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

/**
 * Shows a reminder to the user and says whether it was actually shown. In the app this is a
 * desktop notification, with a message in Sage's window as the fallback (src/main/notify.ts).
 */
export type Notifier = (title: string, body: string) => boolean | Promise<boolean>;

/**
 * Checks for due reminders on a timer and shows each one once. A reminder is marked as shown only
 * after the notifier says it was shown; otherwise it stays due and the next check tries again.
 */
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

  /**
   * Shows every reminder that is due now (including ones missed while Sage was closed) and returns
   * how many were shown.
   */
  tick(): Promise<number> {
    return this.serial.run(() => this.fireDue());
  }

  private async fireDue(): Promise<number> {
    let shown = 0;
    try {
      const due = await this.store.due(this.clock.now());
      for (const reminder of due) {
        let ok = false;
        try {
          ok = await this.notify("Sage reminder", reminder.text);
        } catch (error) {
          this.logger.error("Couldn't show a reminder notification", error);
        }
        if (!ok) {
          this.logger.warn("A reminder couldn't be shown yet; Sage will try again on the next check");
          continue;
        }
        await this.store.markFired(reminder.id, this.clock.now());
        shown++;
      }
    } catch (error) {
      this.logger.error("Couldn't check reminders", error);
    }
    return shown;
  }
}
