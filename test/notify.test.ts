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

function parts(behaviour: Behaviour, supported = true) {
  const created: string[] = [];
  const notifyParts: NotifyParts = {
    isSupported: () => supported,
    create: (title, body) => {
      created.push(`${title}: ${body}`);
      const listeners = new Map<string, () => void>();
      const notification: DesktopNotification = {
        once: (event, listener) => listeners.set(event, listener),
        show: () => {
          if (behaviour === "throw") throw new Error("no notification service");
          if (behaviour === "show" || behaviour === "failed") {
            setImmediate(() => listeners.get(behaviour)?.());
          }
        },
      };
      return notification;
    },
  };
  return { notifyParts, created };
}

// The timeout runs on mocked timers: it fires only when a test moves the clock, so how busy the
// machine is can't decide the outcome. The system's "show" and "failed" events still arrive on
// setImmediate, which isn't mocked.
function mockTimeouts(t: TestContext): void {
  t.mock.timers.enable({ apis: ["setTimeout"] });
}

test("a desktop notification counts as shown only when the system confirms it", async (t) => {
  mockTimeouts(t);
  const shown = parts("show");
  assert.equal(await createNotifier(shown.notifyParts)("Sage reminder", "Stand up"), true);
  assert.deepEqual(shown.created, ["Sage reminder: Stand up"]);
  for (const behaviour of ["failed", "throw"] as const) {
    assert.equal(await createNotifier(parts(behaviour).notifyParts)("Sage reminder", "x"), false, behaviour);
  }
  const unsupported = parts("show", false);
  assert.equal(await createNotifier(unsupported.notifyParts)("Sage reminder", "x"), false);
  assert.deepEqual(unsupported.created, [], "no desktop notification is tried");
});

test("a notification the system never confirms counts as not shown after the timeout, not before", async (t) => {
  mockTimeouts(t);
  let settled: boolean | undefined;
  const pending = Promise.resolve(createNotifier(parts("silent").notifyParts)("Sage reminder", "x")).then(
    (shown) => {
      settled = shown;
      return shown;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(NOTIFY_TIMEOUT_MS - 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, undefined, "still waiting just before the timeout");
  t.mock.timers.tick(1);
  assert.equal(await pending, false);
});

test("the notice board hands each notice out once, and it is delivered only then", async () => {
  const board = new NoticeBoard();
  assert.deepEqual(await board.take(), []);
  const delivered: string[] = [];
  assert.equal(
    board.post("Sage reminder: a", { key: "r1", onDelivered: () => void delivered.push("r1") }),
    true,
  );
  assert.equal(board.post("Sage reminder: a again", { key: "r1" }), true, "the same key isn't queued twice");
  board.post("x".repeat(MAX_NOTICE_TEXT + 10));
  assert.equal(board.has("r1"), true);
  assert.deepEqual(delivered, [], "not delivered while it only waits");
  const taken = await board.take();
  assert.deepEqual(taken, ["Sage reminder: a", "x".repeat(MAX_NOTICE_TEXT)]);
  assert.deepEqual(delivered, ["r1"]);
  assert.equal(board.has("r1"), false);
  assert.deepEqual(await board.take(), []);
});

test("a full board keeps the oldest notices, refuses new ones and says how many more wait", async () => {
  const board = new NoticeBoard();
  for (let i = 0; i < MAX_NOTICES; i++) assert.equal(board.post(`notice ${i}`, { key: `k${i}` }), true);
  assert.equal(board.post("late 1", { key: "late1" }), false);
  assert.equal(board.post("late 2", { key: "late2" }), false);
  assert.equal(board.post("late 1", { key: "late1" }), false, "offered again: still counted once");
  const taken = await board.take();
  assert.equal(taken.length, MAX_NOTICES + 1);
  assert.equal(taken[0], "notice 0", "the oldest are kept");
  assert.equal(taken[MAX_NOTICES - 1], `notice ${MAX_NOTICES - 1}`);
  assert.equal(taken.at(-1), "2 more reminders are waiting and will appear here in a moment.");
  assert.equal(board.post("late 1", { key: "late1" }), true, "room again after the window took them");
  board.post("x");
  board.post("y");
  for (let i = 0; i < MAX_NOTICES - 3; i++) board.post(`fill ${i}`);
  assert.equal(board.post("one too many", { key: "extra" }), false);
  assert.equal((await board.take()).at(-1), "1 more reminder is waiting and will appear here in a moment.");
});

test("while a notice's delivery is being recorded it still counts as present", async () => {
  const board = new NoticeBoard();
  let finish!: () => void;
  const recording = new Promise<void>((resolve) => {
    finish = resolve;
  });
  board.post("a", { key: "a", onDelivered: () => recording });
  board.post("b", {
    key: "b",
    onDelivered: () => {
      throw new Error("record failed");
    },
  });
  const taking = board.take();
  assert.equal(board.has("a"), true);
  assert.equal(board.has("b"), true, "a later notice also counts while an earlier one records");
  finish();
  assert.deepEqual(await taking, ["a", "b"], "a failing record doesn't lose the texts");
  assert.equal(board.has("a"), false);
  assert.equal(board.has("b"), false);
});
