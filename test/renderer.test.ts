import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createSage } from "../src/core/sage.js";
import { createIpcHandlers } from "../src/main/ipc.js";
import { CHANNELS, MAX_ACK_IDS, type Notice } from "../src/shared/api.js";
import { setWindowVisibility } from "./fake-dom.js";
import {
  deferred,
  FakeClock,
  FakePresenter,
  MemoryKeyStore,
  REFUSED_PORT,
  settled,
  tempDir,
  toolCall,
} from "./helpers.js";
import { startWindow } from "./window.js";

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

test("a notice collected while Settings is open or the window is hidden is confirmed only once seen", async (t) => {
  const waiting: Notice[] = [];
  const acks: string[][] = [];
  const { el, texts } = await startWindow(t, async () => "", {
    takeNotices: async () => structuredClone(waiting),
    ackNotices: async (ids) => {
      acks.push(ids);
    },
  });
  const poll = async () => {
    t.mock.timers.tick(5_000);
    await settled();
  };

  el("tab-settings").click();
  waiting.push({ id: "n1", text: "Sage reminder: Stretch" });
  await poll();
  assert.deepEqual(texts(), ["Sage reminder: Stretch"], "added to the chat, behind Settings");
  assert.deepEqual(acks, [], "not confirmed while the Chat view is hidden");
  await poll();
  assert.deepEqual(texts(), ["Sage reminder: Stretch"], "handed out again, not added twice");
  assert.deepEqual(acks, []);

  el("tab-chat").click();
  await settled();
  assert.deepEqual(acks, [["n1"]], "confirmed when the user switches back to Chat");
  waiting.length = 0;

  // The window is minimised: Chat is the open view, but nobody can see it.
  setWindowVisibility("hidden");
  waiting.push({ id: "n2", text: "Second" });
  await poll();
  assert.deepEqual(acks, [["n1"]], "not confirmed while the window is hidden");
  el("tab-settings").click();
  setWindowVisibility("visible");
  await settled();
  assert.deepEqual(acks, [["n1"]], "the window is back, but Settings is open");
  el("tab-chat").click();
  await settled();
  assert.deepEqual(acks, [["n1"], ["n2"]]);
  setWindowVisibility("hidden");
  setWindowVisibility("visible");
  await settled();
  assert.equal(acks.length, 2, "nothing left to confirm");
});

test("many notices held while Settings is open are confirmed in batches the channel accepts", async (t) => {
  const waiting: Notice[] = [];
  const acks: string[][] = [];
  const { el } = await startWindow(t, async () => "", {
    takeNotices: async () => structuredClone(waiting),
    ackNotices: async (ids) => {
      acks.push(ids);
    },
  });
  el("tab-settings").click();
  for (let i = 0; i < MAX_ACK_IDS + 7; i++) waiting.push({ id: `n${i}`, text: `R${i}` });
  t.mock.timers.tick(5_000);
  await settled();
  assert.equal(acks.length, 0, "held while Settings is open");
  el("tab-chat").click();
  await settled();
  assert.deepEqual(
    acks.map((batch) => batch.length),
    [MAX_ACK_IDS, 7],
  );
  assert.deepEqual(
    acks.flat(),
    waiting.map((n) => n.id),
  );
});

test("Settings open, a fallback reminder is collected, Sage restarts before Chat is opened: it comes back", async (t) => {
  const dataDir = await tempDir(t);
  const clock = new FakeClock(new Date("2026-11-15T09:00:00Z"));
  const start = () => {
    const sage = createSage({
      dataDir,
      keyStore: new MemoryKeyStore(),
      presenter: new FakePresenter(false),
      notify: () => false, // no desktop notifications: reminders go to the window
      openPath: async () => "",
      launch: async () => {},
      logSink: () => {},
      localPort: REFUSED_PORT,
      clock,
    });
    return {
      sage,
      handlers: createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null }),
    };
  };
  const first = start();
  let taking: Promise<unknown> = Promise.resolve();
  let acked = 0;
  const { el, texts } = await startWindow(t, async () => "", {
    takeNotices: () => {
      const result = first.handlers[CHANNELS.takeNotices](undefined) as Promise<Notice[]>;
      taking = result;
      return result;
    },
    ackNotices: async (ids) => {
      acked++;
      await first.handlers[CHANNELS.ackNotices]({ ids });
    },
  });

  el("tab-settings").click();
  const reminder = await first.sage.reminders.add("Take the bins out", new Date("2026-11-15T08:59:00Z"));
  await first.sage.scheduler.tick();
  t.mock.timers.tick(5_000);
  await taking;
  await settled();
  assert.deepEqual(texts(), ["Sage reminder: Take the bins out"], "the window collected it");
  assert.equal(acked, 0);
  assert.equal((await first.sage.reminders.get(reminder.id))!.firedAt, null, "not recorded as shown");

  // Sage closes before the user opens Chat, and starts again.
  const second = start();
  await second.sage.scheduler.tick();
  const again = (await second.handlers[CHANNELS.takeNotices](undefined)) as Notice[];
  assert.deepEqual(
    again.map((n) => n.text),
    ["Sage reminder: Take the bins out"],
    "the reminder comes back",
  );
});

test("a reminder deleted while its notice is held behind Settings never appears in the chat", async (t) => {
  const clock = new FakeClock(new Date("2026-11-15T09:00:00Z"));
  // The confirmation box for the delete stays open until the test answers it.
  const decision = deferred<boolean>();
  const asked = deferred<void>();
  const sage = createSage({
    dataDir: await tempDir(t),
    keyStore: new MemoryKeyStore(),
    presenter: {
      ask: () => {
        asked.resolve();
        return decision.promise;
      },
    },
    notify: () => false, // no desktop notifications: reminders go to the window
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    localPort: REFUSED_PORT,
    clock,
  });
  const handlers = createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null });
  let taking: Promise<unknown> = Promise.resolve();
  const acked: string[][] = [];
  const { el, texts } = await startWindow(t, async () => "", {
    takeNotices: () => {
      const result = handlers[CHANNELS.takeNotices](undefined) as Promise<Notice[]>;
      taking = result;
      return result;
    },
    ackNotices: async (ids) => {
      acked.push(ids);
      await handlers[CHANNELS.ackNotices]({ ids });
    },
  });
  const poll = async () => {
    t.mock.timers.tick(5_000);
    await taking;
    await settled();
  };

  // A delete is waiting for Allow, and the user has Settings open.
  const reminder = await sage.reminders.add("Water the plants", new Date("2026-11-15T09:01:00Z"));
  const deleting = sage.registry.execute(toolCall("delete_reminder", { id: reminder.id }));
  await asked.promise;
  el("tab-settings").click();

  // The reminder comes due and the window collects it, behind Settings.
  clock.advance(120_000);
  await sage.scheduler.tick();
  await poll();
  assert.deepEqual(texts(), ["Sage reminder: Water the plants"]);
  assert.deepEqual(acked, []);

  // Allow the delete; the next collection no longer has the notice, so the window drops it.
  decision.resolve(true);
  assert.equal((await deleting).ran, true);
  await poll();
  assert.deepEqual(texts(), [], "taken out of the hidden chat");

  el("tab-chat").click();
  await settled();
  assert.deepEqual(texts(), [], "the deleted reminder never appears");
  assert.deepEqual(acked, [], "and nothing is confirmed for it");
  assert.deepEqual(await sage.reminders.list(), []);
});

test("only held notices are taken out of the chat; confirmed ones, or ones being confirmed, stay", async (t) => {
  const waiting: Notice[] = [];
  let ackGate: ReturnType<typeof deferred<void>> | undefined;
  const acks: string[][] = [];
  const { el, texts } = await startWindow(t, async () => "", {
    takeNotices: async () => structuredClone(waiting),
    ackNotices: async (ids) => {
      acks.push(ids);
      // Sage stops handing a notice out as soon as it is confirmed.
      for (const id of ids) {
        const index = waiting.findIndex((n) => n.id === id);
        if (index >= 0) waiting.splice(index, 1);
      }
      await ackGate?.promise;
    },
  });
  const poll = async () => {
    t.mock.timers.tick(5_000);
    await settled();
  };

  // Seen and confirmed with Chat open: a later collection without it leaves it in the chat.
  waiting.push({ id: "n1", text: "Seen" });
  await poll();
  assert.deepEqual(acks, [["n1"]]);
  await poll();
  assert.deepEqual(texts(), ["Seen"]);

  // Its confirmation is still on its way when the next collection no longer has it: it stays.
  ackGate = deferred<void>();
  waiting.push({ id: "n2", text: "Being confirmed" });
  await poll();
  assert.deepEqual(acks, [["n1"], ["n2"]]);
  await poll();
  assert.deepEqual(texts(), ["Seen", "Being confirmed"]);
  ackGate.resolve();
  ackGate = undefined;
  await settled();

  // Held behind Settings, then withdrawn: taken out; another one still handed out stays.
  el("tab-settings").click();
  waiting.push({ id: "n3", text: "Withdrawn" }, { id: "n4", text: "Still waiting" });
  await poll();
  assert.deepEqual(texts(), ["Seen", "Being confirmed", "Withdrawn", "Still waiting"]);
  waiting.splice(0, 1);
  await poll();
  assert.deepEqual(texts(), ["Seen", "Being confirmed", "Still waiting"]);
  el("tab-chat").click();
  await settled();
  assert.deepEqual(acks, [["n1"], ["n2"], ["n4"]]);
});

test("settings are loaded at startup and after a successful save, and save messages are shown", () => {
  const loads = [...source.matchAll(/(?:void|await) loadSettings\(\)/g)].length;
  assert.equal(loads, 2, "once at startup, once after a successful save");
  assert.match(source, /\nvoid loadSettings\(\)\s*\.then\(/);
  assert.match(source, /result\.message \? `Saved\. \$\{result\.message\}`/);
});
