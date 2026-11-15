import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { readJson, writeFileAtomic, writeJsonAtomic } from "../src/core/json-file.js";
import { MAX_NOTICES, NoticeBoard } from "../src/core/notices.js";
import { NotesStore } from "../src/core/notes.js";
import { RemindersStore } from "../src/core/reminders.js";
import { ReminderScheduler, systemClock } from "../src/core/scheduler.js";
import { Serial } from "../src/core/serial.js";
import { captureLogs, FakeClock, tempDir } from "./helpers.js";

test("atomic writes replace the file and leave no temporary files behind", async (t) => {
  const dir = await tempDir(t);
  const path = join(dir, "nested", "data.json");
  await writeJsonAtomic(path, { a: 1 });
  await writeJsonAtomic(path, { a: 2 });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { a: 2 });
  assert.deepEqual(await readdir(join(dir, "nested")), ["data.json"]);
  await assert.rejects(writeFileAtomic(join(dir, "nested"), "x"));
  assert.deepEqual(await readdir(join(dir, "nested")), ["data.json"], "a failed write cleans up");
});

test("reading JSON: missing is normal, and a broken file is kept aside rather than lost", async (t) => {
  const dir = await tempDir(t);
  const schema = z.object({ a: z.number() });
  assert.deepEqual(await readJson(join(dir, "none.json"), schema), { status: "missing" });
  await writeFile(join(dir, "ok.json"), '{"a":1}');
  assert.deepEqual(await readJson(join(dir, "ok.json"), schema), { status: "ok", value: { a: 1 } });
  await writeFile(join(dir, "bad.json"), "{oops");
  const bad = await readJson(join(dir, "bad.json"), schema, () => new Date("2026-11-15T10:00:00Z"));
  assert.equal(bad.status, "invalid");
  assert.equal(await readFile(join(dir, "bad.json.invalid-2026-11-15T10-00-00-000Z"), "utf8"), "{oops");
  await writeFile(join(dir, "shape.json"), '{"a":"x"}');
  assert.equal((await readJson(join(dir, "shape.json"), schema)).status, "invalid");
  await assert.rejects(readJson(dir, schema));
});

test("notes are stored as JSON in the data folder and survive a restart", async (t) => {
  const dir = await tempDir(t);
  const { logger } = captureLogs();
  const notes = new NotesStore(dir, logger, () => new Date("2026-11-15T10:00:00Z"));
  const [a, b] = await Promise.all([notes.add("  First  ", "one"), notes.add("", "two")]);
  assert.equal(a.title, "First");
  assert.equal(b.title, "Untitled");
  const again = new NotesStore(dir, logger);
  assert.deepEqual((await again.list()).map((n) => n.text).sort(), ["one", "two"]);
  assert.equal(await again.remove(a.id), true);
  assert.equal(await again.remove(a.id), false);
  assert.equal((await again.get(b.id))?.text, "two");
  const file = JSON.parse(await readFile(join(dir, "notes.json"), "utf8"));
  assert.equal(file.version, 1);
  assert.equal(file.notes.length, 1);
});

test("a corrupt notes file is set aside with a warning", async (t) => {
  const dir = await tempDir(t);
  const { logger, lines } = captureLogs();
  await writeFile(join(dir, "notes.json"), "garbage");
  assert.deepEqual(await new NotesStore(dir, logger).list(), []);
  assert.ok(lines.some((line) => line.includes("notes.json couldn't be read")));
  await writeFile(join(dir, "reminders.json"), "garbage");
  assert.deepEqual(await new RemindersStore(dir, logger).list(), []);
  assert.ok(lines.some((line) => line.includes("reminders.json couldn't be read")));
});

test("the scheduler fires each due reminder once, using the injected clock", async (t) => {
  const dir = await tempDir(t);
  const { logger } = captureLogs();
  const clock = new FakeClock(new Date("2026-11-15T08:00:00Z"));
  const reminders = new RemindersStore(dir, logger, () => clock.now());
  const shown: string[] = [];
  const show = (_title: string, body: string) => {
    shown.push(body);
    return true;
  };
  const scheduler = new ReminderScheduler(reminders, show, clock, logger);

  await reminders.add("Stand up", new Date("2026-11-15T09:00:00Z"));
  await reminders.add("Lunch", new Date("2026-11-15T12:00:00Z"));
  assert.equal(await scheduler.tick(), 0);

  clock.set(new Date("2026-11-15T09:00:00Z"));
  assert.equal(await scheduler.tick(), 1);
  assert.deepEqual(shown, ["Stand up"]);
  assert.equal(await scheduler.tick(), 0, "never twice");

  clock.set(new Date("2026-11-15T15:00:00Z"));
  const restarted = new ReminderScheduler(
    new RemindersStore(dir, logger, () => clock.now()),
    show,
    clock,
    logger,
  );
  assert.equal(await restarted.tick(), 1, "a reminder missed while closed fires on the next check");
  assert.deepEqual(shown, ["Stand up", "Lunch"]);
  const stored = await reminders.list();
  assert.ok(stored.every((r) => r.firedAt !== null));
});

test("start and stop use the clock's timer; failures are logged, not thrown", async (t) => {
  const dir = await tempDir(t);
  const { logger, lines } = captureLogs();
  const clock = new FakeClock(new Date("2026-11-15T08:00:00Z"));
  const reminders = new RemindersStore(dir, logger, () => clock.now());
  await reminders.add("Ping", new Date("2026-11-15T08:00:30Z"));
  const scheduler = new ReminderScheduler(
    reminders,
    () => {
      throw new Error("no notification service");
    },
    clock,
    logger,
  );
  scheduler.start(1000);
  scheduler.start(1000);
  assert.equal(clock.scheduled, true);
  clock.advance(60_000);
  clock.fire();
  // Checks run one at a time, so this one finishes only after the timer's check has (no sleeping).
  await scheduler.tick();
  assert.ok(lines.some((line) => line.includes("Couldn't show a reminder notification")));
  scheduler.stop();
  scheduler.stop();
  assert.equal(clock.scheduled, false);
  assert.equal(
    (await reminders.list())[0]!.firedAt,
    null,
    "a failed notification doesn't use up the reminder",
  );

  const broken = new ReminderScheduler(
    { due: async () => Promise.reject(new Error("disk gone")) } as unknown as RemindersStore,
    () => true,
    clock,
    logger,
  );
  assert.equal(await broken.tick(), 0);
  assert.ok(lines.some((line) => line.includes("Couldn't check reminders")));
});

test("a reminder that couldn't be shown is tried again on the next check, and then only once", async (t) => {
  const dir = await tempDir(t);
  const { logger, lines } = captureLogs();
  const clock = new FakeClock(new Date("2026-11-15T09:00:00Z"));
  const reminders = new RemindersStore(dir, logger, () => clock.now());
  await reminders.add("Second", new Date("2026-11-15T08:30:00Z"));
  await reminders.add("First", new Date("2026-11-15T08:00:00Z"));
  const outcomes: Array<boolean | Error> = [false, new Error("service gone"), true, true];
  const shown: string[] = [];
  const scheduler = new ReminderScheduler(
    reminders,
    async (_title, body) => {
      const outcome = outcomes.shift();
      if (outcome instanceof Error) throw outcome;
      if (outcome) shown.push(body);
      return outcome ?? false;
    },
    clock,
    logger,
  );
  assert.equal(await scheduler.tick(), 0, "the first check fails for both");
  assert.ok(lines.some((line) => line.includes("try again on the next check")));
  assert.ok((await reminders.list()).every((r) => r.firedAt === null));
  clock.advance(15_000);
  assert.equal(await scheduler.tick(), 2);
  assert.deepEqual(shown, ["First", "Second"], "oldest first");
  assert.equal(await scheduler.tick(), 0, "never twice");
  assert.equal(await reminders.markFired("nope", clock.now()), false);
  const first = (await reminders.list()).find((r) => r.text === "First")!;
  assert.equal(first.firedAt, "2026-11-15T09:00:15.000Z");
  assert.equal(await reminders.markFired(first.id, clock.now()), false, "already marked");
});

test("a reminder the desktop can't show waits in the window and counts as shown only once confirmed", async (t) => {
  const dir = await tempDir(t);
  const { logger } = captureLogs();
  const clock = new FakeClock(new Date("2026-11-15T09:00:00Z"));
  const reminders = new RemindersStore(dir, logger, () => clock.now());
  const board = new NoticeBoard();
  let desktopTries = 0;
  const noDesktop = () => {
    desktopTries++;
    return false;
  };
  const scheduler = new ReminderScheduler(reminders, noDesktop, clock, logger, board);
  const stretch = await reminders.add("Stretch", new Date("2026-11-15T08:59:00Z"));

  assert.equal(await scheduler.tick(), 0);
  assert.equal(desktopTries, 1);
  assert.equal((await reminders.get(stretch.id))!.firedAt, null, "queued for the window isn't shown yet");
  clock.advance(15_000);
  await scheduler.tick();
  assert.equal(desktopTries, 1, "while it waits in the window it isn't offered again");

  // Sage closes before the window collects it: after a restart the reminder comes back.
  const restartedBoard = new NoticeBoard();
  const restarted = new ReminderScheduler(
    new RemindersStore(dir, logger, () => clock.now()),
    noDesktop,
    clock,
    logger,
    restartedBoard,
  );
  await restarted.tick();
  assert.equal(desktopTries, 2);
  const taken = await restartedBoard.take();
  assert.deepEqual(
    taken.map((n) => n.text),
    ["Sage reminder: Stretch"],
  );
  assert.equal((await reminders.get(stretch.id))!.firedAt, null, "collected but not confirmed yet");
  await restartedBoard.ack(taken.map((n) => n.id));
  assert.equal((await reminders.get(stretch.id))!.firedAt, "2026-11-15T09:00:15.000Z");
  await restarted.tick();
  assert.equal(desktopTries, 2, "confirmed once, never offered again");
});

test("the window collects a reminder and crashes before confirming it: it comes back after a restart", async (t) => {
  const dir = await tempDir(t);
  const { logger } = captureLogs();
  const clock = new FakeClock(new Date("2026-11-15T09:00:00Z"));
  const board = new NoticeBoard();
  const scheduler = new ReminderScheduler(
    new RemindersStore(dir, logger, () => clock.now()),
    () => false,
    clock,
    logger,
    board,
  );
  const reminders = new RemindersStore(dir, logger, () => clock.now());
  const call = await reminders.add("Call the dentist", new Date("2026-11-15T08:59:00Z"));
  await scheduler.tick();
  assert.deepEqual(
    (await board.take()).map((n) => n.text),
    ["Sage reminder: Call the dentist"],
  );
  // The window crashes here, before it confirms. Nothing was recorded as shown.
  assert.equal((await reminders.get(call.id))!.firedAt, null);

  // Sage starts again: a new board and scheduler, the same data folder.
  clock.advance(60_000);
  const freshBoard = new NoticeBoard();
  const fresh = new ReminderScheduler(
    new RemindersStore(dir, logger, () => clock.now()),
    () => false,
    clock,
    logger,
    freshBoard,
  );
  await fresh.tick();
  const again = await freshBoard.take();
  assert.deepEqual(
    again.map((n) => n.text),
    ["Sage reminder: Call the dentist"],
    "the reminder comes back",
  );
  await freshBoard.ack(again.map((n) => n.id));
  assert.equal((await reminders.get(call.id))!.firedAt, "2026-11-15T09:01:00.000Z");
  await fresh.tick();
  assert.deepEqual(await freshBoard.take(), [], "and only once");
});

test("a confirmation that arrives while a check runs doesn't show the reminder twice", async (t) => {
  const dir = await tempDir(t);
  const { logger } = captureLogs();
  const clock = new FakeClock(new Date("2026-11-15T09:00:00Z"));
  const reminders = new RemindersStore(dir, logger, () => clock.now());
  const board = new NoticeBoard();
  let desktopTries = 0;
  let release!: () => void;
  let blockNext = false;
  let slowStarted!: () => void;
  const slow = new Promise<void>((resolve) => {
    slowStarted = resolve;
  });
  const scheduler = new ReminderScheduler(
    reminders,
    () => {
      desktopTries++;
      if (!blockNext) return false;
      blockNext = false;
      slowStarted();
      // This notification is slow, so the check is still running.
      return new Promise<boolean>((resolve) => {
        release = () => resolve(false);
      });
    },
    clock,
    logger,
    board,
  );
  // Records are watched, so the test can let one finish if it starts (no sleeping).
  let recordStarted = false;
  let recordFinished: Promise<boolean> = Promise.resolve(false);
  const markFired = reminders.markFired.bind(reminders);
  reminders.markFired = (id, at) => {
    recordStarted = true;
    recordFinished = markFired(id, at);
    return recordFinished;
  };
  await reminders.add("A", new Date("2026-11-15T08:30:00Z"));
  await scheduler.tick();
  const taken = await board.take();
  // B is older, so the next check offers B before A, and B's notification is slow.
  await reminders.add("B", new Date("2026-11-15T08:00:00Z"));
  blockNext = true;
  const checking = scheduler.tick();
  await slow;
  // A is confirmed while that check, which has already read A as due, waits on B.
  const acking = board.ack(taken.map((n) => n.id));
  await new Promise((resolve) => setImmediate(resolve));
  if (recordStarted) await recordFinished;
  release();
  await checking;
  await acking;
  assert.equal(desktopTries, 2, "A was offered once; the second check offered only B");
  assert.notEqual((await reminders.list()).find((r) => r.text === "A")!.firedAt, null);
});

test("more due reminders than the window holds: none is lost, and the window is told how many wait", async (t) => {
  const dir = await tempDir(t);
  const { logger } = captureLogs();
  const clock = new FakeClock(new Date("2026-11-15T09:00:00Z"));
  const reminders = new RemindersStore(dir, logger, () => clock.now());
  const board = new NoticeBoard();
  const scheduler = new ReminderScheduler(reminders, () => false, clock, logger, board);
  for (let i = 0; i < MAX_NOTICES + 2; i++) {
    await reminders.add(`R${i}`, new Date(Date.parse("2026-11-15T08:00:00Z") + i * 1000));
  }
  await scheduler.tick();
  const first = await board.take();
  assert.equal(first.length, MAX_NOTICES + 1);
  assert.equal(first[0]!.text, "Sage reminder: R0", "the oldest are kept");
  assert.equal(first.at(-1)!.text, "2 more reminders are waiting and will appear here in a moment.");
  await board.ack(first.map((n) => n.id));
  await scheduler.tick();
  const second = await board.take();
  assert.deepEqual(
    second.map((n) => n.text),
    [`Sage reminder: R${MAX_NOTICES}`, `Sage reminder: R${MAX_NOTICES + 1}`],
  );
  await board.ack(second.map((n) => n.id));
  assert.ok((await reminders.list()).every((r) => r.firedAt !== null));
});

test("one reminder failing doesn't stop the others, and a shown one isn't shown again", async (t) => {
  const dir = await tempDir(t);
  const { logger, lines } = captureLogs();
  const clock = new FakeClock(new Date("2026-11-15T09:00:00Z"));
  const reminders = new RemindersStore(dir, logger, () => clock.now());
  const a = await reminders.add("A", new Date("2026-11-15T08:00:00Z"));
  await reminders.add("B", new Date("2026-11-15T08:01:00Z"));
  // Recording reminder A fails twice (a locked file, say), then works.
  let failures = 2;
  const markFired = reminders.markFired.bind(reminders);
  reminders.markFired = async (id, at) => {
    if (id === a.id && failures-- > 0) throw new Error("file locked");
    return markFired(id, at);
  };
  const shown: string[] = [];
  const scheduler = new ReminderScheduler(
    reminders,
    (_title, body) => {
      shown.push(body);
      return true;
    },
    clock,
    logger,
  );
  assert.equal(await scheduler.tick(), 2, "B is still shown in the same check");
  assert.ok(lines.some((line) => line.includes("Couldn't record that a reminder was shown")));
  assert.equal((await reminders.get(a.id))!.firedAt, null);
  await scheduler.tick();
  await scheduler.tick();
  assert.deepEqual(shown, ["A", "B"], "A is shown once, however often its record is retried");
  assert.notEqual((await reminders.get(a.id))!.firedAt, null, "the record succeeds on a later check");

  // A crashing notification for one reminder doesn't stop the next one either.
  const c = await reminders.add("C", new Date("2026-11-15T08:02:00Z"));
  const d = await reminders.add("D", new Date("2026-11-15T08:03:00Z"));
  const failing = new ReminderScheduler(
    reminders,
    (_title, body) => {
      if (body === "C") throw new Error("notification crashed");
      return true;
    },
    clock,
    logger,
  );
  assert.equal(await failing.tick(), 1);
  assert.equal((await reminders.get(c.id))!.firedAt, null);
  assert.notEqual((await reminders.get(d.id))!.firedAt, null);
});

test("the system clock and the serial queue behave", async () => {
  const before = Date.now();
  const now = systemClock.now().getTime();
  assert.ok(now >= before && now <= Date.now());
  const handle = systemClock.setInterval(() => {}, 10_000);
  systemClock.clearInterval(handle);
  const serial = new Serial();
  const order: number[] = [];
  // The first task waits until the others are queued, so they are queued while it is still running.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = Promise.all([
    serial.run(async () => {
      await gate;
      order.push(1);
    }),
    serial
      .run(async () => {
        order.push(2);
        throw new Error("x");
      })
      .catch(() => undefined),
    serial.run(async () => order.push(3)),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, [], "nothing runs past the first task while it is still going");
  release();
  await queued;
  assert.deepEqual(order, [1, 2, 3]);
});
