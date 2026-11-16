import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { PULL_CODES, PULL_MESSAGES, pullCode } from "../src/core/brain/runner.js";
import {
  RUNNER_STATE_CODES,
  SETUP_STEP_LABELS,
  SUPPORT_CODE_LIST,
  SUPPORT_CODES,
} from "../src/shared/support-codes.js";

// The support codes (src/shared/support-codes.ts) and the Troubleshooting table in
// docs/installing.md: the same codes, each once.

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFile(join(root, path), "utf8");

/** The rows of the "Support codes" table, in order: the code and what it means. */
async function documentedRows(): Promise<{ code: string; meaning: string }[]> {
  const doc = await read("docs/installing.md");
  const start = doc.indexOf("### Support codes");
  assert.ok(start > doc.indexOf("## Troubleshooting"), "a Support codes part under Troubleshooting");
  const next = doc.indexOf("\n#", start + 1);
  const section = doc.slice(start, next === -1 ? undefined : next);
  assert.match(section, /^\| Code \| What it means \| What to try \|$/m);
  return [...section.matchAll(/^\| `([^`]+)` \|([^|]+)\|([^|]+)\|$/gm)].map((row) => {
    assert.ok(row[2]!.trim().length > 10 && row[3]!.trim().length > 10, `${row[1]} has a meaning and a fix`);
    return { code: row[1]!, meaning: row[2]!.trim() };
  });
}

/** The codes in the first column of the "Support codes" table, in order. */
async function documentedCodes(): Promise<string[]> {
  return (await documentedRows()).map((row) => row.code);
}

test("every code Sage can show is in the docs table once, and the table has no others", async () => {
  const documented = await documentedCodes();
  assert.equal(new Set(documented).size, documented.length, "no code twice");
  assert.deepEqual([...documented].sort(), [...SUPPORT_CODE_LIST].sort());
  for (const code of SUPPORT_CODE_LIST) assert.match(code, /^SAGE-[A-Z]{3}-\d{2}$/);
});

test("each docs row starts with the meaning the diagnostics text gives, so the two can't drift", async () => {
  for (const { code, meaning } of await documentedRows()) {
    const short = SUPPORT_CODES[code as keyof typeof SUPPORT_CODES];
    assert.ok(short, code);
    assert.ok(meaning.startsWith(short), `${code}: "${meaning}" starts with "${short}"`);
  }
});

test("each code in the table is one Sage really gives for a failure it can tell apart", async () => {
  // The codes come only from the table's type; here every one of them is used by a failure path.
  const sources: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (path.endsWith(".ts") && !path.endsWith("support-codes.ts")) sources.push(await read(path));
    }
  }
  await walk("src");
  const used = new Set<string>(Object.values(RUNNER_STATE_CODES));
  for (const text of sources)
    for (const match of text.matchAll(/"(SAGE-[A-Z]{3}-\d{2})"/g)) used.add(match[1]!);
  assert.deepEqual([...used].sort(), [...SUPPORT_CODE_LIST].sort());
});

test("each of the download's messages has its own code, and only known messages get one", () => {
  assert.deepEqual(Object.keys(PULL_CODES).sort(), Object.keys(PULL_MESSAGES).sort());
  for (const [key, message] of Object.entries(PULL_MESSAGES)) {
    assert.equal(pullCode(message), PULL_CODES[key as keyof typeof PULL_MESSAGES]);
  }
  assert.equal(pullCode("something the runner said"), "SAGE-MOD-01");
  assert.equal(new Set(Object.values(PULL_CODES)).size, Object.keys(PULL_CODES).length, "one code each");
  for (const code of Object.values(PULL_CODES)) assert.ok(code in SUPPORT_CODES);
});

test("the numbered step labels in the window match the shared list", async () => {
  const html = await read("src/renderer/index.html");
  for (const [step, label] of Object.entries(SETUP_STEP_LABELS)) {
    const heading = html.match(new RegExp(`<h2 id="step-${step}-heading" tabindex="-1">(.*?)</h2>`));
    assert.ok(heading, step);
    assert.equal(heading[1]!.replace(/<[^>]+>/g, ""), label);
    assert.match(heading[1]!, /^<span class="step-number">\d{2}<\/span> /);
  }
});

test("the README links to the support codes", async () => {
  assert.match(await read("README.md"), /\(docs\/installing\.md#support-codes\)/);
});
