/** The most notices waiting for the window at once. */
export const MAX_NOTICES = 50;
/** The longest notice text kept. */
export const MAX_NOTICE_TEXT = 1_000;

export interface NoticeOptions {
  /** Identifies the notice (for example one reminder), so it is never queued twice. */
  key?: string;
  /** Called once the window has collected the notice: that is when it counts as delivered. */
  onDelivered?: () => Promise<void> | void;
}

interface Notice {
  key: string;
  text: string;
  onDelivered: (() => Promise<void> | void) | undefined;
}

/**
 * Messages from Sage itself (a reminder that couldn't be shown as a desktop notification, a data
 * file that had to be set aside) waiting to be shown in the chat window. The window collects them
 * with `take()`; each notice is handed out once, and only then counts as delivered.
 *
 * Nothing is dropped silently. When MAX_NOTICES are waiting, the oldest are kept and a new one is
 * refused (`post` returns false); the next `take()` says how many more are waiting. Reminders are
 * the only notices that can reach the cap, and a refused reminder stays due, so the scheduler
 * offers it again on its next check.
 */
export class NoticeBoard {
  private waiting: Notice[] = [];
  /** Keys handed to the window whose delivery callback hasn't finished yet. */
  private readonly delivering = new Set<string>();
  /** Keys refused since the last take, because the board was full. */
  private readonly refused = new Set<string>();
  private nextId = 0;

  /** Queues a notice. Returns false only if it was refused because the board is full. */
  post(text: string, options: NoticeOptions = {}): boolean {
    const key = options.key ?? `notice-${this.nextId++}`;
    if (this.has(key)) return true;
    if (this.waiting.length >= MAX_NOTICES) {
      this.refused.add(key);
      return false;
    }
    this.refused.delete(key);
    this.waiting.push({ key, text: text.slice(0, MAX_NOTICE_TEXT), onDelivered: options.onDelivered });
    return true;
  }

  /** True while a notice with this key waits for the window or is being delivered. */
  has(key: string): boolean {
    return this.delivering.has(key) || this.waiting.some((notice) => notice.key === key);
  }

  /** Hands every waiting notice to the window, then runs their delivery callbacks. */
  async take(): Promise<string[]> {
    const taken = this.waiting;
    this.waiting = [];
    const texts = taken.map((notice) => notice.text);
    if (this.refused.size > 0) {
      const more = this.refused.size;
      texts.push(
        `${more} more ${more === 1 ? "reminder is" : "reminders are"} waiting and will appear here in a moment.`,
      );
      this.refused.clear();
    }
    // Until its callback has finished, a taken notice still counts as present, so the scheduler
    // can't offer the same reminder again in between.
    const pending = taken.filter((notice) => notice.onDelivered);
    for (const notice of pending) this.delivering.add(notice.key);
    for (const notice of pending) {
      try {
        await notice.onDelivered?.();
      } catch {
        // The callback reports its own failures; the window still gets every text.
      } finally {
        this.delivering.delete(notice.key);
      }
    }
    return texts;
  }
}
