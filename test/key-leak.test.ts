import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { EncryptedFileKeyStore } from "../src/core/keystore.js";
import { createSage } from "../src/core/sage.js";
import { defaultSettings } from "../src/core/settings.js";
import { createIpcHandlers } from "../src/main/ipc.js";
import { CHANNELS } from "../src/shared/api.js";
import { fakeEncryptor, fakeServer, FakePresenter, json, tempDir } from "./helpers.js";

// The online key must never be written to settings, logs, the action log or chat history.
// This test stores a sentinel key, uses every flow that touches it, then searches every file Sage
// wrote and every log line for it, in plain text and in base64.

const SENTINEL = "SENTINEL-KEY-must-never-appear-0123456789";

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(path)));
    else out.push(path);
  }
  return out;
}

test("the online key never appears in any file, log line, reply or the chat history", async (t) => {
  const dir = await tempDir(t);
  const logLines: string[] = [];
  const docs = join(dir, "docs");
  await mkdir(docs);
  await writeFile(join(docs, "plan.txt"), "plan");
  let round = 0;
  // A fake online service that checks the key, then echoes it back in every way it can.
  const service = await fakeServer(t, (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${SENTINEL}`);
    round++;
    if (round === 1) {
      return json(res, 200, {
        choices: [
          {
            message: {
              content: `echo ${SENTINEL}`,
              tool_calls: [
                {
                  id: "1",
                  type: "function",
                  function: {
                    name: "add_note",
                    arguments: JSON.stringify({ title: `key ${SENTINEL}`, text: `the key is ${SENTINEL}` }),
                  },
                },
                {
                  id: "2",
                  type: "function",
                  function: { name: "delete_note", arguments: JSON.stringify({ id: SENTINEL }) },
                },
                {
                  id: "3",
                  type: "function",
                  function: { name: "open_app", arguments: JSON.stringify({ name: SENTINEL }) },
                },
                {
                  id: "4",
                  type: "function",
                  function: { name: "web_search", arguments: JSON.stringify({ query: "x" }) },
                },
                {
                  id: "5",
                  type: "function",
                  function: {
                    name: "open_file",
                    arguments: JSON.stringify({ path: join(docs, "plan.txt") }),
                  },
                },
              ],
            },
          },
        ],
      });
    }
    if (round === 2) return json(res, 401, { error: `invalid key ${SENTINEL}` });
    // A successful reply that echoes the key in its text, its <think> block and a tool call.
    if (round === 3) {
      return json(res, 200, {
        choices: [
          {
            message: {
              content: `<think>${SENTINEL}</think>Your key is ${SENTINEL}.`,
              tool_calls: [
                {
                  id: "6",
                  type: "function",
                  function: { name: "add_reminder", arguments: { text: SENTINEL, due: "2099-01-01T00:00" } },
                },
              ],
            },
          },
        ],
      });
    }
    return json(res, 200, { choices: [{ message: { content: `All done. Your key is ${SENTINEL}` } }] });
  });

  const presenter = new FakePresenter(true);
  const sage = createSage({
    dataDir: dir,
    keyStore: new EncryptedFileKeyStore(join(dir, "online-key.bin"), fakeEncryptor()),
    presenter,
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: (_level, line) => logLines.push(line),
    search: {
      name: "Fake",
      search: async () => ({
        ok: true,
        results: [{ title: SENTINEL, url: "https://example.com", snippet: SENTINEL }],
      }),
    },
  });
  const handlers = createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null });

  assert.deepEqual(await handlers[CHANNELS.setKey]({ key: SENTINEL }), { ok: true });
  const saved = await handlers[CHANNELS.saveSettings]({
    ...defaultSettings(),
    brain: "online",
    online: { baseUrl: service.url, model: "test-model", apiKey: SENTINEL },
    folders: [docs],
  });
  assert.deepEqual(saved, { ok: true });

  const replies: unknown[] = [];
  replies.push(await handlers[CHANNELS.send]({ text: "do things" }));
  replies.push(await handlers[CHANNELS.send]({ text: "again" }));
  replies.push(await handlers[CHANNELS.send]({ text: "and again" }));
  const publicSettings = await handlers[CHANNELS.getSettings](undefined);
  assert.equal((publicSettings as any).online.hasKey, true);

  // Make sure the flows really ran (otherwise the scan proves nothing).
  assert.ok(round >= 4);
  const [note] = await sage.notes.list();
  assert.equal(note?.text, "the key is [redacted]", "the add_note handler got the cleaned arguments");
  assert.equal(note?.title, "key [redacted]");
  assert.match(String(replies.at(-1)), /All done\. Your key is \[redacted\]/);
  assert.ok((await readdir(dir)).includes("notes.json"));
  assert.ok((await readdir(dir)).includes("action-log.jsonl"));
  sage.logger.error(`a log line that mentions ${SENTINEL} by accident`);

  const encodings = [
    SENTINEL,
    Buffer.from(SENTINEL).toString("base64"),
    Buffer.from(SENTINEL).toString("hex"),
  ];
  const files = await filesUnder(dir);
  assert.ok(files.length >= 4);
  for (const file of files) {
    const content = await readFile(file, "latin1");
    for (const form of encodings) assert.ok(!content.includes(form), `${file} contains the key`);
  }
  const everythingElse = [
    ...logLines,
    JSON.stringify(replies),
    JSON.stringify(publicSettings),
    JSON.stringify(sage.assistant.transcript),
    JSON.stringify(presenter.asked),
  ];
  for (const text of everythingElse) assert.ok(!text.includes(SENTINEL), `leaked: ${text.slice(0, 200)}`);
  assert.ok(
    logLines.some((line) => line.includes("[redacted]")),
    "the redactor was exercised",
  );
});
