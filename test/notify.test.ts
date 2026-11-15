import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { MAX_NOTICE_TEXT, MAX_NOTICES, NoticeBoard } from "../src/core/notices.js";
import {
  createNotifier,
  type DesktopNotification,
  NOTIFY_TIMEOUT_MS,
  type NotifyParts,
} from "../src/main/notify.js";

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
  };
  return { notifyParts, posted, created };
}

// The timeout runs on mocked timers: it fires only when a test moves the clock, so how busy the
// machine is can't decide the outcome. The system's "show" and "failed" events still arrive on
// setImmediate, which isn't mocked.
function mockTimeouts(t: TestContext): void {
  t.mock.timers.enable({ apis: ["setTimeout"] });
}

test("a desktop notification that the system shows counts as shown, with no window copy", async (t) => {
  mockTimeouts(t);
  const { notifyParts, posted, created } = parts("show");
  assert.equal(await createNotifier(notifyParts)("Sage reminder", "Stand up"), true);
  assert.deepEqual(created, ["Sage reminder: Stand up"]);
  assert.deepEqual(posted, []);
});

test("failed, throwing or unsupported notifications fall back to the window", async (t) => {
  mockTimeouts(t);
  for (const behaviour of ["failed", "throw"] as const) {
    const { notifyParts, posted } = parts(behaviour);
    assert.equal(await createNotifier(notifyParts)("Sage reminder", "Stand up"), true, behaviour);
    assert.deepEqual(posted, ["Sage reminder: Stand up"], behaviour);
  }
  const unsupported = parts("show", { supported: false });
  assert.equal(await createNotifier(unsupported.notifyParts)("Sage reminder", "Stand up"), true);
  assert.deepEqual(unsupported.created, [], "no desktop notification is tried");
  assert.deepEqual(unsupported.posted, ["Sage reminder: Stand up"]);
});

test("a notification the system never confirms goes to the window after the timeout, not before", async (t) => {
  mockTimeouts(t);
  const { notifyParts, posted } = parts("silent");
  let settled: boolean | undefined;
  const pending = Promise.resolve(createNotifier(notifyParts)("Sage reminder", "Stand up")).then((shown) => {
    settled = shown;
    return shown;
  });
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(NOTIFY_TIMEOUT_MS - 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, undefined, "still waiting just before the timeout");
  assert.deepEqual(posted, []);
  t.mock.timers.tick(1);
  assert.equal(await pending, true);
  assert.deepEqual(posted, ["Sage reminder: Stand up"]);
});

test("with no desktop notification and no window, it reports not shown so the scheduler retries", async (t) => {
  mockTimeouts(t);
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
