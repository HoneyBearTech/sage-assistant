import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { readJson, writeFileAtomic, writeJsonAtomic } from "../src/core/json-file.js";
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
  const scheduler = new ReminderScheduler(reminders, (_title, body) => shown.push(body), clock, logger);

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
    (_title, body) => shown.push(body),
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
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(lines.some((line) => line.includes("Couldn't show a reminder notification")));
  scheduler.stop();
  scheduler.stop();
  assert.equal(clock.scheduled, false);

  const broken = new ReminderScheduler(
    { takeDue: async () => Promise.reject(new Error("disk gone")) } as unknown as RemindersStore,
    () => {},
    clock,
    logger,
  );
  assert.equal(await broken.tick(), 0);
  assert.ok(lines.some((line) => line.includes("Couldn't check reminders")));
});

test("the system clock and the serial queue behave", async () => {
  assert.ok(Math.abs(systemClock.now().getTime() - Date.now()) < 1000);
  const handle = systemClock.setInterval(() => {}, 10_000);
  systemClock.clearInterval(handle);
  const serial = new Serial();
  const order: number[] = [];
  await Promise.all([
    serial.run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
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
  assert.deepEqual(order, [1, 2, 3]);
});
