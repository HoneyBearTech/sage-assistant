import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { NotesStore } from "../src/core/notes.js";
import { RemindersStore } from "../src/core/reminders.js";
import { defaultSettings } from "../src/core/settings.js";
import { ActionLog } from "../src/core/skills/action-log.js";
import { builtinSkills } from "../src/core/skills/builtin.js";
import { ApprovalGate } from "../src/core/skills/gate.js";
import { defineSkill, NotWanted, STOPPED_TEXT, SkillRegistry } from "../src/core/skills/registry.js";
import { captureLogs, FakePresenter, tempDir, toolCall } from "./helpers.js";

// New chat (or a change of brain settings) can happen at any await between the user's Allow and
// the effect. Each of those points is paused here, the conversation is stopped there, and nothing
// may happen.

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function setup(t: Parameters<typeof tempDir>[0]) {
  const dir = await tempDir(t);
  const presenter = new FakePresenter(true);
  const registry = new SkillRegistry(
    new ApprovalGate(presenter),
    new ActionLog(join(dir, "log.jsonl")),
    captureLogs().logger,
  );
  const readLog = async () =>
    (await readFile(join(dir, "log.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { outcome: string });
  return { dir, presenter, registry, readLog };
}

test("stopped while the check after Allow is still running: the action doesn't run", async (t) => {
  const { presenter, registry, readLog } = await setup(t);
  const secondCheckStarted = deferred();
  const releaseSecondCheck = deferred();
  let prepares = 0;
  const ran: string[] = [];
  registry.register(
    defineSkill({
      name: "risky",
      description: "risky",
      risk: "confirm",
      args: z.strictObject({}),
      prepare: async () => {
        prepares++;
        if (prepares === 2) {
          secondCheckStarted.resolve();
          await releaseSecondCheck.promise;
        }
        return { ok: true, summary: "Do the risky thing" };
      },
      run: async () => {
        ran.push("risky");
        return { text: "done" };
      },
    }),
  );
  let wanted = true;
  const result = registry.execute(toolCall("risky", {}), () => wanted);
  await secondCheckStarted.promise;
  assert.equal(presenter.asked.length, 1, "the user had chosen Allow");
  wanted = false;
  releaseSecondCheck.resolve();
  assert.deepEqual(await result, { text: STOPPED_TEXT, ran: false });
  assert.deepEqual(ran, []);
  assert.equal((await readLog()).at(-1)!.outcome, "not run: the conversation was stopped");
});

test("stopped while the first check runs: the box is never shown", async (t) => {
  const { presenter, registry } = await setup(t);
  const firstCheckStarted = deferred();
  const releaseFirstCheck = deferred();
  registry.register(
    defineSkill({
      name: "risky",
      description: "risky",
      risk: "confirm",
      args: z.strictObject({}),
      prepare: async () => {
        firstCheckStarted.resolve();
        await releaseFirstCheck.promise;
        return { ok: true, summary: "Do the risky thing" };
      },
      run: async () => ({ text: "done" }),
    }),
  );
  let wanted = true;
  const result = registry.execute(toolCall("risky", {}), () => wanted);
  await firstCheckStarted.promise;
  wanted = false;
  releaseFirstCheck.resolve();
  assert.deepEqual(await result, { text: STOPPED_TEXT, ran: false });
  assert.equal(presenter.asked.length, 0);
});

test("a run step that finds the conversation stopped before acting reports it as not run", async (t) => {
  const { registry, readLog } = await setup(t);
  let wanted = true;
  registry.register(
    defineSkill({
      name: "risky",
      description: "risky",
      risk: "confirm",
      args: z.strictObject({}),
      prepare: async () => ({ ok: true, summary: "Do it" }),
      run: async (_args, _action, stillWanted) => {
        wanted = false; // as if New chat happened during an await inside the run step
        if (!stillWanted()) throw new NotWanted();
        throw new Error("unreachable");
      },
    }),
  );
  assert.deepEqual(await registry.execute(toolCall("risky", {}), () => wanted), {
    text: STOPPED_TEXT,
    ran: false,
  });
  assert.equal((await readLog()).at(-1)!.outcome, "not run: the conversation was stopped");
  // Safe skills aren't started for a stopped conversation either.
  let safeRan = false;
  registry.register(
    defineSkill({
      name: "safe_one",
      description: "safe",
      risk: "safe",
      args: z.strictObject({}),
      run: async () => {
        safeRan = true;
        return { text: "x" };
      },
    }),
  );
  assert.deepEqual(await registry.execute(toolCall("safe_one", {}), () => false), {
    text: STOPPED_TEXT,
    ran: false,
  });
  assert.equal(safeRan, false);
});

test("open_file: stopped during the file check inside the run step, nothing is opened", async (t) => {
  const { dir, registry } = await setup(t);
  const folder = join(dir, "docs");
  await mkdir(folder);
  await writeFile(join(folder, "plan.txt"), "plan");
  const { logger } = captureLogs();
  let settingsReads = 0;
  let wanted = true;
  const opened: string[] = [];
  for (const skill of builtinSkills({
    notes: new NotesStore(dir, logger),
    reminders: new RemindersStore(dir, logger),
    search: { name: "none", search: async () => ({ ok: true, results: [] }) },
    settings: async () => {
      settingsReads++;
      // Reads 1 and 2 are the checks before and after Allow; read 3 is inside the run step.
      if (settingsReads === 3) wanted = false;
      return { ...defaultSettings(), folders: [folder] };
    },
    openPath: async (path) => {
      opened.push(path);
      return "";
    },
    launch: async () => {},
    now: () => new Date("2026-11-15T10:00:00Z"),
  })) {
    if (skill.name === "open_file") registry.register(skill);
  }
  const result = await registry.execute(
    toolCall("open_file", { path: join(folder, "plan.txt") }),
    () => wanted,
  );
  assert.equal(settingsReads, 3);
  assert.deepEqual(result, { text: STOPPED_TEXT, ran: false });
  assert.deepEqual(opened, []);
});
