import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// CONTRIBUTING.md: tests use mocked timers or events, never sleeps or real timeouts, and no
// free-port tricks. This keeps the rule from quietly coming back.

const testDir = fileURLToPath(new URL(".", import.meta.url));

async function testSources(): Promise<{ name: string; text: string }[]> {
  const names = (await readdir(testDir)).filter((name) => name.endsWith(".ts"));
  return Promise.all(
    names.map(async (name) => ({ name, text: await readFile(join(testDir, name), "utf8") })),
  );
}

test("no test sleeps on a real timer", async () => {
  const sleep = /setTimeout\(\s*(?:resolve|r|res|done)\b/;
  for (const { name, text } of await testSources()) {
    assert.doesNotMatch(text, sleep, `${name} sleeps; wait for an event or use mocked timers`);
  }
});

test("no test picks a free port and closes it again", async () => {
  for (const { name, text } of await testSources()) {
    // Listening on port 0 is fine for a server the test keeps open; closing it straight after
    // reading its port is the race.
    assert.doesNotMatch(
      text,
      /listen\(0[\s\S]{0,200}?address\(\)[\s\S]{0,200}?\.close\(/,
      `${name} frees a port it picked; use REFUSED_PORT or keep the server open`,
    );
  }
});

test("the rule is written down for contributors", async () => {
  const contributing = await readFile(new URL("../CONTRIBUTING.md", import.meta.url), "utf8");
  assert.match(contributing, /Tests use mocked timers or events, never sleeps or real timeouts/);
  assert.match(contributing, /No free-port tricks/);
});
