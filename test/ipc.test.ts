import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createSage } from "../src/core/sage.js";
import { defaultSettings } from "../src/core/settings.js";
import { createIpcHandlers, toPublicSettings } from "../src/main/ipc.js";
import { CHANNELS } from "../src/shared/api.js";
import { closedPort, FakePresenter, MemoryKeyStore, tempDir } from "./helpers.js";

async function setup(t: Parameters<typeof tempDir>[0]) {
  const dir = await tempDir(t);
  const keyStore = new MemoryKeyStore();
  const sage = createSage({
    dataDir: dir,
    keyStore,
    presenter: new FakePresenter(false),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    localPort: await closedPort(),
  });
  const handlers = createIpcHandlers(sage, {
    chooseFolder: async () => "/picked/folder",
    chooseApp: async () => null,
  });
  return { sage, handlers, keyStore };
}

test("every channel has a handler", async (t) => {
  const { handlers } = await setup(t);
  assert.deepEqual(Object.keys(handlers).sort(), Object.values(CHANNELS).sort());
});

test("chat messages are validated, and a missing local runner gives the plain message", async (t) => {
  const { handlers } = await setup(t);
  assert.equal(await handlers[CHANNELS.send]({ text: "" }), "Sage couldn't read that message.");
  assert.equal(await handlers[CHANNELS.send]({ text: "x".repeat(9000) }), "Sage couldn't read that message.");
  assert.equal(await handlers[CHANNELS.send]({ text: "hi", extra: 1 }), "Sage couldn't read that message.");
  assert.match(String(await handlers[CHANNELS.send]({ text: "hello" })), /Is Ollama running\?/);
  await handlers[CHANNELS.reset](undefined);
});

test("a failing turn returns a friendly message instead of throwing", async (t) => {
  const { handlers, sage } = await setup(t);
  sage.assistant.send = async () => {
    throw new Error("boom");
  };
  assert.equal(await handlers[CHANNELS.send]({ text: "hi" }), "Something went wrong. Try again.");
});

test("settings go out without the key, and come back validated", async (t) => {
  const { handlers, keyStore } = await setup(t);
  const before = (await handlers[CHANNELS.getSettings](undefined)) as any;
  assert.equal(before.online.hasKey, false);
  assert.equal(before.brain, "local");

  assert.deepEqual(await handlers[CHANNELS.setKey]({ key: "fake-value-for-tests" }), { ok: true });
  assert.equal(await keyStore.get(), "fake-value-for-tests");
  const after = (await handlers[CHANNELS.getSettings](undefined)) as any;
  assert.equal(after.online.hasKey, true);
  assert.ok(!JSON.stringify(after).includes("fake-value-for-tests"));

  assert.deepEqual(await handlers[CHANNELS.setKey]({ key: "" }), {
    ok: false,
    message: "That doesn't look like a key.",
  });
  const short = (await handlers[CHANNELS.setKey]({ key: "short" })) as any;
  assert.equal(short.ok, false);
  assert.deepEqual(await handlers[CHANNELS.clearKey](undefined), { ok: true });
  assert.equal(await keyStore.get(), null);

  const bad = (await handlers[CHANNELS.saveSettings]({ brain: "elsewhere" })) as any;
  assert.equal(bad.ok, false);
  const good = await handlers[CHANNELS.saveSettings]({ ...before, brain: "online", folders: ["/docs"] });
  assert.deepEqual(good, { ok: true });
  assert.equal(((await handlers[CHANNELS.getSettings](undefined)) as any).brain, "online");
  assert.equal(await handlers[CHANNELS.chooseFolder](undefined), "/picked/folder");
  assert.equal(await handlers[CHANNELS.chooseApp](undefined), null);
});

test("changing the online service's address removes the saved key and says so", async (t) => {
  const { handlers, keyStore } = await setup(t);
  const base = (await handlers[CHANNELS.getSettings](undefined)) as any;
  const save = (baseUrl: string, model = "m") =>
    handlers[CHANNELS.saveSettings]({ ...base, online: { baseUrl, model } });

  // A key set before the first address is saved is kept: there was no earlier service.
  await handlers[CHANNELS.setKey]({ key: "fake-value-for-tests" });
  assert.deepEqual(await save("https://service.example/v1"), { ok: true });
  assert.equal(await keyStore.has(), true);
  // The same service with a different path, trailing slash or model keeps the key.
  assert.deepEqual(await save("https://service.example/", "other"), { ok: true });
  assert.equal(await keyStore.has(), true);

  const moved = (await save("https://elsewhere.example/v1")) as any;
  assert.equal(moved.ok, true);
  assert.match(moved.message, /saved key was removed\. Enter the key for the new service again\./);
  assert.equal(await keyStore.has(), false);

  // With no key saved there is nothing to remove and no message.
  assert.deepEqual(await save("https://third.example/v1"), { ok: true });
  // A different port is a different service; so is clearing the address.
  await handlers[CHANNELS.setKey]({ key: "fake-value-for-tests" });
  assert.equal(((await save("https://third.example:8443/v1")) as any).ok, true);
  assert.equal(await keyStore.has(), false);
  await handlers[CHANNELS.setKey]({ key: "fake-value-for-tests" });
  await save("");
  assert.equal(await keyStore.has(), false);
  // A refused save changes nothing.
  await handlers[CHANNELS.setKey]({ key: "fake-value-for-tests" });
  assert.equal(((await handlers[CHANNELS.saveSettings]({ brain: "elsewhere" })) as any).ok, false);
  assert.equal(await keyStore.has(), true);
});

test("notices are handed to the window once each", async (t) => {
  const { handlers, sage } = await setup(t);
  assert.deepEqual(await handlers[CHANNELS.takeNotices](undefined), []);
  sage.notices.post("Sage reminder: Stand up");
  sage.notices.post("Second");
  assert.deepEqual(await handlers[CHANNELS.takeNotices](undefined), ["Sage reminder: Stand up", "Second"]);
  assert.deepEqual(await handlers[CHANNELS.takeNotices](undefined), []);
});

test("an unreadable settings, notes or reminders file is kept aside and the window is told once", async (t) => {
  const dir = await tempDir(t);
  for (const name of ["settings.json", "notes.json", "reminders.json"]) {
    await writeFile(join(dir, name), "{not json");
  }
  const sage = createSage({
    dataDir: dir,
    keyStore: new MemoryKeyStore(),
    presenter: new FakePresenter(false),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
  });
  const handlers = createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null });
  assert.equal(((await handlers[CHANNELS.getSettings](undefined)) as any).brain, "local");
  assert.deepEqual(await sage.notes.list(), []);
  assert.deepEqual(await sage.reminders.list(), []);
  await sage.notes.list();
  const notices = (await handlers[CHANNELS.takeNotices](undefined)) as string[];
  assert.equal(notices.length, 3, "one notice per file, not one per read");
  const files = await readdir(dir);
  for (const [what, name] of [
    ["settings", "settings.json"],
    ["notes", "notes.json"],
    ["reminders", "reminders.json"],
  ] as const) {
    const notice = notices.find((n) => n.includes(`its ${what} file`));
    assert.ok(notice, what);
    assert.match(notice, /The old file wasn't deleted; it was kept here: /);
    const kept = files.find((file) => file.startsWith(`${name}.invalid-`));
    assert.ok(kept && notice.endsWith(join(dir, kept)), `${what} names the kept file`);
    assert.equal(await readFile(join(dir, kept), "utf8"), "{not json");
  }
  assert.deepEqual(await handlers[CHANNELS.takeNotices](undefined), []);
});

test("toPublicSettings copies only the public fields", () => {
  const settings = { ...defaultSettings(), apps: [{ name: "A", path: "/a", args: ["x"] }] };
  const out = toPublicSettings(settings, true);
  assert.deepEqual(Object.keys(out.online).sort(), ["baseUrl", "hasKey", "model"]);
  out.apps[0]!.args.push("y");
  assert.deepEqual(settings.apps[0]!.args, ["x"], "a copy, not the stored object");
});
