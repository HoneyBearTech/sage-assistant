import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_NOTICE_TEXT, MAX_NOTICES, NoticeBoard } from "../src/core/notices.js";
import { createNotifier, type DesktopNotification, type NotifyParts } from "../src/main/notify.js";

type Behaviour = "show" | "failed" | "silent" | "throw";

function parts(behaviour: Behaviour, options: { supported?: boolean; window?: boolean } = {}) {
  const posted: string[] = [];
  const created: string[] = [];
  const notifyParts: NotifyParts = {
    isSupported: () => options.supported ?? true,
    create: (title, body) => {
      created.push(`${title}: ${body}`);
      const listeners = new Map<string, () => void>();
      const notification: DesktopNotification = {
        once: (event, listener) => listeners.set(event, listener),
        show: () => {
          if (behaviour === "throw") throw new Error("no notification service");
          if (behaviour === "show" || behaviour === "failed")
            setImmediate(() => listeners.get(behaviour)?.());
        },
      };
      return notification;
    },
    postToWindow: (title, body) => {
      if (options.window === false) return false;
      posted.push(`${title}: ${body}`);
      return true;
    },
    timeoutMs: 20,
  };
  return { notifyParts, posted, created };
}

test("a desktop notification that the system shows counts as shown, with no window copy", async () => {
  const { notifyParts, posted, created } = parts("show");
  assert.equal(await createNotifier(notifyParts)("Sage reminder", "Stand up"), true);
  assert.deepEqual(created, ["Sage reminder: Stand up"]);
  assert.deepEqual(posted, []);
});

test("failed, unconfirmed, throwing or unsupported notifications fall back to the window", async () => {
  for (const behaviour of ["failed", "silent", "throw"] as const) {
    const { notifyParts, posted } = parts(behaviour);
    assert.equal(await createNotifier(notifyParts)("Sage reminder", "Stand up"), true, behaviour);
    assert.deepEqual(posted, ["Sage reminder: Stand up"], behaviour);
  }
  const unsupported = parts("show", { supported: false });
  assert.equal(await createNotifier(unsupported.notifyParts)("Sage reminder", "Stand up"), true);
  assert.deepEqual(unsupported.created, [], "no desktop notification is tried");
  assert.deepEqual(unsupported.posted, ["Sage reminder: Stand up"]);
});

test("with no desktop notification and no window, it reports not shown so the scheduler retries", async () => {
  const { notifyParts } = parts("failed", { window: false });
  assert.equal(await createNotifier(notifyParts)("Sage reminder", "Stand up"), false);
});

test("the notice board hands each notice out once and keeps only the newest", () => {
  const board = new NoticeBoard();
  assert.deepEqual(board.take(), []);
  for (let i = 0; i < MAX_NOTICES + 5; i++) board.post(`notice ${i}`);
  board.post("x".repeat(MAX_NOTICE_TEXT + 10));
  const taken = board.take();
  assert.equal(taken.length, MAX_NOTICES);
  assert.equal(taken[0], "notice 6");
  assert.equal(taken.at(-1)!.length, MAX_NOTICE_TEXT);
  assert.deepEqual(board.take(), []);
});
