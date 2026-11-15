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
  /**
   * Asked each time before the notice is handed out. False means it is no longer wanted (for
   * example its reminder was deleted), and it is dropped instead of shown. If the check fails,
   * the notice is shown: better shown than lost.
   */
  stillWanted?: () => Promise<boolean> | boolean;
}

interface Entry {
  id: string;
  key: string;
  text: string;
  handedOut: boolean;
  onDelivered: NoticeOptions["onDelivered"];
  stillWanted: NoticeOptions["stillWanted"];
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
      stillWanted: options.stillWanted,
    });
    return true;
  }

  /**
   * Removes a notice that is no longer wanted (its reminder was deleted). It isn't handed out
   * again, and a late confirmation for it does nothing. Returns true if one was removed.
   */
  withdraw(key: string): boolean {
    this.refused.delete(key);
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.key !== key);
    return this.entries.length < before;
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
    const candidates = [...this.entries];
    const unwanted = new Set<Entry>();
    for (const entry of candidates) {
      if (!entry.stillWanted) continue;
      try {
        if (!(await entry.stillWanted())) unwanted.add(entry);
      } catch {
        // Better shown than lost: a failed check doesn't hide the notice.
      }
    }
    this.entries = this.entries.filter((entry) => !unwanted.has(entry));
    // A notice confirmed or withdrawn during the checks above isn't handed out.
    const current = candidates.filter((entry) => this.entries.includes(entry));
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
   * runs, and it is removed. Ids that are unknown, already confirmed, withdrawn or never handed
   * out are ignored. A reminder deleted after it was handed out isn't recorded: there is nothing
   * left to record it on.
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
