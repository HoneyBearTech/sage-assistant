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

test("Home draws the same orb, larger, hidden from screen readers, with its own gradient id", () => {
  const home = html.slice(html.indexOf('<div id="home-orb"'), html.indexOf('<p id="home-orb-state"'));
  assert.match(home, /class="orb orb-large"/);
  assert.match(home, /aria-hidden="true"/);
  assert.match(home, /<svg class="orb-art"/);
  assert.match(home, /fill="url\(#home-orb-core-fill\)"/);
  const ids = [...html.matchAll(/\sid="([\w-]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "every id in the page is used once");
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

test("the pause wins over every state's animation: core, rings, ripples and the glow", async () => {
  const css = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const pause = css.match(/\.orb\.paused,\s*\.orb\.paused::before,\s*\.orb\.paused \* \{([^}]*)\}/);
  assert.ok(pause, "the pause covers the orb, its glow and everything inside it");
  // The state rules are more specific and their animation shorthand resets the play state to
  // running, so only an !important pause beats them.
  assert.match(pause[1]!, /animation-play-state: paused !important;/);
  const pauseAt = css.indexOf(pause[0]);
  // Every animated part of every state is the orb's glow or something inside the orb, and comes
  // before the pause.
  const animated = [...css.matchAll(/([^{}]+)\{[^}]*\banimation(?:-name)?:\s*(?!none)[^;]+;/g)].filter((m) =>
    m[1]!.includes(".orb"),
  );
  assert.ok(animated.length >= 6);
  for (const match of animated) {
    for (const selector of match[1]!.split(",").map((part) => part.trim())) {
      if (!selector.startsWith(".orb[data-state=")) continue;
      assert.match(selector, /^\.orb\[data-state="\w+"\](::before| \.orb-[\w-]+)$/, selector);
      assert.ok(match.index! < pauseAt, `${selector} comes before the pause`);
    }
  }
  for (const part of ["core", "ticks", "ticks-major", "arcs", "inner", "ripple"]) {
    assert.ok(
      animated.some((match) => match[1]!.includes(`.orb-${part}`)),
      `.orb-${part} is animated somewhere`,
    );
  }
});

test("the orb's resting breath is Sage's own pace, slower than its thinking", async () => {
  const css = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const seconds = (state: string) => {
    const rule = css.match(
      new RegExp(
        `\\.orb\\[data-state="${state}"\\] \\.orb-core[^{]*\\{\\s*animation: orb-breathe ([\\d.]+)s`,
      ),
    );
    assert.ok(rule, `${state} breathes`);
    return Number(rule[1]);
  };
  const idle = seconds("idle");
  const thinking = seconds("thinking");
  assert.ok(
    idle >= 4 && idle <= 5,
    `resting breath ${idle}s: about 4.4 s, not the 3.4 to 3.6 s seen elsewhere`,
  );
  assert.ok(thinking < idle / 2, "thinking breathes clearly faster");
});
