import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { SETTINGS_CHANGED_REPLY } from "../src/core/assistant.js";
import { createSage } from "../src/core/sage.js";
import { defaultSettings } from "../src/core/settings.js";
import { createIpcHandlers } from "../src/main/ipc.js";
import { CHANNELS, privacyLine } from "../src/shared/api.js";
import { deferred, FakePresenter, fakeServer, json, memoryKeyStores, tempDir } from "./helpers.js";

// A model download from the Welcome screen switches the brain to local. A turn that started
// against the online service stops, as it does when Settings changes the brain: the old service's
// late reply runs no skill and gets nothing more.

const KEY = "fake-key-for-the-online-service";

test("switching to local through setup stops a turn running on the online service", async (t) => {
  let paused: ServerResponse | undefined;
  const arrived = deferred<void>();
  const service = await fakeServer(t, (_req, res) => {
    paused = res;
    arrived.resolve();
  });
  // The local model runner, which already has Sage's Standard model.
  const runner = await fakeServer(t, (req, res) => {
    if (req.url === "/api/tags") return json(res, 200, { models: [{ name: "qwen3:4b" }] });
    if (req.url === "/api/show") return json(res, 200, { capabilities: ["tools"] });
    json(res, 200, { message: { role: "assistant", content: "local answer" } });
  });
  const sage = createSage({
    dataDir: await tempDir(t),
    keyStores: memoryKeyStores(),
    presenter: new FakePresenter(true),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    localPort: runner.port,
  });
  const handlers = createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null });
  const online = { ...defaultSettings(), brain: "online", online: { baseUrl: service.url, model: "m" } };
  // The settings file from before the list of brains said "online": it is another online service.
  assert.deepEqual(await handlers[CHANNELS.saveSettings](online), {
    ok: true,
    message: privacyLine("other"),
  });
  assert.deepEqual(await handlers[CHANNELS.setKey]({ brain: "other", key: KEY, baseUrl: service.url }), {
    ok: true,
  });

  const reply = handlers[CHANNELS.send]({ text: "what notes do I have?" });
  await arrived.promise;
  assert.deepEqual(await handlers[CHANNELS.pullModel]({ choice: "standard" }), {
    status: "done",
    skills: "yes",
  });
  assert.equal((await sage.settings.load()).brain, "local");

  // The online service now answers with a skill call; the stopped turn runs nothing.
  json(paused!, 200, {
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "1",
              type: "function",
              function: { name: "add_note", arguments: '{"title":"From the old service","text":"x"}' },
            },
          ],
        },
      },
    ],
  });
  assert.equal(await reply, SETTINGS_CHANGED_REPLY);
  assert.deepEqual(await sage.notes.list(), [], "the skill didn't run");
  assert.equal(service.requests.length, 1, "nothing more goes to the online service");
  assert.equal(
    runner.requests.filter((req) => req.url === "/api/chat").length,
    0,
    "the old turn doesn't carry on with the local brain",
  );
  // The next message goes to the local model.
  assert.equal(await handlers[CHANNELS.send]({ text: "hello" }), "local answer");
  assert.equal(service.requests.length, 1);
});
