import assert from "node:assert/strict";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { homeSummary, localDate, localDay, shorten } from "../src/core/home.js";
import type { Note } from "../src/core/notes.js";
import type { Reminder } from "../src/core/reminders.js";
import { createSage } from "../src/core/sage.js";
import { createIpcHandlers } from "../src/main/ipc.js";
import {
  CHANNELS,
  type HomeSummary,
  MAX_HOME_NOTE_TITLE,
  MAX_HOME_NOTES,
  MAX_HOME_REMINDER_TEXT,
  MAX_HOME_REMINDERS,
} from "../src/shared/api.js";
import { FakeClock, FakePresenter, memoryKeyStores, REFUSED_PORT, tempDir } from "./helpers.js";

// Home's read-only summary and the morning brief's once-a-day mark (src/core/home.ts), through
// the window's two requests. All times are on the PC's own clock: dates are made with local times.

/** 16 November 2026 (a Monday), at this local time. */
const on16th = (hour: number, minute = 0) => new Date(2026, 10, 16, hour, minute);

function reminder(id: string, due: Date, firedAt: Date | null = null, text = `Reminder ${id}`): Reminder {
  return {
    id,
    text,
    due: due.toISOString(),
    created: new Date(2026, 10, 1).toISOString(),
    firedAt: firedAt?.toISOString() ?? null,
  };
}

function note(id: string, title: string, updated: Date, text = "secret note text"): Note {
  return { id, title, text, created: updated.toISOString(), updated: updated.toISOString() };
}

const STATUS = { brain: "local", voiceReady: true, sound: false } as const;

test("the PC's own day: from local midnight to the next, and its date as YYYY-MM-DD", () => {
  const { start, end } = localDay(on16th(13, 45));
  assert.deepEqual(start, new Date(2026, 10, 16));
  assert.deepEqual(end, new Date(2026, 10, 17));
  assert.equal(localDate(on16th(0, 0)), "2026-11-16");
  assert.equal(localDate(new Date(2026, 10, 16, 23, 59, 59)), "2026-11-16");
  assert.equal(localDate(new Date(2026, 0, 5)), "2026-01-05");
});

test("shorten keeps whole characters and ends in an ellipsis", () => {
  assert.equal(shorten("  short  ", 10), "short");
  assert.equal(shorten("abcdefghij", 10), "abcdefghij");
  assert.equal(shorten("abcdefghijk", 10), "abcdefghi…");
  assert.equal(Array.from(shorten("🌱".repeat(300), 200)).length, 200);
  assert.ok(shorten("🌱".repeat(300), 200).endsWith("🌱…"), "never half an emoji");
});

test("today's reminders, shown or not, plus missed ones from before, soonest first", () => {
  const now = on16th(12);
  const summary = homeSummary({
    reminders: [
      reminder("later", on16th(18)),
      reminder("shown", on16th(9), on16th(9)),
      reminder("missed-today", on16th(10)),
      reminder("missed-yesterday", new Date(2026, 10, 15, 20)),
      reminder("shown-yesterday", new Date(2026, 10, 15, 8), new Date(2026, 10, 15, 8)),
      reminder("tomorrow", new Date(2026, 10, 17, 9)),
      reminder("midnight", new Date(2026, 10, 17, 0, 0)),
      reminder("last-minute", new Date(2026, 10, 16, 23, 59)),
    ],
    notes: [],
    now,
    ...STATUS,
  });
  assert.deepEqual(
    summary.reminders.map((r) => [r.id, r.missed]),
    [
      ["missed-yesterday", true],
      ["shown", false],
      ["missed-today", true],
      ["later", false],
      ["last-minute", false],
    ],
  );
  // Something is still to come today, so there is no "next" from another day.
  assert.equal(summary.next, null);
  assert.equal(summary.reminders[1]!.due, on16th(9).toISOString());
});

test("with nothing more to come today, the next reminder after today is given", () => {
  const summary = homeSummary({
    reminders: [
      reminder("shown", on16th(9), on16th(9)),
      reminder("far", new Date(2026, 11, 1, 9)),
      reminder("soon", new Date(2026, 10, 19, 10)),
      reminder("shown-later", new Date(2026, 10, 18, 9), on16th(8)),
    ],
    notes: [],
    now: on16th(12),
    ...STATUS,
  });
  assert.deepEqual(
    summary.reminders.map((r) => r.id),
    ["shown"],
  );
  assert.equal(summary.next?.id, "soon");
  assert.equal(summary.next?.missed, false);
  assert.equal(homeSummary({ reminders: [], notes: [], now: on16th(12), ...STATUS }).next, null);
});

test("the limits: at most 10 reminders of 200 characters, 5 note titles of 80, never a note's text", () => {
  const reminders = Array.from({ length: 25 }, (_, i) =>
    reminder(`r${i}`, on16th(13, i), null, `${"x".repeat(400)}${i}`),
  );
  const notes = Array.from({ length: 9 }, (_, i) =>
    note(`n${i}`, `Title ${i} ${"y".repeat(120)}`, new Date(2026, 10, i + 1), `the private text ${i}`),
  );
  const summary = homeSummary({ reminders, notes, now: on16th(12), ...STATUS });
  assert.equal(summary.reminders.length, MAX_HOME_REMINDERS);
  assert.deepEqual(
    summary.reminders.map((r) => r.id),
    reminders.slice(0, 10).map((r) => r.id),
  );
  for (const r of summary.reminders) {
    assert.equal(Array.from(r.text).length, MAX_HOME_REMINDER_TEXT);
    assert.ok(r.text.endsWith("…"));
  }
  assert.equal(summary.notes.length, MAX_HOME_NOTES);
  // The most recently changed first.
  assert.deepEqual(
    summary.notes.map((title) => title.slice(0, 7)),
    ["Title 8", "Title 7", "Title 6", "Title 5", "Title 4"],
  );
  for (const title of summary.notes) assert.equal(Array.from(title).length, MAX_HOME_NOTE_TITLE);
  assert.doesNotMatch(JSON.stringify(summary), /private text/);
  // Only these fields, so nothing else can slip through.
  assert.deepEqual(Object.keys(summary).sort(), ["next", "notes", "reminders", "status"]);
  assert.deepEqual(Object.keys(summary.reminders[0]!).sort(), ["due", "id", "missed", "text"]);
  assert.deepEqual(Object.keys(summary.status).sort(), ["brain", "sound", "voiceReady"]);
});

test("a reminder with an unreadable time is left out; an empty note title shows as Untitled", () => {
  const broken = { ...reminder("bad", on16th(13)), due: "not a time" };
  const summary = homeSummary({
    reminders: [broken, reminder("ok", on16th(13))],
    notes: [note("n", "   ", on16th(8))],
    now: on16th(12),
    ...STATUS,
  });
  assert.deepEqual(
    summary.reminders.map((r) => r.id),
    ["ok"],
  );
  assert.deepEqual(summary.notes, ["Untitled"]);
});

async function sageAt(t: Parameters<typeof tempDir>[0], clock: FakeClock, dir?: string) {
  const dataDir = dir ?? (await tempDir(t));
  const sage = createSage({
    dataDir,
    keyStores: memoryKeyStores(),
    presenter: new FakePresenter(false),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    localPort: REFUSED_PORT,
    clock,
  });
  const handlers = createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null });
  return { sage, handlers, dataDir };
}

/** Every file in Sage's folder with its contents and modification time. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name);
    files[name] = `${(await stat(path)).mtimeMs} ${await readFile(path, "utf8")}`;
  }
  return files;
}

test("the window's Home request reads the stores and changes nothing", async (t) => {
  const clock = new FakeClock(on16th(12));
  const { sage, handlers, dataDir } = await sageAt(t, clock);
  await sage.reminders.add("Dentist", on16th(14, 30));
  await sage.reminders.add("Water the plants", on16th(9));
  await sage.notes.add("Shopping", "milk, eggs");
  await sage.settings.update((current) => ({ ...current, sound: true, brain: "gemini" }));
  const before = await snapshot(dataDir);

  const summary = (await handlers[CHANNELS.homeSummary]({})) as HomeSummary;
  assert.deepEqual(
    summary.reminders.map((r) => [r.text, r.missed]),
    [
      ["Water the plants", true],
      ["Dentist", false],
    ],
  );
  assert.deepEqual(summary.notes, ["Shopping"]);
  assert.deepEqual(summary.status, { brain: "gemini", voiceReady: false, sound: true });
  assert.deepEqual(await snapshot(dataDir), before, "no file was written or touched");
});

test("Home's requests accept an empty object and nothing else", async (t) => {
  const { handlers } = await sageAt(t, new FakeClock(on16th(12)));
  for (const bad of [undefined, null, "x", 1, [], { extra: 1 }, { since: "2026-01-01" }]) {
    await assert.rejects(
      Promise.resolve(handlers[CHANNELS.homeSummary](bad)),
      /couldn't read/,
      JSON.stringify(bad),
    );
    assert.equal(await handlers[CHANNELS.claimMorningBrief](bad), false, JSON.stringify(bad));
  }
});

test("the morning brief is claimed once a day, only while it is on, and the day survives a restart", async (t) => {
  const clock = new FakeClock(on16th(7, 30));
  const { sage, handlers, dataDir } = await sageAt(t, clock);
  const claim = () => handlers[CHANNELS.claimMorningBrief]({});

  // Off (the default): never, and the settings file isn't written.
  assert.equal(await claim(), false);
  await assert.rejects(readFile(join(dataDir, "settings.json"), "utf8"), /ENOENT/);

  const settings = (await handlers[CHANNELS.getSettings](undefined)) as Record<string, unknown>;
  assert.deepEqual(await handlers[CHANNELS.saveSettings]({ ...settings, morningBrief: true }), { ok: true });
  assert.equal(await claim(), true, "the first time today");
  assert.equal(await claim(), false, "not twice the same day");
  clock.set(on16th(23, 59));
  assert.equal(await claim(), false, "still the same day");
  assert.equal((await sage.settings.load()).lastBrief, "2026-11-16");

  // A restart the same day: still remembered.
  const again = await sageAt(t, clock, dataDir);
  assert.equal(await again.handlers[CHANNELS.claimMorningBrief]({}), false);

  // Saving settings keeps the day, even if the window sends another one.
  assert.deepEqual(
    await again.handlers[CHANNELS.saveSettings]({ ...settings, morningBrief: true, lastBrief: null }),
    { ok: true },
  );
  assert.equal((await again.sage.settings.load()).lastBrief, "2026-11-16");
  assert.equal(await again.handlers[CHANNELS.claimMorningBrief]({}), false);

  // Just after midnight, a new day: once more.
  clock.set(new Date(2026, 10, 17, 0, 1));
  assert.equal(await again.handlers[CHANNELS.claimMorningBrief]({}), true);
  assert.equal(await again.handlers[CHANNELS.claimMorningBrief]({}), false);

  // Switched off: never, even on a new day.
  await again.handlers[CHANNELS.saveSettings]({ ...settings, morningBrief: false });
  clock.set(new Date(2026, 10, 18, 8));
  assert.equal(await again.handlers[CHANNELS.claimMorningBrief]({}), false);
});

test("two claims at once on a new day: only one of them gets the brief", async (t) => {
  const clock = new FakeClock(on16th(8));
  const { sage, handlers } = await sageAt(t, clock);
  await sage.settings.update((current) => ({ ...current, morningBrief: true }));
  const answers = await Promise.all([
    handlers[CHANNELS.claimMorningBrief]({}),
    handlers[CHANNELS.claimMorningBrief]({}),
    handlers[CHANNELS.claimMorningBrief]({}),
  ]);
  assert.deepEqual(answers.filter(Boolean).length, 1);
});

test("a settings file with an unreadable brief day still loads; the day counts as never", async (t) => {
  const clock = new FakeClock(on16th(8));
  const dir = await tempDir(t);
  await writeFile(
    join(dir, "settings.json"),
    JSON.stringify({ version: 1, morningBrief: true, lastBrief: "yesterday", theme: "light" }),
  );
  const { sage, handlers } = await sageAt(t, clock, dir);
  const loaded = await sage.settings.load();
  assert.equal(loaded.lastBrief, null);
  assert.equal(loaded.theme, "light", "the rest of the file is kept");
  assert.equal(await handlers[CHANNELS.claimMorningBrief]({}), true);
});
