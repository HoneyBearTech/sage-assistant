import type { Notice } from "../shared/api.js";

/** The most notices waiting for the window at once (handed out or not, until acknowledged). */
export const MAX_NOTICES = 50;
/** The longest notice text kept. */
export const MAX_NOTICE_TEXT = 1_000;

export interface NoticeOptions {
  /** Identifies the notice (for example one reminder), so it is never queued twice. */
  key?: string;
  /**
   * Called once the window has confirmed the notice is on screen: that is when it counts as
   * delivered. Never called for a notice that was only handed out.
   */
  onDelivered?: () => Promise<void> | void;
}

interface Entry {
  id: string;
  key: string;
  text: string;
  handedOut: boolean;
  onDelivered: NoticeOptions["onDelivered"];
}

/**
 * Messages from Sage itself (a reminder that couldn't be shown as a desktop notification, a data
 * file that had to be set aside) waiting to be shown in the chat window.
 *
 * The window collects them with `take()`, puts them on screen, then confirms with `ack(ids)`.
 * Only the confirmation counts as delivered. A notice that was handed out but not confirmed (the
 * window closed or crashed first) is handed out again on the next `take()`, with the same id, so
 * the window can tell it already shows it. A reminder that never got its confirmation stays due,
 * so after a restart the scheduler offers it again.
 *
 * Nothing is dropped silently. When MAX_NOTICES are waiting, the oldest are kept and a new one is
 * refused (`post` returns false); the next `take()` says how many more are waiting. Reminders are
 * the only notices that can reach the cap, and a refused reminder stays due, so the scheduler
 * offers it again on its next check.
 */
export class NoticeBoard {
  private entries: Entry[] = [];
  /** Keys confirmed by the window whose delivery callback hasn't finished yet. */
  private readonly delivering = new Set<string>();
  /** Keys refused since the last take, because the board was full. */
  private readonly refused = new Set<string>();
  private counter = 0;

  /** Queues a notice. Returns false only if it was refused because the board is full. */
  post(text: string, options: NoticeOptions = {}): boolean {
    const key = options.key ?? `notice-${this.counter++}`;
    if (this.has(key)) return true;
    if (this.entries.length >= MAX_NOTICES) {
      this.refused.add(key);
      return false;
    }
    this.refused.delete(key);
    this.entries.push({
      id: this.newId(),
      key,
      text: text.slice(0, MAX_NOTICE_TEXT),
      handedOut: false,
      onDelivered: options.onDelivered,
    });
    return true;
  }

  /** True while a notice with this key waits for the window or is being delivered. */
  has(key: string): boolean {
    return this.delivering.has(key) || this.entries.some((entry) => entry.key === key);
  }

  /**
   * Hands out every notice the window hasn't confirmed yet, in the order they were posted. Nothing
   * counts as delivered here; see `ack`.
   */
  async take(): Promise<Notice[]> {
    const current = [...this.entries];
    for (const entry of current) entry.handedOut = true;
    const notices: Notice[] = current.map((entry) => ({ id: entry.id, text: entry.text }));
    if (this.refused.size > 0) {
      const more = this.refused.size;
      notices.push({
        id: this.newId(),
        text: `${more} more ${more === 1 ? "reminder is" : "reminders are"} waiting and will appear here in a moment.`,
      });
      this.refused.clear();
    }
    return notices;
  }

  /**
   * The window confirms these notices are on screen. Each one is delivered once: its callback
   * runs, and it is removed. Ids that are unknown, already confirmed or never handed out are
   * ignored.
   */
  async ack(ids: readonly string[]): Promise<void> {
    const wanted = new Set(ids);
    const confirmed = this.entries.filter((entry) => entry.handedOut && wanted.has(entry.id));
    if (confirmed.length === 0) return;
    this.entries = this.entries.filter((entry) => !confirmed.includes(entry));
    // Until its callback has finished, a confirmed notice still counts as present, so the
    // scheduler can't offer the same reminder again in between.
    const pending = confirmed.filter((entry) => entry.onDelivered);
    for (const entry of pending) this.delivering.add(entry.key);
    for (const entry of pending) {
      try {
        await entry.onDelivered?.();
      } catch {
        // The callback reports its own failures.
      } finally {
        this.delivering.delete(entry.key);
      }
    }
  }

  private newId(): string {
    return `n${++this.counter}`;
  }
}
