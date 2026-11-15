import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { type TestContext, test } from "node:test";
import type { Notice, PublicSettings, SageApi } from "../src/shared/api.js";
import { installFakeDom, removeFakeDom } from "./fake-dom.js";

// The first checks read the renderer's source for the behaviour that matters (unsaved settings
// aren't thrown away); the later ones run the script itself against a fake DOM.
const source = await readFile(new URL("../src/renderer/renderer.ts", import.meta.url), "utf8");

function body(start: string): string {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `found ${start}`);
  const next = source.indexOf("\n}", from);
  return source.slice(from, next);
}

test("switching to the Settings tab doesn't reload the form over unsaved changes", () => {
  assert.doesNotMatch(body("function show("), /loadSettings\(/);
});

test("saving or removing the key refreshes only the key status", () => {
  for (const button of ['"save-key"', '"clear-key"']) {
    const handler = body(button);
    assert.match(handler, /refreshKeyStatus\(\)/, button);
    assert.doesNotMatch(handler, /loadSettings\(/, button);
  }
  const refresh = body("async function refreshKeyStatus(");
  assert.match(refresh, /settings\.online\.hasKey = latest\.online\.hasKey/);
  assert.doesNotMatch(refresh, /render\(\)/);
});

// The real window script, run against a small fake DOM (test/fake-dom.ts) and a fake window.sage.
const ids = [...source.matchAll(/byId<\w+>\("([\w-]+)"\)/g)].map((match) => match[1]!);
let loads = 0;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

async function startWindow(
  t: TestContext,
  send: (text: string) => Promise<string>,
  overrides: Partial<SageApi> = {},
) {
  // The notice poll's timer is mocked, so it never fires by itself and nothing is left running.
  t.mock.timers.enable({ apis: ["setInterval"] });
  const calls = { send: [] as string[], getSettings: 0, reset: 0 };
  const settings: PublicSettings = {
    brain: "local",
    local: { model: "small-model" },
    online: { baseUrl: "", model: "", hasKey: false },
    apps: [],
    folders: [],
  };
  const api: SageApi = {
    send: (text) => {
      calls.send.push(text);
      return send(text);
    },
    resetChat: async () => {
      calls.reset++;
    },
    getSettings: async () => {
      calls.getSettings++;
      return structuredClone(settings);
    },
    saveSettings: async () => ({ ok: true }),
    setKey: async () => {
      settings.online.hasKey = true;
      return { ok: true };
    },
    clearKey: async () => ({ ok: true }),
    chooseFolder: async () => null,
    chooseApp: async () => null,
    takeNotices: async () => [],
    ackNotices: async () => {},
    ...overrides,
  };
  const elements = installFakeDom(ids, api);
  t.after(removeFakeDom);
  // A fresh copy of the script for each test.
  await import(`../src/renderer/renderer.ts?window=${++loads}`);
  await settled();
  const el = (id: string) => elements.get(id)!;
  const texts = () => el("messages").children.map((item) => item.textContent);
  return { el, texts, calls };
}

test("New chat during a pending reply: Send works again, and the old reply never appears", async (t) => {
  const first = deferred<string>();
  const replies = [first.promise, Promise.resolve("fresh answer")];
  const { el, texts, calls } = await startWindow(t, () => replies.shift()!);
  el("input").value = "first question";
  el("composer").dispatch("submit");
  await settled();
  assert.equal(el("send").disabled, true);
  assert.deepEqual(texts(), ["first question", "Thinking…"]);

  // Enter while busy doesn't send a second message.
  el("input").value = "impatient";
  el("input").dispatch("keydown", { key: "Enter" });
  await settled();
  assert.deepEqual(calls.send, ["first question"]);

  el("new-chat").click();
  await settled();
  assert.equal(calls.reset, 1);
  assert.deepEqual(texts(), []);
  assert.equal(el("send").disabled, false, "Send is usable again in the new chat");

  first.resolve("old answer");
  await settled();
  assert.deepEqual(texts(), [], "the old chat's reply doesn't land in the new chat");
  assert.equal(el("send").disabled, false);

  el("input").value = "second question";
  el("input").dispatch("keydown", { key: "Enter" });
  await settled();
  assert.deepEqual(texts(), ["second question", "fresh answer"]);
  assert.equal(el("send").disabled, false);
});

test("in the real window script, unsaved settings survive saving the key and switching tabs", async (t) => {
  const { el, calls } = await startWindow(t, async () => "");
  assert.equal(calls.getSettings, 1, "loaded once at startup");
  el("tab-settings").click();
  el("local-model").value = "typed but not saved";
  el("online-key").value = "fake-value-for-tests";
  el("save-key").click();
  await settled();
  el("tab-chat").click();
  el("tab-settings").click();
  await settled();
  assert.equal(el("local-model").value, "typed but not saved");
  assert.match(el("key-status").textContent, /A key is saved/);
  assert.equal(el("online-key").value, "", "the key field is emptied");
});

test("Save key sends the address on screen with the key, and shows a refusal", async (t) => {
  const sent: [string, string][] = [];
  const { el } = await startWindow(t, async () => "", {
    setKey: async (key, baseUrl) => {
      sent.push([key, baseUrl]);
      return { ok: false, message: "Save settings first, then save the key." };
    },
  });
  el("tab-settings").click();
  el("online-url").value = "https://b.example/v1";
  el("online-key").value = "fake-key-for-service-b";
  el("save-key").click();
  await settled();
  assert.deepEqual(sent, [["fake-key-for-service-b", "https://b.example/v1"]]);
  assert.equal(el("settings-status").textContent, "Key not saved: Save settings first, then save the key.");
  assert.equal(el("online-key").value, "", "the key field is emptied either way");
  assert.doesNotMatch(el("key-status").textContent, /A key is saved/);
});

test("notices are confirmed only after they are on screen, and never shown twice", async (t) => {
  const waiting: Notice[] = [];
  const acks: string[][] = [];
  let failAck = true;
  let shownWhenAcked: (string | null)[] = [];
  let screen = (): (string | null)[] => [];
  const { texts } = await startWindow(t, async () => "", {
    takeNotices: async () => structuredClone(waiting),
    ackNotices: async (ids) => {
      shownWhenAcked = screen();
      acks.push(ids);
      if (failAck) throw new Error("the main process didn't answer");
    },
  });
  screen = texts;
  assert.deepEqual(acks, [], "nothing to confirm at startup");
  // Collected on the next poll, shown, then confirmed.
  waiting.push({ id: "n1", text: "Sage reminder: Stretch" });
  t.mock.timers.tick(5_000);
  await settled();
  assert.deepEqual(texts(), ["Sage reminder: Stretch"]);
  assert.deepEqual(acks, [["n1"]]);
  assert.deepEqual(shownWhenAcked, ["Sage reminder: Stretch"], "on screen before it is confirmed");

  // The confirmation failed, so Sage hands it out again with a new one: shown once, confirmed again.
  waiting.push({ id: "n2", text: "Second" });
  failAck = false;
  t.mock.timers.tick(5_000);
  await settled();
  assert.deepEqual(texts(), ["Sage reminder: Stretch", "Second"]);
  assert.deepEqual(acks, [["n1"], ["n1", "n2"]]);

  // Nothing waiting: nothing to confirm.
  waiting.length = 0;
  t.mock.timers.tick(5_000);
  await settled();
  assert.equal(acks.length, 2);
});

test("settings are loaded at startup and after a successful save, and save messages are shown", () => {
  const loads = [...source.matchAll(/(?:void|await) loadSettings\(\)/g)].length;
  assert.equal(loads, 2, "once at startup, once after a successful save");
  assert.match(source, /\nvoid loadSettings\(\);\n/);
  assert.match(source, /result\.message \? `Saved\. \$\{result\.message\}`/);
});
