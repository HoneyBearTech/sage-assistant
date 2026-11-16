import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { ORB_CAPTIONS, orbState } from "../src/renderer/orb-state.js";
import { pressKey, setWindowVisibility } from "./fake-dom.js";
import { deferred, settled } from "./helpers.js";
import { startWindow } from "./window.js";

// The orb above the message box (src/renderer/orb.ts), run in the real window script on the fake DOM.

const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
const ctrlSpace = { ctrlKey: true, code: "Space", key: " " };

test("the orb shows your voice first, then Sage's, then thinking", () => {
  const none = { listening: false, thinking: false, speaking: false };
  assert.equal(orbState(none), "idle");
  assert.equal(orbState({ ...none, thinking: true }), "thinking");
  assert.equal(orbState({ ...none, thinking: true, speaking: true }), "speaking");
  assert.equal(orbState({ listening: true, thinking: true, speaking: true }), "listening");
  assert.deepEqual(Object.keys(ORB_CAPTIONS).sort(), ["idle", "listening", "speaking", "thinking"]);
});

test("the orb is drawn in the page itself, and Hold to talk stays a real button", () => {
  const orb = html.slice(html.indexOf('<div id="orb"'), html.indexOf('<p id="orb-state"'));
  assert.match(orb, /<svg class="orb-art"/);
  assert.match(orb, /aria-hidden="true"/, "the word under it says the state; the drawing is decoration");
  assert.doesNotMatch(html, /<img|<video|<canvas|<audio|<object|<iframe/);
  assert.doesNotMatch(orb, /\shref=|\sstyle=/);
  assert.match(html, /<button\s+type="button"\s+id="talk"[\s\S]*?>\s*Hold to talk\s*<\/button>/);
});

test("the orb rests, thinks while a reply is on its way, and rests again", async (t) => {
  const reply = deferred<string>();
  const { el } = await startWindow(t, () => reply.promise);
  const orb = el("orb");
  assert.equal(orb.getAttribute("data-state"), "idle");
  assert.equal(el("orb-state").textContent, "Ready");

  el("input").value = "what's on today?";
  el("composer").dispatch("submit");
  await settled();
  assert.equal(orb.getAttribute("data-state"), "thinking");
  assert.equal(el("orb-state").textContent, "Thinking");

  reply.resolve("Nothing yet.");
  await settled();
  assert.equal(orb.getAttribute("data-state"), "idle");
  assert.equal(el("orb-state").textContent, "Ready");
});

test("New chat stops the thinking at once, and the old reply doesn't start it again", async (t) => {
  const reply = deferred<string>();
  const { el } = await startWindow(t, () => reply.promise);
  el("input").value = "hello";
  el("composer").dispatch("submit");
  await settled();
  assert.equal(el("orb").getAttribute("data-state"), "thinking");
  el("new-chat").click();
  assert.equal(el("orb").getAttribute("data-state"), "idle");
  reply.resolve("late");
  await settled();
  assert.equal(el("orb").getAttribute("data-state"), "idle");
});

test("the orb listens while the talk key is held, over the thinking, and goes back after", async (t) => {
  const reply = deferred<string>();
  const { el } = await startWindow(t, () => reply.promise);
  el("input").value = "first";
  el("composer").dispatch("submit");
  await settled();

  pressKey("keydown", ctrlSpace);
  await settled();
  assert.equal(el("orb").getAttribute("data-state"), "listening");
  assert.equal(el("orb-state").textContent, "Listening");
  t.mock.timers.tick(1_000);
  pressKey("keyup", { key: "Control", code: "ControlLeft" });
  await settled();
  assert.equal(el("orb").getAttribute("data-state"), "thinking", "the reply is still on its way");

  reply.resolve("done");
  await settled();
  await settled();
  assert.equal(el("orb").getAttribute("data-state"), "idle");
});

test("the orb speaks while a reply is read aloud, and rests when it ends or is stopped", async (t) => {
  const { el, media } = await startWindow(
    t,
    async () => "Here you are.",
    {},
    {
      settings: { speakReplies: "always" },
    },
  );
  el("input").value = "read it to me";
  el("composer").dispatch("submit");
  await settled();
  assert.equal(media.speech.spoken.length, 1);
  assert.equal(el("orb").getAttribute("data-state"), "speaking");
  assert.equal(el("orb-state").textContent, "Speaking");
  media.speech.finish();
  assert.equal(el("orb").getAttribute("data-state"), "idle");

  el("input").value = "again";
  el("composer").dispatch("submit");
  await settled();
  assert.equal(el("orb").getAttribute("data-state"), "speaking");
  el("stop-speaking").click();
  assert.equal(el("orb").getAttribute("data-state"), "idle");
});

test("the orb's animation pauses while the window is hidden", async (t) => {
  const { el } = await startWindow(t, async () => "");
  assert.equal(el("orb").classList.contains("paused"), false);
  setWindowVisibility("hidden");
  assert.equal(el("orb").classList.contains("paused"), true);
  setWindowVisibility("visible");
  assert.equal(el("orb").classList.contains("paused"), false);
});
