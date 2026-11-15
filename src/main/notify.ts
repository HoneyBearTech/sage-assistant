import type { Notifier } from "../core/scheduler.js";

/** The parts of Electron's Notification that Sage uses. */
export interface DesktopNotification {
  once(event: "show" | "failed", listener: () => void): unknown;
  show(): void;
}

export interface NotifyParts {
  /** Electron's Notification.isSupported(). */
  isSupported(): boolean;
  /** new Notification({ title, body }). */
  create(title: string, body: string): DesktopNotification;
  /** Puts the reminder in Sage's window; false when there is no window to show it in. */
  postToWindow(title: string, body: string): boolean;
  /** How long to wait for the system to say the notification was shown. */
  timeoutMs?: number;
}

export const NOTIFY_TIMEOUT_MS = 5_000;

/**
 * A desktop notification that reports whether it was shown. If notifications aren't supported,
 * fail, or the system doesn't confirm in time, the reminder goes into Sage's window instead. If
 * there is no window either, it reports false and the scheduler tries again on its next check.
 */
export function createNotifier(parts: NotifyParts): Notifier {
  const timeoutMs = parts.timeoutMs ?? NOTIFY_TIMEOUT_MS;
  return async (title, body) => {
    if (parts.isSupported() && (await showDesktop(parts, title, body, timeoutMs))) return true;
    return parts.postToWindow(title, body);
  };
}

function showDesktop(parts: NotifyParts, title: string, body: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (shown: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(shown);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      const notification = parts.create(title, body);
      notification.once("show", () => finish(true));
      notification.once("failed", () => finish(false));
      notification.show();
    } catch {
      finish(false);
    }
  });
}
