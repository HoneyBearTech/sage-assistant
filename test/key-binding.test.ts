import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { SETTINGS_CHANGED_REPLY } from "../src/core/assistant.js";
import { ServiceKeys } from "../src/core/keystore.js";
import { brainFor, createSage } from "../src/core/sage.js";
import { defaultSettings } from "../src/core/settings.js";
import { createIpcHandlers } from "../src/main/ipc.js";
import { CHANNELS } from "../src/shared/api.js";
import { fakeServer, FakePresenter, json, MemoryKeyStore, tempDir } from "./helpers.js";

// A key belongs to the service it was entered for. A turn that started against service A must
// never send service B's key to A, even if the user switches to B and saves B's key mid-turn.

const KEY_A = "fake-key-for-service-a";
const KEY_B = "fake-key-for-service-b";

function toolCallReply() {
  return {
    choices: [
      {
        message: {
          content: "",
          tool_calls: [{ id: "1", type: "function", function: { name: "list_notes", arguments: "{}" } }],
        },
      },
    ],
  };
}

function online(baseUrl: string) {
  return { ...defaultSettings(), brain: "online", online: { baseUrl, model: "m" } };
}

test("switching services mid-turn: the old service never receives the new service's key", async (t) => {
  let paused: ServerResponse | undefined;
  let gotFirst!: () => void;
  const firstArrived = new Promise<void>((resolve) => {
    gotFirst = resolve;
  });
  const serviceA = await fakeServer(t, (_req, res) => {
    if (!paused) {
      paused = res;
      gotFirst();
      return;
    }
    json(res, 200, { choices: [{ message: { content: "done" } }] });
  });
  const serviceB = await fakeServer(t, (_req, res) =>
    json(res, 200, { choices: [{ message: { content: "b" } }] }),
  );
  const sage = createSage({
    dataDir: await tempDir(t),
    keyStore: new MemoryKeyStore(),
    presenter: new FakePresenter(false),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
  });
  const handlers = createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null });

  assert.deepEqual(await handlers[CHANNELS.saveSettings](online(serviceA.url)), { ok: true });
  assert.deepEqual(await handlers[CHANNELS.setKey]({ key: KEY_A, baseUrl: serviceA.url }), { ok: true });

  // Service A holds its reply while the user moves to service B and saves B's key.
  const reply = handlers[CHANNELS.send]({ text: "what notes do I have?" });
  await firstArrived;
  const moved = (await handlers[CHANNELS.saveSettings](online(serviceB.url))) as {
    ok: boolean;
    message?: string;
  };
  assert.equal(moved.ok, true);
  assert.match(moved.message ?? "", /saved key was removed/);
  assert.deepEqual(await handlers[CHANNELS.setKey]({ key: KEY_B, baseUrl: serviceB.url }), { ok: true });

  // Now A answers with a tool call; the old turn must stop instead of going back to A.
  json(paused!, 200, toolCallReply());
  assert.equal(await reply, SETTINGS_CHANGED_REPLY);
  assert.equal(serviceA.requests.length, 1, "no follow-up request to service A");
  assert.equal(serviceA.requests[0]!.headers.authorization, `Bearer ${KEY_A}`);
  assert.ok(serviceA.requests.every((r) => !JSON.stringify(r).includes(KEY_B)));
  assert.equal(serviceB.requests.length, 0);

  // The next message goes to B, with B's key, and the chat wasn't cleared by the switch.
  assert.equal(await handlers[CHANNELS.send]({ text: "hello" }), "b");
  assert.equal(serviceB.requests[0]!.headers.authorization, `Bearer ${KEY_B}`);
  assert.equal(sage.assistant.transcript.length, 2);
});

test("a turn's brain only ever gets the key of its own service", async (t) => {
  const serviceA = await fakeServer(t, (_req, res) => json(res, 200, toolCallReply()));
  const keys = new ServiceKeys(new MemoryKeyStore());
  await keys.set(KEY_A, new URL(serviceA.url).origin);
  const brainA = brainFor(online(serviceA.url) as never, keys, {});
  assert.ok((await brainA.chat([], [])).ok);
  assert.equal(serviceA.requests[0]!.headers.authorization, `Bearer ${KEY_A}`);

  // The key now belongs to another service: the same brain sends nothing to A at all.
  await keys.set(KEY_B, "https://b.example");
  const again = await brainA.chat([], []);
  assert.equal(again.ok, false);
  assert.match(!again.ok ? again.message : "", /key/);
  assert.equal(serviceA.requests.length, 1);

  // A brain for a service with no usable address never asks for a key.
  const nowhere = brainFor(online("not a url") as never, keys, {});
  assert.equal((await nowhere.chat([], [])).ok, false);
});
