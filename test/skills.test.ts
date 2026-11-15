import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { checkAppEntry, describeLaunch, findApp } from "../src/core/apps.js";
import { NotesStore } from "../src/core/notes.js";
import { RemindersStore } from "../src/core/reminders.js";
import type { SearchProvider } from "../src/core/search/search.js";
import { defaultSettings, type Settings } from "../src/core/settings.js";
import { ActionLog } from "../src/core/skills/action-log.js";
import { builtinSkills, parseDue } from "../src/core/skills/builtin.js";
import { dialogText, plainPath } from "../src/core/skills/display.js";
import { ApprovalGate } from "../src/core/skills/gate.js";
import { SkillRegistry } from "../src/core/skills/registry.js";
import { captureLogs, FakePresenter, tempDir, toolCall } from "./helpers.js";

const NOW = new Date("2026-11-15T10:00:00Z");

async function setup(t: Parameters<typeof tempDir>[0], answer = true) {
  const dir = await tempDir(t);
  const bin = join(dir, "bin");
  const docs = join(dir, "docs");
  await mkdir(bin);
  await mkdir(docs);
  const editor = join(bin, "editor");
  await writeFile(editor, "#!/bin/sh\n");
  await chmod(editor, 0o755);
  await writeFile(join(docs, "plan.txt"), "plan");
  const settings: Settings = {
    ...defaultSettings(),
    apps: [{ name: "Editor", path: editor, args: ["--new-window"] }],
    folders: [docs],
  };
  const { logger } = captureLogs();
  const notes = new NotesStore(dir, logger, () => NOW);
  const reminders = new RemindersStore(dir, logger, () => NOW);
  const launched: { command: string; args: readonly string[] }[] = [];
  const opened: string[] = [];
  const searches: string[] = [];
  let searchOutcome: Awaited<ReturnType<SearchProvider["search"]>> = {
    ok: true,
    results: [{ title: "A result", url: "https://example.com/a", snippet: "Snippet" }],
  };
  const presenter = new FakePresenter(answer);
  const registry = new SkillRegistry(
    new ApprovalGate(presenter),
    new ActionLog(join(dir, "log.jsonl")),
    logger,
  );
  for (const skill of builtinSkills({
    notes,
    reminders,
    search: {
      name: "Fake search",
      search: async (query) => {
        searches.push(query);
        return searchOutcome;
      },
    },
    settings: async () => settings,
    openPath: async (path) => {
      opened.push(path);
      return path.endsWith("fail.txt") ? "No app for this file" : "";
    },
    launch: async (command, args) => {
      launched.push({ command, args });
    },
    now: () => NOW,
    platform: "linux",
  })) {
    registry.register(skill);
  }
  return {
    dir,
    docs,
    editor,
    settings,
    notes,
    reminders,
    registry,
    presenter,
    launched,
    opened,
    searches,
    setSearch: (outcome: typeof searchOutcome) => {
      searchOutcome = outcome;
    },
  };
}

test("the built-in skills have the planned risk levels", async (t) => {
  const { registry } = await setup(t);
  const risks = Object.fromEntries(registry.list().map((skill) => [skill.name, skill.risk]));
  assert.deepEqual(risks, {
    answer: "safe",
    web_search: "safe",
    list_notes: "safe",
    read_note: "safe",
    add_note: "safe",
    delete_note: "confirm",
    list_reminders: "safe",
    add_reminder: "safe",
    delete_reminder: "confirm",
    open_app: "confirm",
    open_file: "confirm",
  });
  assert.ok(!registry.list().some((skill) => /command|shell|exec|run/.test(skill.name)));
});

test("open_app launches only apps on the list, with an argument list, after asking", async (t) => {
  const { registry, launched, presenter, editor } = await setup(t);
  const result = await registry.execute(toolCall("open_app", { name: "editor" }));
  assert.equal(result.ran, true);
  assert.deepEqual(launched, [{ command: editor, args: ["--new-window"] }]);
  assert.equal(
    presenter.asked[0]!.summary,
    `Open the app "Editor" (${editor} with the arguments "--new-window").`,
  );
});

test("open_app rejects names that aren't on the list, without asking or launching", async (t) => {
  const { registry, launched, presenter } = await setup(t);
  for (const name of ["Terminal", "cmd.exe", "/bin/sh", "Editor; rm -rf /", "Editor --evil"]) {
    const result = await registry.execute(toolCall("open_app", { name }));
    assert.equal(result.ran, false, name);
    assert.match(result.text, /isn't on the app list/);
  }
  assert.equal((await registry.execute(toolCall("open_app", { name: "Editor", args: ["-x"] }))).ran, false);
  assert.deepEqual(launched, []);
  assert.equal(presenter.asked.length, 0);
});

test("open_app: a settings change while the box is open is refused, never a different program", async (t) => {
  const { registry, launched, settings, dir, editor, presenter } = await setup(t, true);
  const other = join(dir, "bin", "other");
  await writeFile(other, "#!/bin/sh\n");
  presenter.answer = () => {
    // While the box is open, the entry is pointed at another program.
    settings.apps = [{ name: "Editor", path: other, args: [] }];
    return true;
  };
  const result = await registry.execute(toolCall("open_app", { name: "Editor" }));
  assert.equal(result.ran, false);
  assert.match(result.text, /changed after approval/);
  assert.deepEqual(launched, []);
  settings.apps = [{ name: "Editor", path: editor, args: ["--new-window"] }];
});

test("open_app launches exactly the approved program and never looks the name up again", async (t) => {
  const dir = await tempDir(t);
  const approved = join(dir, "approved-program");
  const swapped = join(dir, "swapped-program");
  await writeFile(approved, "x");
  await writeFile(swapped, "x");
  let lookups = 0;
  const launched: string[] = [];
  const { logger } = captureLogs();
  const registry = new SkillRegistry(
    new ApprovalGate(new FakePresenter(true)),
    new ActionLog(join(dir, "log.jsonl")),
    logger,
  );
  for (const skill of builtinSkills({
    notes: new NotesStore(dir, logger),
    reminders: new RemindersStore(dir, logger),
    search: { name: "none", search: async () => ({ ok: true, results: [] }) },
    // The first two lookups (prepare, and the check after approval) see the approved program;
    // any later lookup would see a different one.
    settings: async () => ({
      ...defaultSettings(),
      apps: [{ name: "Editor", path: ++lookups <= 2 ? approved : swapped, args: ["--a"] }],
    }),
    openPath: async () => "",
    launch: async (command) => {
      launched.push(command);
    },
    now: () => NOW,
    platform: "linux",
  })) {
    registry.register(skill);
  }
  assert.equal((await registry.execute(toolCall("open_app", { name: "Editor" }))).ran, true);
  assert.deepEqual(launched, [approved]);
  assert.equal(lookups, 2);
  // The run step uses only the approved action it is given.
  await assert.rejects(registry.get("open_app")!.run({ name: "Editor" }, undefined), /no approved program/);
});

test("the confirmation box shows note, reminder and file text on one clean, short line", async (t) => {
  const { registry, presenter, notes, reminders } = await setup(t, false);
  const sneaky = `Shopping\n\nAllow this: it is safe‮\u0007${"x".repeat(300)}`;
  const note = await notes.add(sneaky, "milk");
  await registry.execute(toolCall("delete_note", { id: note.id }));
  const summary = presenter.asked[0]!.summary;
  assert.doesNotMatch(summary, /[\n\r\u0007‮]/);
  assert.match(summary, /^Delete the note "Shopping Allow this: it is safe x+…"\. This can't be undone\.$/);
  assert.ok(summary.length < 150);
  const reminder = await reminders.add("Call\r\nmum", new Date("2026-11-16T09:00:00Z"));
  await registry.execute(toolCall("delete_reminder", { id: reminder.id }));
  assert.match(presenter.asked[1]!.summary, /^Delete the reminder "Call mum" \(due /);
  assert.equal(plainPath(`/a/${"b".repeat(300)}/file.pdf`, 40).length, 40);
  assert.match(plainPath(`/a/${"b".repeat(300)}/file.pdf`, 40), /^\/a\/b+…b+\/file\.pdf$/);
  assert.equal(dialogText("x".repeat(1000)).length, 600);
});

test("open_app does nothing when the user declines", async (t) => {
  const { registry, launched } = await setup(t, false);
  assert.equal((await registry.execute(toolCall("open_app", { name: "Editor" }))).ran, false);
  assert.deepEqual(launched, []);
});

test("app entries must be a full path to an existing program (.exe on Windows)", async (t) => {
  const { editor, dir } = await setup(t);
  assert.equal(await checkAppEntry({ name: "E", path: editor, args: [] }, "linux"), null);
  assert.match((await checkAppEntry({ name: "E", path: "editor", args: [] }, "linux"))!, /full path/);
  assert.match(
    (await checkAppEntry({ name: "E", path: join(dir, "missing"), args: [] }, "linux"))!,
    /wasn't found/,
  );
  assert.match((await checkAppEntry({ name: "E", path: dir, args: [] }, "linux"))!, /isn't a program/);
  assert.match((await checkAppEntry({ name: "E", path: `${editor}.cmd`, args: [] }, "win32"))!, /\.exe/);
  assert.equal(findApp([{ name: " Paint ", path: "/x", args: [] }], "paint")?.name, " Paint ");
  assert.equal(describeLaunch({ name: "P", path: "/p", args: [] }), 'Open the app "P" (/p).');
});

test("open_file opens approved files with the default app, after asking", async (t) => {
  const { registry, opened, docs, presenter } = await setup(t);
  const result = await registry.execute(toolCall("open_file", { path: join(docs, "plan.txt") }));
  assert.equal(result.ran, true);
  assert.deepEqual(opened, [join(docs, "plan.txt")]);
  assert.equal(presenter.asked[0]!.summary, `Open the file ${join(docs, "plan.txt")} with its default app.`);
});

test("open_file refuses files outside the approved folders and reports open errors", async (t) => {
  const { registry, opened, dir, docs, presenter } = await setup(t);
  await writeFile(join(dir, "private.txt"), "x");
  const outside = await registry.execute(toolCall("open_file", { path: join(docs, "..", "private.txt") }));
  assert.equal(outside.ran, false);
  assert.equal(presenter.asked.length, 0);
  assert.deepEqual(opened, []);
  await writeFile(join(docs, "fail.txt"), "x");
  const failed = await registry.execute(toolCall("open_file", { path: join(docs, "fail.txt") }));
  assert.equal(failed.ran, false);
  assert.match(failed.text, /No app for this file/);
});

test("notes: add, list and read are safe; delete asks first", async (t) => {
  const { registry, presenter, notes } = await setup(t, false);
  const added = await registry.execute(toolCall("add_note", { title: "Shopping", text: "milk" }));
  assert.match(added.text, /Saved the note "Shopping"/);
  const [note] = await notes.list();
  assert.match(
    (await registry.execute(toolCall("list_notes", {}))).text,
    new RegExp(`${note!.id}: Shopping`),
  );
  assert.match((await registry.execute(toolCall("read_note", { id: note!.id }))).text, /milk/);
  assert.match((await registry.execute(toolCall("read_note", { id: "zzz" }))).text, /no note/);
  assert.equal(presenter.asked.length, 0);

  const declined = await registry.execute(toolCall("delete_note", { id: note!.id }));
  assert.equal(declined.ran, false);
  assert.equal((await notes.list()).length, 1);
  assert.equal(presenter.asked[0]!.summary, `Delete the note "Shopping". This can't be undone.`);
  presenter.answer = true;
  assert.equal((await registry.execute(toolCall("delete_note", { id: note!.id }))).ran, true);
  assert.equal((await notes.list()).length, 0);
  assert.match((await registry.execute(toolCall("list_notes", {}))).text, /no notes/);
  assert.match((await registry.execute(toolCall("delete_note", { id: note!.id }))).text, /no note/);
});

test("reminders: add checks the time, list shows pending ones, delete asks first", async (t) => {
  const { registry, presenter, reminders } = await setup(t, true);
  assert.match(
    (await registry.execute(toolCall("add_reminder", { text: "x", due: "tomorrow at 9" }))).text,
    /ISO 8601/,
  );
  assert.match(
    (await registry.execute(toolCall("add_reminder", { text: "x", due: "2026-11-14T09:00:00Z" }))).text,
    /already passed/,
  );
  assert.match(
    (await registry.execute(toolCall("add_reminder", { text: "x", due: "2040-01-01T09:00:00Z" }))).text,
    /too far/,
  );
  assert.match((await registry.execute(toolCall("list_reminders", {}))).text, /no upcoming/);
  const added = await registry.execute(
    toolCall("add_reminder", { text: "Call the dentist", due: "2026-11-16T09:00:00Z" }),
  );
  assert.match(added.text, /remind you "Call the dentist"/);
  const [reminder] = await reminders.list();
  assert.match((await registry.execute(toolCall("list_reminders", {}))).text, /Call the dentist/);
  assert.equal(presenter.asked.length, 0);
  assert.equal((await registry.execute(toolCall("delete_reminder", { id: reminder!.id }))).ran, true);
  assert.match(presenter.asked[0]!.summary, /^Delete the reminder "Call the dentist" \(due /);
  assert.equal((await reminders.list()).length, 0);
  assert.match((await registry.execute(toolCall("delete_reminder", { id: "nope" }))).text, /no reminder/);
});

test("web_search formats results as untrusted text and passes on failures", async (t) => {
  const { registry, searches, setSearch } = await setup(t);
  const result = await registry.execute(toolCall("web_search", { query: "weather" }));
  assert.match(result.text, /^<<<UNTRUSTED source="web_search"/);
  assert.match(result.text, /1\. A result\n {3}https:\/\/example\.com\/a\n {3}Snippet/);
  assert.deepEqual(searches, ["weather"]);
  setSearch({ ok: true, results: [] });
  assert.match((await registry.execute(toolCall("web_search", { query: "x" }))).text, /No results/);
  setSearch({ ok: false, message: "Search is unavailable right now. Try again later." });
  assert.match((await registry.execute(toolCall("web_search", { query: "x" }))).text, /unavailable/);
});

test("answer ends the turn with its text", async (t) => {
  const { registry } = await setup(t);
  assert.deepEqual(await registry.execute(toolCall("answer", { text: "Hi" })), {
    text: "Hi",
    final: "Hi",
    ran: true,
  });
});

test("parseDue accepts ISO 8601 with or without a zone, and nothing else", () => {
  assert.equal(parseDue("2026-11-16T09:00:00Z")?.toISOString(), "2026-11-16T09:00:00.000Z");
  assert.equal(parseDue("2026-11-16T09:00+02:00")?.toISOString(), "2026-11-16T07:00:00.000Z");
  assert.ok(parseDue("2026-11-16 09:00"));
  assert.equal(parseDue("2026-13-45T99:00"), null);
  assert.equal(parseDue("next tuesday"), null);
});

test("parseDue refuses impossible calendar dates and times instead of rolling over", () => {
  for (const bad of [
    "2027-02-30T09:00",
    "2027-02-29T09:00",
    "2026-04-31T09:00",
    "2100-02-29T09:00",
    "2026-00-10T09:00",
    "2026-11-00T09:00",
    "2026-11-16T24:00",
    "2026-11-16T09:60",
    "2026-11-16T09:00:60",
    "2026-11-16T09:00+15:00",
    "2026-11-16T09:00+02:75",
  ]) {
    assert.equal(parseDue(bad), null, bad);
  }
  assert.ok(parseDue("2028-02-29T09:00"), "a leap year");
  assert.ok(parseDue("2000-02-29T09:00"), "a leap century");
  assert.ok(parseDue("2026-12-31T23:59:59Z"));
});
