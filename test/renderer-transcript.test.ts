import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { TYPE_MAX_MS, typedCount, typingDuration } from "../src/renderer/typing-time.js";
import { pressKey, setReducedMotion } from "./fake-dom.js";
import { deferred, settled } from "./helpers.js";
import { startWindow } from "./window.js";

// The chat as a transcript: rows labelled YOU and SAGE, and the newest reply typing itself out
// (src/renderer/typing.ts), run in the real window script on the fake DOM.

const css = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `styles.css has ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

test("rows are labelled YOU in amber and SAGE in the accent, with words for screen readers", () => {
  assert.match(rule(".message.user::before"), /content: "YOU" \/ "You:";\s*color: var\(--amber\);/);
  assert.match(rule(".message.assistant::before"), /content: "SAGE" \/ "Sage:";\s*color: var\(--accent\);/);
  // Notices keep their own dashed card.
  assert.match(rule(".message.notice"), /border: 1px dashed/);
});

test("each message is a row of its kind, its text set as text", async (t) => {
  const { el, texts } = await startWindow(t, async () => "Hi there.");
  el("input").value = "hello";
  el("composer").dispatch("submit");
  await settled();
  const rows = el("messages").children;
  assert.equal(rows[0]!.classList.contains("user"), true);
  assert.equal(rows[1]!.classList.contains("assistant"), true);
  assert.deepEqual(texts(), ["hello", "Hi there."]);
});

test("typing timing: fast, never over the cap, and all of it at the end", () => {
  assert.equal(typingDuration(10), 120);
  assert.equal(typingDuration(100_000), TYPE_MAX_MS);
  assert.ok(TYPE_MAX_MS <= 1_500);
  assert.equal(typingDuration(0), 0);
  assert.equal(typedCount(0, 0), 0);
  assert.equal(typedCount(100, 0), 0);
  assert.equal(typedCount(100, 600), 50);
  assert.equal(typedCount(100, TYPE_MAX_MS), 100);
  assert.equal(typedCount(100, 999_999), 100);
});

test("the newest reply types itself out over its full text, and ends on its own", async (t) => {
  const reply = "Here is a longer answer that takes a moment to type.";
  const { el, texts } = await startWindow(t, async () => reply);
  setReducedMotion(false);
  el("input").value = "tell me";
  el("composer").dispatch("submit");
  await settled();

  const row = el("messages").children[1]!;
  // The row holds the whole reply from the start: that is what screen readers and the tests read.
  assert.deepEqual(texts(), ["tell me", reply]);
  assert.equal(row.classList.contains("typing"), true);
  const overlay = row.children[0]!;
  assert.equal(overlay.className, "typed");
  assert.equal(overlay.getAttribute("aria-hidden"), "true");
  assert.equal(overlay.textContent, "", "nothing typed yet");

  t.mock.timers.tick(16 * 10);
  const partway = overlay.textContent;
  assert.ok(partway.length > 0 && partway.length < reply.length, `partway: ${partway}`);
  assert.ok(reply.startsWith(partway));

  t.mock.timers.tick(typingDuration(reply.length));
  assert.equal(overlay.textContent, reply);
  assert.equal(row.classList.contains("typing"), false, "done");
  assert.equal(row.children.length, 0, "the typed copy is gone; the row's own text shows");
});

test("a long reply is typed within the cap", async (t) => {
  const reply = "word ".repeat(2_000).trim();
  const { el } = await startWindow(t, async () => reply);
  setReducedMotion(false);
  el("input").value = "go";
  el("composer").dispatch("submit");
  await settled();
  const row = el("messages").children[1]!;
  assert.equal(row.classList.contains("typing"), true);
  t.mock.timers.tick(TYPE_MAX_MS + 16);
  assert.equal(row.classList.contains("typing"), false);
});

test("a click or any key shows the whole reply at once", async (t) => {
  const { el } = await startWindow(t, async () => "A reply to skip through quickly.");
  setReducedMotion(false);
  const document = (globalThis as any).document;
  for (const skip of [
    () => document.dispatch("pointerdown", {}),
    () => pressKey("keydown", { key: "Escape" }),
  ]) {
    el("input").value = "again";
    el("composer").dispatch("submit");
    await settled();
    const row = el("messages").children.at(-1)!;
    assert.equal(row.classList.contains("typing"), true);
    t.mock.timers.tick(32);
    skip();
    assert.equal(row.classList.contains("typing"), false);
    assert.equal(row.children.length, 0);
  }
});

test("with reduced motion, or a reply that failed, the text appears at once", async (t) => {
  const answers = [
    async () => "No typing here.",
    async () => {
      throw new Error("down");
    },
  ];
  const { el, texts } = await startWindow(t, () => answers.shift()!());
  setReducedMotion(true);
  el("input").value = "one";
  el("composer").dispatch("submit");
  await settled();
  const row = el("messages").children[1]!;
  assert.equal(row.classList.contains("typing"), false);
  assert.equal(row.children.length, 0);

  setReducedMotion(false);
  el("input").value = "two";
  el("composer").dispatch("submit");
  await settled();
  assert.deepEqual(texts().slice(2), ["two", "Something went wrong. Try again."]);
  assert.equal(el("messages").children[3]!.classList.contains("typing"), false);
});

test("a newer reply ends the older one's typing, and New chat ends it too", async (t) => {
  const second = deferred<string>();
  const answers = [Promise.resolve("First reply, typing."), second.promise];
  const { el, texts } = await startWindow(t, () => answers.shift()!);
  setReducedMotion(false);
  el("input").value = "one";
  el("composer").dispatch("submit");
  await settled();
  const first = el("messages").children[1]!;
  assert.equal(first.classList.contains("typing"), true);

  el("input").value = "two";
  el("composer").dispatch("submit");
  await settled();
  second.resolve("Second reply, typing too.");
  await settled();
  assert.equal(first.classList.contains("typing"), false, "only the newest reply types");
  const newest = el("messages").children[3]!;
  assert.equal(newest.classList.contains("typing"), true);

  el("new-chat").click();
  await settled();
  assert.deepEqual(texts(), []);
  assert.equal(newest.classList.contains("typing"), false);
  t.mock.timers.tick(TYPE_MAX_MS);
});

test("reduced motion switched on while a reply types shows the rest at once", async (t) => {
  const reply = "A reply long enough to still be typing when the setting changes.";
  const { el } = await startWindow(t, async () => reply);
  setReducedMotion(false);
  el("input").value = "go";
  el("composer").dispatch("submit");
  await settled();
  const row = el("messages").children[1]!;
  t.mock.timers.tick(32);
  assert.equal(row.classList.contains("typing"), true, "typing");

  setReducedMotion(true);
  t.mock.timers.tick(16);
  assert.equal(row.classList.contains("typing"), false, "the whole reply, at the next step");
  assert.equal(row.children.length, 0);
});
