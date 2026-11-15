import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// The window has no DOM in these tests, so these check the renderer's source for the behaviour
// that matters: unsaved settings aren't thrown away.
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

test("settings are loaded at startup and after a successful save, and save messages are shown", () => {
  const loads = [...source.matchAll(/(?:void|await) loadSettings\(\)/g)].length;
  assert.equal(loads, 2, "once at startup, once after a successful save");
  assert.match(source, /\nvoid loadSettings\(\);\n/);
  assert.match(source, /result\.message \? `Saved\. \$\{result\.message\}`/);
});
