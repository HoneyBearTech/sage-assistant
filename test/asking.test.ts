import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { announcingPresenter } from "../src/core/asking.js";
import { createSage } from "../src/core/sage.js";
import type { ConfirmRequest } from "../src/core/skills/gate.js";
import { createIpcHandlers } from "../src/main/ipc.js";
import { type AskingEvent, CHANNELS, EVENTS, MAX_ASKING_TEXT, readAskingEvent } from "../src/shared/api.js";
import { FakePresenter, memoryKeyStores, REFUSED_PORT, tempDir, toolCall } from "./helpers.js";

// The asking card's news (src/core/asking.ts and the one-way event): the window is told when Sage's
// own box opens and closes, and nothing it can do answers the box.

const root = join(import.meta.dirname, "..");
const request: ConfirmRequest = { callId: "call-1", skill: "open_app", summary: "Open the app Notepad?" };

test("the box's news goes out when it opens and when it closes, with the box's own words", async () => {
  const events: AskingEvent[] = [];
  const presenter = announcingPresenter(new FakePresenter(true), (event) => events.push(event));
  assert.equal(await presenter.ask(request), true);
  assert.equal(
    await presenter.ask({ ...request, callId: "call-2", summary: "Delete the note Shopping?" }),
    true,
  );
  assert.deepEqual(events, [
    { id: "ask-1", state: "open", text: "Open the app Notepad?" },
    { id: "ask-1", state: "closed", allowed: true },
    { id: "ask-2", state: "open", text: "Delete the note Shopping?" },
    { id: "ask-2", state: "closed", allowed: true },
  ]);
});

test("the answer comes only from the box: the news can't change it", async () => {
  for (const answer of [true, false]) {
    const dialog = new FakePresenter(answer);
    const told: AskingEvent[] = [];
    // A listener that throws, or tries to answer by returning something, changes nothing.
    const presenter = announcingPresenter(dialog, (event) => {
      told.push(event);
      if (event.state === "open") throw new Error("the window is gone");
      return true as unknown as undefined;
    });
    assert.equal(await presenter.ask(request), answer);
    assert.deepEqual(told.at(-1), { id: "ask-1", state: "closed", allowed: answer });
    assert.deepEqual(dialog.asked, [request], "the box is asked exactly once, with the same request");
  }
  // Anything but a plain true from the box is not an Allow.
  const odd = announcingPresenter({ ask: async () => "yes" as unknown as boolean }, () => {});
  assert.equal(await odd.ask(request), false);
});

test("a box that fails counts as not allowed, and the card still hears it closed", async () => {
  const told: AskingEvent[] = [];
  const presenter = announcingPresenter(
    {
      ask: async () => {
        throw new Error("no display");
      },
    },
    (event) => told.push(event),
  );
  await assert.rejects(presenter.ask(request), /no display/);
  assert.deepEqual(told, [
    { id: "ask-1", state: "open", text: request.summary },
    { id: "ask-1", state: "closed", allowed: false },
  ]);
});

test("through the gate, the card's text is the very sentence the box shows", async (t) => {
  const told: AskingEvent[] = [];
  const dialog = new FakePresenter(false);
  const sage = createSage({
    dataDir: await tempDir(t),
    keyStores: memoryKeyStores(),
    presenter: announcingPresenter(dialog, (event) => told.push(event)),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    localPort: REFUSED_PORT,
  });
  const note = await sage.notes.add("Shopping", "milk");
  const result = await sage.registry.execute(toolCall("delete_note", { id: note.id }));
  assert.equal(result.ran, false, "declined in the box, so nothing ran");
  assert.equal(dialog.asked.length, 1);
  assert.deepEqual(told, [
    { id: "ask-1", state: "open", text: dialog.asked[0]!.summary },
    { id: "ask-1", state: "closed", allowed: false },
  ]);
  assert.ok(await sage.notes.get(note.id), "the note is still there");
});

test("only well-formed news reaches the page, with only its own fields", () => {
  assert.deepEqual(readAskingEvent({ id: "ask-3", state: "open", text: "Open it?", extra: "dropped" }), {
    id: "ask-3",
    state: "open",
    text: "Open it?",
  });
  assert.deepEqual(readAskingEvent({ id: "ask-3", state: "closed", allowed: false, reply: () => true }), {
    id: "ask-3",
    state: "closed",
    allowed: false,
  });
  const long = readAskingEvent({ id: "ask-4", state: "open", text: "x".repeat(MAX_ASKING_TEXT + 10) });
  assert.equal(long?.state === "open" && long.text.length, MAX_ASKING_TEXT);
  for (const bad of [
    null,
    "ask-1",
    {},
    { id: "call-1", state: "open", text: "x" },
    { id: "ask-1", state: "open", text: "  " },
    { id: "ask-1", state: "open", text: 3 },
    { id: "ask-1", state: "closed", allowed: "yes" },
    { id: "ask-1", state: "answer", allowed: true },
  ]) {
    assert.equal(readAskingEvent(bad), null, JSON.stringify(bad));
  }
});

test("nothing the window can call answers the box", async (t) => {
  // The news has its own name, which no handler answers to; the window's calls are the same as before.
  assert.ok(!(Object.values(CHANNELS) as string[]).includes(EVENTS.asking));
  for (const name of Object.keys(CHANNELS)) assert.doesNotMatch(name, /ask|allow|approv|confirm|answer/i);
  const sage = createSage({
    dataDir: await tempDir(t),
    keyStores: memoryKeyStores(),
    presenter: new FakePresenter(false),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    localPort: REFUSED_PORT,
  });
  const handlers = createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null });
  assert.deepEqual(Object.keys(handlers).sort(), Object.values(CHANNELS).sort());

  // main.ts: the box is wrapped, and the news is the only thing sent to the window.
  const main = await readFile(join(root, "src", "main", "main.ts"), "utf8");
  assert.match(main, /const presenter = announcingPresenter\(dialogPresenter, /);
  assert.deepEqual(
    [...main.matchAll(/webContents\.send\((\w+\.\w+)/g)].map((m) => m[1]),
    ["EVENTS.asking"],
  );
  assert.equal(main.match(/webContents\.send\(/g)?.length, 1);
  // The box itself still answers only with its own Allow button, Don't allow being the default.
  const box = main.slice(main.indexOf("const dialogPresenter"), main.indexOf("const presenter ="));
  assert.match(box, /buttons: \["Don't allow", "Allow"\],\s*defaultId: 0,\s*cancelId: 0,/);
  assert.match(box, /return answer\.response === 1;/);
});
