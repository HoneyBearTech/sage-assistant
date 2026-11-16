import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { UNREACHABLE_MESSAGE } from "../src/core/brain/local.js";
import { encodeSavedKey, encryptedKeyStores, KEY_FILES, ServiceKeys } from "../src/core/keystore.js";
import { brainFor, createSage } from "../src/core/sage.js";
import { defaultSettings, type Settings } from "../src/core/settings.js";
import { createIpcHandlers } from "../src/main/ipc.js";
import { CHANNELS, privacyLine } from "../src/shared/api.js";
import { SETTINGS_CHANGED_REPLY } from "../src/core/assistant.js";
import {
  deferred,
  fakeEncryptor,
  fakeFetch,
  FakePresenter,
  fakeServer,
  json,
  jsonResponse,
  MemoryKeyStore,
  memoryKeyStores,
  REFUSED_PORT,
  settled,
  tempDir,
} from "./helpers.js";

// One key per company, each bound to that company's fixed address and checked at the moment of
// the request; another online service's key bound to the address it was entered for. Keys never
// mix and never reach the window.

const CLAUDE_KEY = "fake-claude-key-for-tests";
const OPENAI_KEY = "fake-openai-key-for-tests";
const GEMINI_KEY = "fake-gemini-key-for-tests";
const OTHER_KEY = "fake-other-key-for-tests";
const ALL_KEYS = [CLAUDE_KEY, OPENAI_KEY, GEMINI_KEY, OTHER_KEY];

/** The address with a user name and password in it (built here, so no file holds one). */
function withLogin(address: string): string {
  const url = new URL(address);
  url.username = "user";
  url.password = "secret";
  return url.href;
}

test("a company's key is handed out only for a request to that company's fixed address", async () => {
  const seen: string[] = [];
  const keys = new ServiceKeys(memoryKeyStores(), (key) => seen.push(key));
  await keys.setCompanyKey("claude", CLAUDE_KEY);
  await keys.setCompanyKey("gemini", GEMINI_KEY);
  assert.equal(await keys.keyForRequest("claude", "https://api.anthropic.com/v1/messages"), CLAUDE_KEY);
  assert.equal(
    await keys.keyForRequest("claude", "https://api.anthropic.com/v1/models?limit=1000"),
    CLAUDE_KEY,
  );
  for (const url of [
    "https://api.openai.com/v1/chat/completions",
    "http://api.anthropic.com/v1/messages",
    "https://api.anthropic.com:8443/v1/messages",
    "https://api.anthropic.com.evil.example/v1/messages",
    "https://evil.example/https://api.anthropic.com/",
    withLogin("https://api.anthropic.com/v1/messages"),
    "http://127.0.0.1:8080/v1/messages",
    "not an address",
  ]) {
    assert.equal(await keys.keyForRequest("claude", url), null, url);
  }
  // Another brain's slot never hands out this key, even for this company's address.
  assert.equal(await keys.keyForRequest("openai", "https://api.anthropic.com/v1/messages"), null);
  assert.equal(await keys.keyForRequest("other", "https://api.anthropic.com/v1/messages"), null);
  assert.equal(
    await keys.keyForRequest(
      "gemini",
      "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent",
    ),
    GEMINI_KEY,
  );
  assert.ok(seen.includes(CLAUDE_KEY) && seen.includes(GEMINI_KEY), "the redactor knows each key");
  await assert.rejects(keys.setCompanyKey("openai", "short"), /8 to 500/);
});

test("a company's key stored with any other address (a tampered file) is never handed out", async () => {
  const stores = memoryKeyStores();
  stores.claude = new MemoryKeyStore({ key: CLAUDE_KEY, origin: "https://evil.example" });
  const keys = new ServiceKeys(stores);
  assert.equal(await keys.keyForRequest("claude", "https://evil.example/v1/messages"), null);
  assert.equal(await keys.keyForRequest("claude", "https://api.anthropic.com/v1/messages"), null);
  stores.openai = new MemoryKeyStore({ key: OPENAI_KEY, origin: null });
  assert.equal(await keys.keyForRequest("openai", "https://api.openai.com/v1/chat/completions"), null);
});

test("keys are kept apart: saving, switching and removing one leaves the others as they were", async () => {
  const stores = memoryKeyStores();
  const keys = new ServiceKeys(stores);
  await keys.setCompanyKey("claude", CLAUDE_KEY);
  await keys.setCompanyKey("openai", OPENAI_KEY);
  await keys.setOtherKey(OTHER_KEY, "https://service.example");
  assert.deepEqual(await keys.hasKeys(), { claude: true, openai: true, gemini: false, other: true });
  assert.deepEqual(await stores.claude.get(), { key: CLAUDE_KEY, origin: "https://api.anthropic.com" });
  assert.deepEqual(await stores.openai.get(), { key: OPENAI_KEY, origin: "https://api.openai.com" });
  await keys.clear("openai");
  assert.deepEqual(await keys.hasKeys(), { claude: true, openai: false, gemini: false, other: true });
  // Another service's address moving away removes only that key.
  assert.equal(await keys.afterAddressSaved("https://elsewhere.example"), "removed");
  assert.deepEqual(await keys.hasKeys(), { claude: true, openai: false, gemini: false, other: false });
  assert.equal(await keys.keyForRequest("claude", "https://api.anthropic.com/v1/messages"), CLAUDE_KEY);
});

test("each brain sends only its own key, only to its own service", async () => {
  const fake = fakeFetch((call) => {
    if (call.url.startsWith("https://api.anthropic.com/")) {
      return jsonResponse(200, { content: [{ type: "text", text: "claude" }] });
    }
    if (call.url.startsWith("https://generativelanguage.googleapis.com/")) {
      return jsonResponse(200, { candidates: [{ content: { parts: [{ text: "gemini" }] } }] });
    }
    return jsonResponse(200, { choices: [{ message: { content: "chat" } }] });
  });
  const keys = new ServiceKeys(memoryKeyStores());
  await keys.setCompanyKey("claude", CLAUDE_KEY);
  await keys.setCompanyKey("openai", OPENAI_KEY);
  await keys.setCompanyKey("gemini", GEMINI_KEY);
  await keys.setOtherKey(OTHER_KEY, "https://service.example");
  const settings = (brain: Settings["brain"]): Settings => ({
    ...defaultSettings(),
    brain,
    online: { baseUrl: "https://service.example/v1", model: "m" },
  });
  for (const brain of ["claude", "openai", "gemini", "other"] as const) {
    const reply = await brainFor(settings(brain), keys, { fetch: fake.fetch }).chat(
      [{ role: "user", content: "hi" }],
      [],
    );
    assert.ok(reply.ok, brain);
  }
  const [claude, openai, gemini, other] = fake.calls;
  assert.equal(claude!.url, "https://api.anthropic.com/v1/messages");
  assert.equal(claude!.headers["x-api-key"], CLAUDE_KEY);
  assert.equal(JSON.parse(claude!.body).model, "claude-sonnet-5-5");
  assert.equal(openai!.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(openai!.headers.authorization, `Bearer ${OPENAI_KEY}`);
  assert.equal(JSON.parse(openai!.body).model, defaultSettings().services.openai.model);
  assert.equal(
    gemini!.url,
    `https://generativelanguage.googleapis.com/v1beta/models/${defaultSettings().services.gemini.model}:generateContent`,
  );
  assert.equal(gemini!.headers["x-goog-api-key"], GEMINI_KEY);
  assert.equal(other!.url, "https://service.example/v1/chat/completions");
  assert.equal(other!.headers.authorization, `Bearer ${OTHER_KEY}`);
  // Each request carries exactly one key: its own.
  for (const [call, own] of [
    [claude!, CLAUDE_KEY],
    [openai!, OPENAI_KEY],
    [gemini!, GEMINI_KEY],
    [other!, OTHER_KEY],
  ] as const) {
    const sent = JSON.stringify(call);
    for (const key of ALL_KEYS) assert.equal(sent.includes(key), key === own, `${call.url} and ${key}`);
  }
});

test("each key has its own encrypted file; the 0.1.1 file stays another online service's", async (t) => {
  const dir = await tempDir(t);
  assert.equal(KEY_FILES.other, "online-key.bin");
  assert.equal(new Set(Object.values(KEY_FILES)).size, 4);
  const keys = new ServiceKeys(encryptedKeyStores(dir, fakeEncryptor()));
  await keys.setCompanyKey("claude", CLAUDE_KEY);
  await keys.setCompanyKey("gemini", GEMINI_KEY);
  assert.deepEqual((await readdir(dir)).sort(), ["claude-key.bin", "gemini-key.bin"]);
  for (const name of await readdir(dir)) {
    const raw = await readFile(join(dir, name), "latin1");
    for (const key of ALL_KEYS) assert.ok(!raw.includes(key), `${name} holds a key in the clear`);
  }
  await keys.clear("claude");
  assert.deepEqual(await readdir(dir), ["gemini-key.bin"]);
});

test("without the system's key protection (Linux with no keyring), no company's key is stored", async (t) => {
  const dir = await tempDir(t);
  const keys = new ServiceKeys(encryptedKeyStores(dir, fakeEncryptor(false)));
  for (const company of ["claude", "openai", "gemini"] as const) {
    await assert.rejects(keys.setCompanyKey(company, CLAUDE_KEY), /won't store the key/);
  }
  await assert.rejects(keys.setOtherKey(OTHER_KEY, null), /won't store the key/);
  assert.deepEqual(await readdir(dir), []);
});

function sageAt(dir: string, extra: Partial<Parameters<typeof createSage>[0]> = {}) {
  const sage = createSage({
    dataDir: dir,
    keyStores: encryptedKeyStores(dir, fakeEncryptor()),
    presenter: new FakePresenter(false),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    localPort: REFUSED_PORT,
    ...extra,
  });
  return {
    sage,
    handlers: createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null }),
  };
}

test("Sage 0.1.1's online service, its settings and its saved key, keep working as Another online service", async (t) => {
  const dir = await tempDir(t);
  const service = await fakeServer(t, (_req, res) =>
    json(res, 200, { choices: [{ message: { content: "still here" } }] }),
  );
  // Exactly what Sage 0.1.1 wrote: the settings, and the key file with the key and its service.
  await writeFile(
    join(dir, "settings.json"),
    `${JSON.stringify(
      {
        version: 1,
        brain: "online",
        local: { model: "qwen3:4b" },
        online: { baseUrl: `${service.url}/v1`, model: "their-model" },
        apps: [],
        folders: [],
        speakReplies: "voice",
        setupDone: true,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(dir, "online-key.bin"),
    fakeEncryptor().encrypt(encodeSavedKey({ key: OTHER_KEY, origin: service.url })),
  );
  const { handlers } = sageAt(dir);
  const shown = (await handlers[CHANNELS.getSettings](undefined)) as Record<string, any>;
  assert.equal(shown.brain, "other");
  assert.deepEqual(shown.online, { baseUrl: `${service.url}/v1`, model: "their-model" });
  assert.deepEqual(shown.keys, { claude: false, openai: false, gemini: false, other: true });
  assert.equal(await handlers[CHANNELS.send]({ text: "hello" }), "still here");
  assert.equal(service.requests[0]!.headers.authorization, `Bearer ${OTHER_KEY}`);
  assert.equal(service.requests[0]!.url, "/v1/chat/completions");
  assert.equal(JSON.parse(service.requests[0]!.body).model, "their-model");
});

test("Sage 0.1.1's local brain stays on this computer", async (t) => {
  const dir = await tempDir(t);
  await writeFile(
    join(dir, "settings.json"),
    JSON.stringify({
      version: 1,
      brain: "local",
      local: { model: "qwen3:1.7b" },
      online: { baseUrl: "", model: "" },
      apps: [],
      folders: [],
      speakReplies: "voice",
      setupDone: true,
    }),
  );
  const { handlers } = sageAt(dir);
  const shown = (await handlers[CHANNELS.getSettings](undefined)) as Record<string, any>;
  assert.equal(shown.brain, "local");
  assert.equal(shown.local.model, "qwen3:1.7b");
  assert.deepEqual(shown.services, defaultSettings().services);
  assert.equal(await handlers[CHANNELS.send]({ text: "hello" }), UNREACHABLE_MESSAGE);
});

test("through the window's channels: a company's key is bound to its own address, whatever address is sent", async (t) => {
  const dir = await tempDir(t);
  const stores = memoryKeyStores();
  const { handlers } = sageAt(dir, { keyStores: stores });
  assert.deepEqual(
    await handlers[CHANNELS.setKey]({ brain: "claude", key: CLAUDE_KEY, baseUrl: "https://evil.example" }),
    { ok: true },
  );
  assert.deepEqual(await stores.claude.get(), { key: CLAUDE_KEY, origin: "https://api.anthropic.com" });
  assert.deepEqual(await handlers[CHANNELS.setKey]({ brain: "gemini", key: GEMINI_KEY, baseUrl: "" }), {
    ok: true,
  });
  // No address saved for another online service: its key waits for the first one, as before.
  assert.deepEqual(await handlers[CHANNELS.setKey]({ brain: "other", key: OTHER_KEY, baseUrl: "" }), {
    ok: true,
  });
  const shown = await handlers[CHANNELS.getSettings](undefined);
  assert.deepEqual((shown as { keys: unknown }).keys, {
    claude: true,
    openai: false,
    gemini: true,
    other: true,
  });
  for (const key of ALL_KEYS) assert.ok(!JSON.stringify(shown).includes(key), "no key reaches the window");

  assert.deepEqual(await handlers[CHANNELS.clearKey]({ brain: "gemini" }), { ok: true });
  assert.deepEqual(((await handlers[CHANNELS.getSettings](undefined)) as { keys: unknown }).keys, {
    claude: true,
    openai: false,
    gemini: false,
    other: true,
  });
  for (const bad of [undefined, {}, { brain: "local" }, { brain: "online" }, { brain: "claude", extra: 1 }]) {
    assert.equal(
      ((await handlers[CHANNELS.clearKey](bad)) as { ok: boolean }).ok,
      false,
      JSON.stringify(bad),
    );
  }
  assert.equal(await stores.claude.has(), true, "a refused request removes nothing");
  const refused = (await handlers[CHANNELS.setKey]({ brain: "openai", key: "short", baseUrl: "" })) as {
    ok: boolean;
    message: string;
  };
  assert.equal(refused.ok, false);
  assert.match(refused.message, /8 to 500/);
});

test("picking an online brain says once, on Save, what is sent to which company", async (t) => {
  const { handlers } = sageAt(await tempDir(t));
  const base = { ...defaultSettings() };
  assert.deepEqual(await handlers[CHANNELS.saveSettings]({ ...base, brain: "claude" }), {
    ok: true,
    message: privacyLine("claude"),
  });
  assert.match(privacyLine("claude"), /sent to Anthropic\.$/);
  assert.match(privacyLine("gemini"), /sent to Google\.$/);
  assert.match(privacyLine("openai"), /sent to OpenAI\.$/);
  // Saved again with the same brain: nothing more to say.
  assert.deepEqual(await handlers[CHANNELS.saveSettings]({ ...base, brain: "claude" }), { ok: true });
  assert.deepEqual(await handlers[CHANNELS.saveSettings]({ ...base, brain: "local" }), { ok: true });
  assert.deepEqual(await handlers[CHANNELS.saveSettings]({ ...base, brain: "gemini" }), {
    ok: true,
    message: privacyLine("gemini"),
  });
  const refused = (await handlers[CHANNELS.saveSettings]({ ...base, brain: "copilot" })) as { ok: boolean };
  assert.equal(refused.ok, false);
  const models = (await handlers[CHANNELS.saveSettings]({
    ...base,
    brain: "gemini",
    services: { ...base.services, gemini: { model: "x".repeat(201) } },
  })) as { ok: boolean };
  assert.equal(models.ok, false, "a model name is at most 200 characters");
});

test("a key must be printable ASCII: anything else gets a plain message and nothing is saved", async () => {
  const keys = new ServiceKeys(memoryKeyStores());
  for (const bad of [
    "fake-ключ-for-tests",
    "fake–dash–for-tests",
    "fake-key-\u0000-tests",
    "fake-key-🔑-tests",
  ]) {
    await assert.rejects(keys.setCompanyKey("claude", bad), /letters, digits and ordinary symbols/, bad);
    await assert.rejects(keys.setOtherKey(bad, null), /letters, digits and ordinary symbols/, bad);
  }
  await assert.rejects(keys.setCompanyKey("claude", "fake key with space"), /spaces/);
  assert.deepEqual(await keys.hasKeys(), { claude: false, openai: false, gemini: false, other: false });
  await keys.setCompanyKey("claude", "  sk-ant-api03-Fake_Key-For.Tests~0123  ");
  assert.equal(
    await keys.keyForRequest("claude", "https://api.anthropic.com/v1/messages"),
    "sk-ant-api03-Fake_Key-For.Tests~0123",
  );
});

test("changing the chosen brain's model, replacing or removing its key stops a turn in progress", async (t) => {
  const held: ReturnType<typeof deferred<Response>>[] = [];
  const fake = fakeFetch(() => {
    const reply = deferred<Response>();
    held.push(reply);
    return reply.promise;
  });
  const stores = memoryKeyStores();
  const { sage, handlers } = sageAt(await tempDir(t), { keyStores: stores, fetch: fake.fetch });
  await handlers[CHANNELS.setKey]({ brain: "claude", key: CLAUDE_KEY, baseUrl: "" });
  await handlers[CHANNELS.saveSettings]({ ...defaultSettings(), brain: "claude" });
  const answer = (text: string) =>
    jsonResponse(200, { content: [{ type: "text", text }], stop_reason: "end_turn" });
  const changes: [string, () => Promise<unknown>][] = [
    [
      "the model",
      () =>
        handlers[CHANNELS.saveSettings]({
          ...defaultSettings(),
          brain: "claude",
          services: { ...defaultSettings().services, claude: { model: "claude-opus-5-5" } },
        }),
    ],
    ["a new key", () => handlers[CHANNELS.setKey]({ brain: "claude", key: `${CLAUDE_KEY}-2`, baseUrl: "" })],
    ["the key removed", () => handlers[CHANNELS.clearKey]({ brain: "claude" })],
  ];
  for (const [what, change] of changes) {
    await handlers[CHANNELS.setKey]({ brain: "claude", key: CLAUDE_KEY, baseUrl: "" });
    const turn = handlers[CHANNELS.send]({ text: "hello" });
    await settled();
    await change();
    held.at(-1)!.resolve(answer("too late"));
    assert.equal(await turn, SETTINGS_CHANGED_REPLY, what);
  }
  // Another brain's key, or the same model saved again, leaves the turn alone.
  await handlers[CHANNELS.setKey]({ brain: "claude", key: CLAUDE_KEY, baseUrl: "" });
  await handlers[CHANNELS.saveSettings]({ ...defaultSettings(), brain: "claude" });
  for (const change of [
    () => handlers[CHANNELS.setKey]({ brain: "gemini", key: GEMINI_KEY, baseUrl: "" }),
    () => handlers[CHANNELS.clearKey]({ brain: "openai" }),
    () => handlers[CHANNELS.saveSettings]({ ...defaultSettings(), brain: "claude" }),
  ]) {
    const turn = handlers[CHANNELS.send]({ text: "hello" });
    await settled();
    await change();
    held.at(-1)!.resolve(answer("in time"));
    assert.equal(await turn, "in time");
  }
  assert.equal(sage.assistant.transcript.at(-1)?.content, "in time");
});
