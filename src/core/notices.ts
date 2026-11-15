/** The most notices kept while the window isn't collecting them; older ones are dropped first. */
export const MAX_NOTICES = 50;
/** The longest notice text kept. */
export const MAX_NOTICE_TEXT = 1_000;

/**
 * Messages from Sage itself (a reminder that couldn't be shown as a desktop notification, a data
 * file that had to be set aside) waiting to be shown in the chat window. The window collects them
 * with `take()`; each notice is handed out once.
 */
export class NoticeBoard {
  private notices: string[] = [];

  post(text: string): void {
    this.notices.push(text.slice(0, MAX_NOTICE_TEXT));
    if (this.notices.length > MAX_NOTICES) this.notices.splice(0, this.notices.length - MAX_NOTICES);
  }

  take(): string[] {
    const taken = this.notices;
    this.notices = [];
    return taken;
  }
}
