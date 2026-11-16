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

test("a reminder deleted while held behind Settings is gone when Chat opens, before the next collection", async (t) => {
  const clock = new FakeClock(new Date("2026-11-15T09:00:00Z"));
  const sage = createSage({
    dataDir: await tempDir(t),
    keyStore: new MemoryKeyStore(),
    presenter: { ask: async () => true },
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

  // The reminder comes due and is collected while Settings is open: held.
  el("tab-settings").click();
  const reminder = await sage.reminders.add("Water the plants", new Date("2026-11-15T09:01:00Z"));
  clock.advance(120_000);
  await sage.scheduler.tick();
  t.mock.timers.tick(5_000);
  await taking;
  await settled();
  assert.deepEqual(texts(), ["Sage reminder: Water the plants"]);

  // Deleted; no collection runs before Chat opens (the timers aren't ticked).
  assert.equal((await sage.registry.execute(toolCall("delete_reminder", { id: reminder.id }))).ran, true);
  el("tab-chat").click();
  await taking;
  await settled();
  assert.deepEqual(texts(), [], "removed when Chat opened");
  assert.deepEqual(acked, [], "and never confirmed");
});

test("a collection still running when Chat opens is followed by a fresh one; a stale answer can't bring a notice back", async (t) => {
  const stale = deferred<Notice[]>();
  const answers: Promise<Notice[]>[] = [];
  let calls = 0;
  const acks: string[][] = [];
  const { el, texts } = await startWindow(t, async () => "", {
    takeNotices: () => {
      calls++;
      return answers.shift() ?? Promise.resolve([]);
    },
    ackNotices: async (ids) => {
      acks.push(ids);
    },
  });
  const held = { id: "n1", text: "Held" };

  // Held behind Settings.
  el("tab-settings").click();
  answers.push(Promise.resolve([held]));
  t.mock.timers.tick(5_000);
  await settled();
  assert.deepEqual(texts(), ["Held"]);

  // A collection starts before the delete (its answer still has the notice) and is slow.
  answers.push(stale.promise);
  t.mock.timers.tick(5_000);
  await settled();
  const before = calls;
  // Chat opens, then a poll arrives too: both coalesce into exactly one more collection.
  // That fresh collection no longer has the notice.
  el("tab-chat").click();
  t.mock.timers.tick(5_000);
  await settled();
  assert.equal(calls, before, "the fresh collection waits for the one in flight");
  assert.deepEqual(acks, [], "nothing is confirmed meanwhile");
  stale.resolve([held]);
  await settled();
  assert.equal(calls, before + 1, "exactly one fresh collection follows");
  assert.deepEqual(texts(), [], "the stale answer didn't bring it back");
  assert.deepEqual(acks, [], "and it was never confirmed");
});

test("the window becoming visible again collects before confirming", async (t) => {
  const waiting: Notice[] = [];
  const acks: string[][] = [];
  let shownWhenAcked: (string | null)[] = [];
  let screen = (): (string | null)[] => [];
  const { texts } = await startWindow(t, async () => "", {
    takeNotices: async () => structuredClone(waiting),
    ackNotices: async (ids) => {
      shownWhenAcked = screen();
      acks.push(ids);
    },
  });
  screen = texts;

  // Minimised: a notice is collected but held; then it is withdrawn while the window is hidden.
  setWindowVisibility("hidden");
  waiting.push({ id: "n1", text: "Held" });
  t.mock.timers.tick(5_000);
  await settled();
  assert.deepEqual(texts(), ["Held"]);
  waiting.length = 0;
  setWindowVisibility("visible");
  await settled();
  assert.deepEqual(texts(), [], "collected again first");
  assert.deepEqual(acks, [], "so the withdrawn notice is never confirmed");

  // One that is still there is shown, then confirmed.
  setWindowVisibility("hidden");
  waiting.push({ id: "n2", text: "Still here" });
  t.mock.timers.tick(5_000);
  await settled();
  setWindowVisibility("visible");
  await settled();
  assert.deepEqual(acks, [["n2"]]);
  assert.deepEqual(shownWhenAcked, ["Still here"]);
});

test("a held notice stays hidden until it is about to be confirmed, so a withdrawn one is never seen", async (t) => {
  const answers: Promise<Notice[]>[] = [];
  const hiddenWhenAcked: (boolean | undefined)[] = [];
  const acks: string[][] = [];
  const { el, texts } = await startWindow(t, async () => "", {
    takeNotices: () => answers.shift() ?? Promise.resolve([]),
    ackNotices: async (ids) => {
      acks.push(ids);
      hiddenWhenAcked.push(el("messages").children[0]?.hidden);
    },
  });
  const lines = () => el("messages").children;

  el("tab-settings").click();
  answers.push(Promise.resolve([{ id: "n1", text: "Held" }]));
  t.mock.timers.tick(5_000);
  await settled();
  assert.equal(lines()[0]?.hidden, true, "held lines are hidden");

  // Chat opens; the fresh collection is still on its way, and the line must not be on screen.
  const fresh = deferred<Notice[]>();
  answers.push(fresh.promise);
  el("tab-chat").click();
  await settled();
  assert.equal(lines()[0]?.hidden, true, "still hidden while the fresh collection is pending");
  fresh.resolve([]);
  await settled();
  assert.deepEqual(texts(), [], "withdrawn without ever being shown");
  assert.deepEqual(acks, []);

  // A notice that is still there is shown just before it is confirmed.
  answers.push(Promise.resolve([{ id: "n2", text: "Seen" }]));
  t.mock.timers.tick(5_000);
  await settled();
  assert.deepEqual(acks, [["n2"]]);
  assert.deepEqual(hiddenWhenAcked, [false]);
});

test("a failed collection confirms nothing; the notices stay held until one succeeds", async (t) => {
  let answer: () => Promise<Notice[]> = async () => [];
  const acks: string[][] = [];
  const { el, texts } = await startWindow(t, async () => "", {
    takeNotices: () => answer(),
    ackNotices: async (ids) => {
      acks.push(ids);
    },
  });
  el("tab-settings").click();
  answer = async () => [{ id: "n1", text: "Held" }];
  t.mock.timers.tick(5_000);
  await settled();
  assert.deepEqual(texts(), ["Held"]);

  // Sage can't be asked when Chat opens: the possibly stale notice is not confirmed.
  answer = async () => {
    throw new Error("no answer");
  };
  el("tab-chat").click();
  await settled();
  assert.deepEqual(acks, [], "not confirmed after a failed collection");
  assert.equal(el("messages").children[0]?.hidden, true, "and not shown");

  // The next collection works and the notice is gone: it was deleted meanwhile.
  answer = async () => [];
  t.mock.timers.tick(5_000);
  await settled();
  assert.deepEqual(texts(), []);
  assert.deepEqual(acks, []);
});

test("a request made while a confirmation is on its way is not dropped, and later batches follow it", async (t) => {
  const waiting: Notice[] = [];
  const acks: string[][] = [];
  let takes = 0;
  let gate: ReturnType<typeof deferred<void>> | undefined;
  const { el } = await startWindow(t, async () => "", {
    takeNotices: async () => {
      takes++;
      return structuredClone(waiting);
    },
    ackNotices: async (ids) => {
      acks.push(ids);
      await gate?.promise;
    },
  });
  for (let i = 0; i < MAX_ACK_IDS + 3; i++) waiting.push({ id: `n${i}`, text: `R${i}` });
  el("tab-settings").click();
  t.mock.timers.tick(5_000);
  await settled();
  assert.equal(acks.length, 0);

  // The first batch is being confirmed when the last notice is withdrawn and a poll arrives.
  gate = deferred<void>();
  el("tab-chat").click();
  await settled();
  assert.equal(acks.length, 1);
  const before = takes;
  const withdrawn = waiting.pop()!;
  el("tab-chat").click(); // a new request while the confirmation is on its way
  await settled();
  gate.resolve();
  await settled();
  assert.ok(takes > before, "the request made during the confirmation was collected");
  assert.deepEqual(
    acks.map((batch) => batch.length),
    [MAX_ACK_IDS, 2],
  );
  assert.ok(!acks.flat().includes(withdrawn.id), "no batch went on from the old snapshot");
});

test("every batch is checked for a visible Chat before it is confirmed", async (t) => {
  const waiting: Notice[] = [];
  const acks: string[][] = [];
  let gate: ReturnType<typeof deferred<void>> | undefined;
  const { el } = await startWindow(t, async () => "", {
    takeNotices: async () => structuredClone(waiting),
    ackNotices: async (ids) => {
      acks.push(ids);
      await gate?.promise;
    },
  });
  for (let i = 0; i < MAX_ACK_IDS + 3; i++) waiting.push({ id: `n${i}`, text: `R${i}` });
  el("tab-settings").click();
  t.mock.timers.tick(5_000);
  await settled();

  gate = deferred<void>();
  el("tab-chat").click();
  await settled();
  assert.equal(acks.length, 1);
  setWindowVisibility("hidden"); // minimised while the first batch is on its way
  gate.resolve();
  await settled();
  assert.equal(acks.length, 1, "the second batch waits while nobody can see Chat");
  gate = undefined;
  setWindowVisibility("visible");
  await settled();
  assert.deepEqual(
    acks.map((batch) => batch.length),
    [MAX_ACK_IDS, 3],
  );
});

test("slow collections with polls ticking in between still confirm and reveal the notice", async (t) => {
  const notice = { id: "n1", text: "Slow" };
  const startup = deferred<Notice[]>();
  const spare = deferred<Notice[]>();
  const answers = [startup, spare, deferred<Notice[]>()];
  const acks: string[][] = [];
  const { el, texts } = await startWindow(t, async () => "", {
    takeNotices: () => answers.shift()?.promise ?? Promise.resolve([notice]),
    ackNotices: async (ids) => {
      acks.push(ids);
    },
  });
  // The startup collection is slow; polls come and go meanwhile and start nothing.
  t.mock.timers.tick(5_000);
  t.mock.timers.tick(5_000);
  assert.equal(answers.length, 2, "only the startup collection has been asked for");
  // Starting up asks twice (Chat opens, then the notices start); the second is slow too.
  startup.resolve([notice]);
  await settled();
  t.mock.timers.tick(5_000);
  assert.equal(answers.length, 1, "the poll didn't ask again");
  spare.resolve([notice]);
  await settled();
  assert.deepEqual(acks, [["n1"]], "confirmed without waiting for another round");
  assert.deepEqual(texts(), ["Slow"]);
  assert.equal(el("messages").children[0]?.hidden, false);
});

test("New chat while a notice is held: it comes back in the new list, hidden, and is confirmed once", async (t) => {
  const notice = { id: "n1", text: "Held" };
  const answers: Promise<Notice[]>[] = [];
  const acks: string[][] = [];
  const { el, texts } = await startWindow(t, async () => "", {
    takeNotices: () => answers.shift() ?? Promise.resolve([]),
    ackNotices: async (ids) => {
      acks.push(ids);
    },
  });
  el("tab-settings").click();
  answers.push(Promise.resolve([notice]));
  t.mock.timers.tick(5_000);
  await settled();
  assert.deepEqual(texts(), ["Held"]);

  // Chat opens with the refresh delayed; New chat clears the list meanwhile.
  const refresh = deferred<Notice[]>();
  answers.push(refresh.promise);
  el("tab-chat").click();
  await settled();
  el("new-chat").click();
  assert.deepEqual(texts(), []);
  refresh.resolve([notice]);
  await settled();
  assert.deepEqual(texts(), ["Held"], "added again to the new list");
  assert.equal(el("messages").children[0]?.hidden, false, "shown before it was confirmed");
  assert.deepEqual(acks, [["n1"]], "confirmed once");
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
