import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createSage } from "../src/core/sage.js";
import { defaultSettings } from "../src/core/settings.js";
import { createIpcHandlers, SAVE_SETTINGS_FIRST, toPublicSettings } from "../src/main/ipc.js";
import { MAX_NOTICES } from "../src/core/notices.js";
import { CHANNELS, type Notice } from "../src/shared/api.js";
import { FakeClock, FakePresenter, MemoryKeyStore, REFUSED_PORT, tempDir, toolCall } from "./helpers.js";

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
    localPort: REFUSED_PORT,
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

  assert.deepEqual(await handlers[CHANNELS.setKey]({ key: "fake-value-for-tests", baseUrl: "" }), {
    ok: true,
  });
  assert.deepEqual(await keyStore.get(), { key: "fake-value-for-tests", origin: null });
  const after = (await handlers[CHANNELS.getSettings](undefined)) as any;
  assert.equal(after.online.hasKey, true);
  assert.ok(!JSON.stringify(after).includes("fake-value-for-tests"));

  assert.deepEqual(await handlers[CHANNELS.setKey]({ key: "", baseUrl: "" }), {
    ok: false,
    message: "That doesn't look like a key.",
  });
  // The address on screen is required, and must be a short string.
  for (const payload of [
    { key: "fake-value-for-tests" },
    { key: "fake-value-for-tests", baseUrl: 5 },
    { key: "fake-value-for-tests", baseUrl: "x".repeat(501) },
  ]) {
    assert.deepEqual(await handlers[CHANNELS.setKey](payload), {
      ok: false,
      message: "That doesn't look like a key.",
    });
  }
  const short = (await handlers[CHANNELS.setKey]({ key: "short", baseUrl: "" })) as any;
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
  await handlers[CHANNELS.setKey]({ key: "fake-value-for-tests", baseUrl: "" });
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
  await handlers[CHANNELS.setKey]({ key: "fake-value-for-tests", baseUrl: "https://third.example/v1" });
  assert.equal(await keyStore.has(), true);
  assert.equal(((await save("https://third.example:8443/v1")) as any).ok, true);
  assert.equal(await keyStore.has(), false);
  await handlers[CHANNELS.setKey]({ key: "fake-value-for-tests", baseUrl: "https://third.example:8443" });
  assert.equal(await keyStore.has(), true);
  await save("");
  assert.equal(await keyStore.has(), false);
  // A refused save changes nothing.
  await handlers[CHANNELS.setKey]({ key: "fake-value-for-tests", baseUrl: "" });
  assert.equal(await keyStore.has(), true);
  assert.equal(((await handlers[CHANNELS.saveSettings]({ brain: "elsewhere" })) as any).ok, false);
  assert.equal(await keyStore.has(), true);
});

test("Save key only saves for the address that is saved, not one typed but not yet saved", async (t) => {
  const { handlers, keyStore } = await setup(t);
  const base = (await handlers[CHANNELS.getSettings](undefined)) as any;
  const save = (baseUrl: string) =>
    handlers[CHANNELS.saveSettings]({ ...base, online: { baseUrl, model: "m" } });
  const setKey = (baseUrl: string) => handlers[CHANNELS.setKey]({ key: "fake-key-for-service-b", baseUrl });
  const refused = { ok: false, message: SAVE_SETTINGS_FIRST };

  // Service A is saved; the user types service B's address and B's key and presses Save key.
  assert.deepEqual(await save("https://a.example/v1"), { ok: true });
  assert.deepEqual(await setKey("https://b.example/v1"), refused);
  assert.equal(await keyStore.get(), null, "nothing is stored for A");
  // An address typed with nothing saved yet is refused too, and so is an empty field while one is saved.
  assert.deepEqual(await setKey(""), refused);
  assert.equal(await keyStore.get(), null);

  // After Save settings for B, the same key is saved, and tied to B.
  assert.deepEqual(await save("https://b.example/v1"), { ok: true });
  assert.deepEqual(await setKey("  https://b.example/  "), { ok: true });
  assert.deepEqual(await keyStore.get(), { key: "fake-key-for-service-b", origin: "https://b.example" });
});

test("Save key with no address saved and none typed keeps the key for the first address saved", async (t) => {
  const { handlers, keyStore } = await setup(t);
  assert.deepEqual(
    await handlers[CHANNELS.setKey]({ key: "fake-value-for-tests", baseUrl: "https://a.example" }),
    {
      ok: false,
      message: SAVE_SETTINGS_FIRST,
    },
  );
  assert.equal(await keyStore.get(), null);
  assert.deepEqual(await handlers[CHANNELS.setKey]({ key: "fake-value-for-tests", baseUrl: "" }), {
    ok: true,
  });
  assert.deepEqual(await keyStore.get(), { key: "fake-value-for-tests", origin: null });
});

test("notices are handed to the window until it confirms them, and confirmed once", async (t) => {
  const { handlers, sage } = await setup(t);
  const take = async () => (await handlers[CHANNELS.takeNotices](undefined)) as Notice[];
  assert.deepEqual(await take(), []);
  let delivered = 0;
  sage.notices.post("Sage reminder: Stand up", { key: "r", onDelivered: () => void delivered++ });
  sage.notices.post("Second");
  const taken = await take();
  assert.deepEqual(
    taken.map((n) => n.text),
    ["Sage reminder: Stand up", "Second"],
  );
  assert.deepEqual(await take(), taken, "handed out again, same ids, until confirmed");
  assert.equal(delivered, 0);

  assert.equal(await handlers[CHANNELS.ackNotices]({ ids: [taken[0]!.id] }), undefined);
  assert.equal(delivered, 1);
  assert.deepEqual(await take(), [taken[1]]);
  await handlers[CHANNELS.ackNotices]({ ids: taken.map((n) => n.id) });
  assert.equal(delivered, 1, "a repeated confirmation is ignored");
  assert.deepEqual(await take(), []);
});

test("deleting a reminder withdraws its notice from the window queue", async (t) => {
  const clock = new FakeClock(new Date("2026-11-15T09:00:00Z"));
  const presenter = new FakePresenter(true);
  const sage = createSage({
    dataDir: await tempDir(t),
    keyStore: new MemoryKeyStore(),
    presenter,
    notify: () => false,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    localPort: REFUSED_PORT,
    clock,
  });
  const handlers = createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null });
  const take = async () => (await handlers[CHANNELS.takeNotices](undefined)) as Notice[];
  const waiting = await sage.reminders.add("Waiting", new Date("2026-11-15T08:00:00Z"));
  const collected = await sage.reminders.add("Collected", new Date("2026-11-15T08:01:00Z"));
  await sage.scheduler.tick();
  const first = await take();
  assert.equal(first.length, 2);

  // The user deletes both (Allow in the box) before the window confirms either.
  for (const reminder of [waiting, collected]) {
    const result = await sage.registry.execute(toolCall("delete_reminder", { id: reminder.id }));
    assert.equal(result.ran, true);
    assert.equal(sage.notices.has(`reminder:${reminder.id}`), false, "withdrawn at once");
  }
  assert.deepEqual(await take(), [], "neither appears in the window");
  await handlers[CHANNELS.ackNotices]({ ids: first.map((n) => n.id) });
  assert.deepEqual(await sage.reminders.list(), [], "and the late confirmation brings nothing back");
  await sage.scheduler.tick();
  assert.deepEqual(await take(), []);
});

test("notice confirmations are validated: a short list of short ids, nothing else", async (t) => {
  const { handlers, sage } = await setup(t);
  let delivered = 0;
  sage.notices.post("Sage reminder: a", { key: "r", onDelivered: () => void delivered++ });
  const [notice] = (await handlers[CHANNELS.takeNotices](undefined)) as Notice[];
  const id = notice!.id;
  for (const payload of [
    undefined,
    id,
    [id],
    { ids: id },
    { ids: [id], extra: 1 },
    { ids: [id, 5] },
    { ids: [id, ""] },
    { ids: [id, "x".repeat(33)] },
    { ids: [id, ...Array.from({ length: MAX_NOTICES + 1 }, (_, i) => `n${i + 100}`)] },
  ]) {
    assert.equal(await handlers[CHANNELS.ackNotices](payload), undefined);
  }
  assert.equal(delivered, 0, "no malformed confirmation counts");
  await handlers[CHANNELS.ackNotices]({ ids: [id] });
  assert.equal(delivered, 1);
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
  const taken = (await handlers[CHANNELS.takeNotices](undefined)) as Notice[];
  await handlers[CHANNELS.ackNotices]({ ids: taken.map((n) => n.id) });
  const notices = taken.map((n) => n.text);
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
