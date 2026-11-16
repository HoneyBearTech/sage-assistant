import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { encryptedKeyStores } from "../src/core/keystore.js";
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
    keyStores: encryptedKeyStores(dir, fakeEncryptor()),
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

  assert.deepEqual(await handlers[CHANNELS.setKey]({ brain: "other", key: SENTINEL, baseUrl: "" }), {
    ok: true,
  });
  const saved = await handlers[CHANNELS.saveSettings]({
    ...defaultSettings(),
    brain: "online",
    online: { baseUrl: service.url, model: "test-model", apiKey: SENTINEL },
    folders: [docs],
  });
  assert.equal((saved as { ok: boolean }).ok, true);

  const replies: unknown[] = [];
  replies.push(await handlers[CHANNELS.send]({ text: "do things" }));
  replies.push(await handlers[CHANNELS.send]({ text: "again" }));
  replies.push(await handlers[CHANNELS.send]({ text: "and again" }));
  const publicSettings = await handlers[CHANNELS.getSettings](undefined);
  assert.equal((publicSettings as any).keys.other, true);

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

test("the companies' keys never appear in any file, log line, reply, the chat or the window", async (t) => {
  const dir = await tempDir(t);
  const logLines: string[] = [];
  const CLAUDE = "SENTINEL-CLAUDE-must-never-appear-0123456789";
  const GEMINI = "SENTINEL-GEMINI-must-never-appear-0123456789";
  const OPENAI = "SENTINEL-OPENAI-must-never-appear-0123456789";
  let round = 0;
  // Fake services at the companies' fixed addresses that echo their key back in every way they can.
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = init.headers as Record<string, string>;
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://api.anthropic.com/v1/models")) {
      assert.equal(headers["x-api-key"], CLAUDE);
      return reply(200, { data: [{ id: CLAUDE }, { id: "claude-sonnet-5-5" }] });
    }
    if (url.startsWith("https://api.anthropic.com/")) {
      assert.equal(headers["x-api-key"], CLAUDE);
      round++;
      if (round === 1) {
        return reply(200, {
          content: [
            { type: "text", text: `echo ${CLAUDE}` },
            {
              type: "tool_use",
              id: "t1",
              name: "add_note",
              input: { title: CLAUDE, text: `the key is ${CLAUDE}` },
            },
          ],
        });
      }
      if (round === 2) return reply(200, { content: [{ type: "text", text: `Done. Key: ${CLAUDE}` }] });
      return reply(401, { type: "error", error: { type: "authentication_error", message: `bad ${CLAUDE}` } });
    }
    if (url.startsWith("https://generativelanguage.googleapis.com/")) {
      assert.equal(headers["x-goog-api-key"], GEMINI);
      assert.ok(!url.includes(GEMINI));
      return reply(200, {
        candidates: [
          {
            content: {
              parts: [
                { text: `gemini says ${GEMINI}` },
                {
                  functionCall: {
                    name: "add_reminder",
                    args: { text: GEMINI, due: new Date(Date.now() + 86_400_000).toISOString() },
                  },
                },
              ],
            },
          },
        ],
      });
    }
    assert.equal(headers.authorization, `Bearer ${OPENAI}`);
    return reply(429, { error: { type: "insufficient_quota", code: "insufficient_quota", message: OPENAI } });
  };
  const sage = createSage({
    dataDir: dir,
    keyStores: encryptedKeyStores(dir, fakeEncryptor()),
    presenter: new FakePresenter(true),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: (_level, line) => logLines.push(line),
    fetch,
  });
  const handlers = createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null });
  const answers: unknown[] = [];
  answers.push(await handlers[CHANNELS.setKey]({ brain: "claude", key: CLAUDE, baseUrl: "" }));
  answers.push(await handlers[CHANNELS.setKey]({ brain: "gemini", key: GEMINI, baseUrl: "" }));
  answers.push(await handlers[CHANNELS.setKey]({ brain: "openai", key: OPENAI, baseUrl: "" }));
  answers.push(await handlers[CHANNELS.saveSettings]({ ...defaultSettings(), brain: "claude" }));
  answers.push(await handlers[CHANNELS.send]({ text: "note it" }));
  answers.push(await handlers[CHANNELS.send]({ text: "again" }));
  answers.push(await handlers[CHANNELS.listModels]({ company: "claude" }));
  answers.push(await handlers[CHANNELS.testKey]({ company: "claude" }));
  answers.push(await handlers[CHANNELS.saveSettings]({ ...defaultSettings(), brain: "gemini" }));
  answers.push(await handlers[CHANNELS.send]({ text: "remind me" }));
  answers.push(await handlers[CHANNELS.saveSettings]({ ...defaultSettings(), brain: "openai" }));
  answers.push(await handlers[CHANNELS.send]({ text: "hello" }));
  answers.push(await handlers[CHANNELS.testKey]({ company: "openai" }));
  answers.push(await handlers[CHANNELS.getSettings](undefined));

  // The flows really ran.
  assert.ok(round >= 2);
  const [note] = await sage.notes.list();
  assert.equal(note?.text, "the key is [redacted]");
  assert.ok((await sage.reminders.list()).some((reminder) => reminder.text === "[redacted]"));
  assert.deepEqual((answers.at(-1) as { keys: unknown }).keys, {
    claude: true,
    openai: true,
    gemini: true,
    other: false,
  });
  assert.match(String(answers[11]), /credit or quota is used up/);
  sage.logger.error(`an accidental log line with ${CLAUDE} and ${GEMINI} and ${OPENAI}`);

  const files = await filesUnder(dir);
  for (const sentinel of [CLAUDE, GEMINI, OPENAI]) {
    const encodings = [
      sentinel,
      Buffer.from(sentinel).toString("base64"),
      Buffer.from(sentinel).toString("hex"),
    ];
    for (const file of files) {
      const content = await readFile(file, "latin1");
      for (const form of encodings) assert.ok(!content.includes(form), `${file} contains a key`);
    }
    for (const text of [...logLines, JSON.stringify(answers), JSON.stringify(sage.assistant.transcript)]) {
      assert.ok(!text.includes(sentinel), `leaked: ${text.slice(0, 200)}`);
    }
  }
});
