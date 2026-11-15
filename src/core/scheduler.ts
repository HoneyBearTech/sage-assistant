import type { Logger } from "./log.js";
import type { NoticeBoard } from "./notices.js";
import type { Reminder, RemindersStore } from "./reminders.js";
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
 * Shows a reminder as a desktop notification and says whether the system confirmed it was shown.
 * In the app this is Electron's Notification (src/main/notify.ts).
 */
export type Notifier = (title: string, body: string) => boolean | Promise<boolean>;

/** The notice-board key of a reminder's window notice. */
export function reminderNoticeKey(id: string): string {
  return `reminder:${id}`;
}

/**
 * Checks for due reminders on a timer and shows each one once. A reminder counts as shown only
 * when a desktop notification was confirmed, or when the window has confirmed it put the notice
 * on screen (not merely collected it). Until then it stays due: it is offered again on the next
 * check, or the next time Sage starts, so a reminder waiting for the window when Sage closes or
 * crashes isn't lost.
 */
export class ReminderScheduler {
  private handle: unknown;
  private readonly serial = new Serial();
  /** Reminders that were shown but couldn't be recorded as shown; they are never shown again. */
  private readonly unrecorded = new Set<string>();

  constructor(
    private readonly store: RemindersStore,
    private readonly notify: Notifier,
    private readonly clock: Clock,
    private readonly logger: Logger,
    /** Where a reminder goes when no desktop notification could be shown. */
    private readonly board?: NoticeBoard,
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
   * Offers every reminder that is due now (including ones missed while Sage was closed) and
   * returns how many were shown as desktop notifications.
   */
  tick(): Promise<number> {
    return this.serial.run(() => this.fireDue());
  }

  private async fireDue(): Promise<number> {
    let due: Reminder[];
    try {
      due = await this.store.due(this.clock.now());
    } catch (error) {
      this.logger.error("Couldn't check reminders", error);
      return 0;
    }
    let shown = 0;
    // Each reminder is handled on its own, so one failure can't stop the rest.
    for (const reminder of due) {
      try {
        if (await this.offer(reminder)) shown++;
      } catch (error) {
        this.logger.error("Couldn't handle a reminder", error);
      }
    }
    return shown;
  }

  /** Returns true if the reminder was shown as a desktop notification just now. */
  private async offer(reminder: Reminder): Promise<boolean> {
    if (this.unrecorded.has(reminder.id)) {
      // Already shown once; only the record failed. Try the record again, never the reminder.
      await this.record(reminder.id);
      return false;
    }
    const key = reminderNoticeKey(reminder.id);
    // Waiting in the window already: don't show it a second time on the desktop.
    if (this.board?.has(key)) return false;

    let confirmed = false;
    try {
      confirmed = await this.notify("Sage reminder", reminder.text);
    } catch (error) {
      this.logger.error("Couldn't show a reminder notification", error);
    }
    if (confirmed) {
      await this.record(reminder.id);
      return true;
    }
    const id = reminder.id;
    const queued = this.board?.post(`Sage reminder: ${reminder.text}`, {
      key,
      // Runs when the window confirms the notice is on screen. It waits for any check in
      // progress, so that check can't offer the same reminder again while it is recorded.
      onDelivered: () => this.serial.run(() => this.record(id)),
    });
    if (!queued) {
      this.logger.warn("A reminder couldn't be shown yet; Sage will try again on the next check");
    }
    return false;
  }

  /** Records that a reminder was shown. If that fails it is remembered, so it isn't shown again. */
  private async record(id: string): Promise<void> {
    try {
      await this.store.markFired(id, this.clock.now());
      this.unrecorded.delete(id);
    } catch (error) {
      this.unrecorded.add(id);
      this.logger.error("Couldn't record that a reminder was shown; Sage will retry the record", error);
    }
  }
}
