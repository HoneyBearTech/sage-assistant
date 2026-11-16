import assert from "node:assert/strict";
import { test } from "node:test";
import { ServiceKeys } from "../src/core/keystore.js";
import {
  COOLDOWN_MS,
  cleanModelNames,
  MAX_MODELS,
  MODELS_URLS,
  OnlineServices,
  PAGE_DETAIL,
  PAGE_QUESTION,
} from "../src/core/online-services.js";
import { createSage } from "../src/core/sage.js";
import { createIpcHandlers } from "../src/main/ipc.js";
import { CHANNELS } from "../src/shared/api.js";
import {
  captureLogs,
  deferred,
  fakeFetch,
  FakePresenter,
  jsonResponse,
  memoryKeyStores,
  settled,
  tempDir,
} from "./helpers.js";

// Load models, Test and Get a key: the window names a company; the addresses are fixed here.

const KEYS = {
  claude: "fake-claude-key-for-tests",
  openai: "fake-openai-key-for-tests",
  gemini: "fake-gemini-key-for-tests",
};

async function services(handler: Parameters<typeof fakeFetch>[0], options: { withKeys?: boolean } = {}) {
  const keys = new ServiceKeys(memoryKeyStores());
  if (options.withKeys !== false) {
    for (const company of ["claude", "openai", "gemini"] as const)
      await keys.setCompanyKey(company, KEYS[company]);
  }
  const fake = fakeFetch(handler);
  const opened: string[] = [];
  const asked: [string, string][] = [];
  const { logger, lines } = captureLogs();
  let answer: boolean | Error = true;
  let browser: Error | undefined;
  // The clock moves on a minute with every reading unless a test holds it, so the cooldown between
  // checks only applies where a test asks for it.
  const clock = { now: 0, step: 60_000 };
  const online = new OnlineServices({
    keys,
    logger,
    fetch: fake.fetch,
    now: () => (clock.now += clock.step),
    confirmOpenPage: async (question, detail) => {
      asked.push([question, detail]);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    openExternal: async (url) => {
      if (browser) throw browser;
      opened.push(url);
    },
  });
  return {
    online,
    calls: fake.calls,
    opened,
    asked,
    lines,
    clock,
    answer: (value: boolean | Error) => {
      answer = value;
    },
    browserFails: (error: Error) => {
      browser = error;
    },
  };
}

test("Load models asks each company at its fixed address, with its own key and headers", async () => {
  const { online, calls } = await services((call) => {
    if (call.url.startsWith("https://api.anthropic.com/")) {
      return jsonResponse(200, {
        data: [
          { type: "model", id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" },
          { type: "model", id: "claude-opus-5-5" },
        ],
        has_more: false,
      });
    }
    if (call.url.startsWith("https://api.openai.com/")) {
      return jsonResponse(200, {
        object: "list",
        data: [
          { id: "gpt-6-astra", object: "model" },
          { id: "text-embedding-3-small" },
          { id: "gpt-6-luna" },
          { id: "whisper-1" },
          { id: "dall-e-3" },
        ],
      });
    }
    return jsonResponse(200, {
      models: [
        { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
        { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
        { name: "models/gemini-3.6-flash" },
      ],
    });
  });
  assert.deepEqual(await online.listModels("claude"), {
    ok: true,
    models: ["claude-opus-5-5", "claude-sonnet-5-5"],
  });
  assert.deepEqual(await online.listModels("openai"), { ok: true, models: ["gpt-6-astra", "gpt-6-luna"] });
  assert.deepEqual(await online.listModels("gemini"), {
    ok: true,
    models: ["gemini-3.6-flash", "gemini-3.8-flash"],
  });
  const [claude, openai, gemini] = calls;
  assert.equal(claude!.url, "https://api.anthropic.com/v1/models?limit=1000");
  assert.equal(claude!.method, "GET");
  assert.deepEqual(claude!.headers, {
    "x-api-key": KEYS.claude,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  });
  assert.equal(openai!.url, "https://api.openai.com/v1/models");
  assert.deepEqual(openai!.headers, { authorization: `Bearer ${KEYS.openai}` });
  assert.equal(gemini!.url, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
  assert.deepEqual(gemini!.headers, { "x-goog-api-key": KEYS.gemini });
  assert.ok(calls.every((call) => call.redirect === "error"));
  assert.deepEqual(Object.values(MODELS_URLS), [claude!.url, openai!.url, gemini!.url]);
});

test("model names are plain, each once, sorted and capped; anything else is left out", () => {
  assert.deepEqual(
    cleanModelNames(["b", "a", "b", "has space", "<tag>", "", "x".repeat(201), "ok:tag/1.0"]),
    ["a", "b", "ok:tag/1.0"],
  );
  const many = Array.from(
    { length: MAX_MODELS + 50 },
    (_, index) => `model-${String(index).padStart(4, "0")}`,
  );
  assert.equal(cleanModelNames(many).length, MAX_MODELS);
});

test("without a saved key nothing is sent; a refused key or an odd answer gets a plain message", async () => {
  const empty = await services(() => jsonResponse(200, { data: [] }), { withKeys: false });
  assert.deepEqual(await empty.online.listModels("claude"), {
    ok: false,
    message: "Save a Claude key first.",
  });
  assert.deepEqual(await empty.online.testKey("gemini"), { ok: false, message: "Save a Gemini key first." });
  assert.equal(empty.calls.length, 0);

  let status = 401;
  let body: unknown = { error: { type: "invalid_request_error", message: `bad key ${KEYS.openai}` } };
  const failing = await services(() => jsonResponse(status, body));
  const refused = await failing.online.testKey("openai");
  assert.ok(!refused.ok);
  assert.match(refused.message, /^OpenAI didn't accept the key/);
  assert.ok(!refused.message.includes(KEYS.openai));
  status = 429;
  body = { error: { type: "insufficient_quota", code: "insufficient_quota", message: "pay up" } };
  const quota = await failing.online.listModels("openai");
  assert.ok(!quota.ok && /credit or quota is used up/.test(quota.message));
  status = 200;
  body = { data: "nope" };
  assert.deepEqual(await failing.online.listModels("claude"), {
    ok: false,
    message: "Claude sent a reply Sage couldn't read.",
  });
  body = { models: [{ name: `models/${KEYS.gemini}` }, { name: "models/gemini-ok" }] };
  assert.deepEqual(
    await failing.online.listModels("gemini"),
    { ok: true, models: ["gemini-ok"] },
    "an echoed key is left out",
  );
});

test("Test checks the saved key with the free model list and says so plainly", async () => {
  const { online, calls } = await services(() => jsonResponse(200, { data: [{ id: "gpt-6-astra" }] }));
  assert.deepEqual(await online.testKey("openai"), { ok: true, message: "The key works: OpenAI answered." });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "GET", "nothing is generated, so nothing is paid for");
});

test("Get a key opens the company's fixed page only after Sage's own box says Open", async () => {
  const box = await services(() => jsonResponse(200, {}));
  box.answer(false);
  assert.deepEqual(await box.online.openKeyPage("claude"), { status: "declined" });
  assert.deepEqual(box.opened, []);
  box.answer(new Error("the box couldn't open"));
  assert.deepEqual(await box.online.openKeyPage("claude"), { status: "declined" });
  assert.deepEqual(box.opened, []);
  box.answer(true);
  for (const company of ["claude", "openai", "gemini"] as const) {
    assert.deepEqual(await box.online.openKeyPage(company), { status: "opened" });
  }
  assert.deepEqual(box.opened, [
    "https://console.anthropic.com/settings/keys",
    "https://platform.openai.com/api-keys",
    "https://aistudio.google.com/apikey",
  ]);
  assert.equal(box.asked.at(-1)![0], PAGE_QUESTION("gemini"));
  assert.equal(PAGE_QUESTION("claude"), "Open Anthropic's key page in your web browser?");
  assert.match(PAGE_DETAIL("claude"), /^Sage will open https:\/\/console\.anthropic\.com\/settings\/keys\./);
  assert.match(PAGE_DETAIL("gemini"), /free tier/);
  assert.match(PAGE_DETAIL("openai"), /can't cap what you spend/);
  box.browserFails(new Error("no browser"));
  assert.deepEqual(await box.online.openKeyPage("openai"), {
    status: "failed",
    message: "Sage couldn't open your web browser. The page is at https://platform.openai.com/api-keys",
    address: "https://platform.openai.com/api-keys",
  });
  assert.ok(box.lines.some((line) => line.includes("couldn't be opened for a key page")));
});

test("the window's requests carry a company's id and nothing else", async (t) => {
  const asked: string[] = [];
  const opened: string[] = [];
  const keyStores = memoryKeyStores();
  const fake = fakeFetch(() => jsonResponse(200, { data: [{ id: "claude-sonnet-5-5" }] }));
  const sage = createSage({
    dataDir: await tempDir(t),
    keyStores,
    presenter: new FakePresenter(false),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    fetch: fake.fetch,
    setup: {
      confirmPull: async () => false,
      confirmOpenGuide: async () => false,
      confirmOpenPage: async (question) => {
        asked.push(question);
        return true;
      },
      openExternal: async (url) => {
        opened.push(url);
      },
    },
  });
  const handlers = createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null });
  await handlers[CHANNELS.setKey]({ brain: "claude", key: KEYS.claude, baseUrl: "" });
  assert.deepEqual(await handlers[CHANNELS.listModels]({ company: "claude" }), {
    ok: true,
    models: ["claude-sonnet-5-5"],
  });
  assert.deepEqual(await handlers[CHANNELS.testKey]({ company: "claude" }), {
    ok: true,
    message: "The key works: Claude answered.",
  });
  assert.deepEqual(await handlers[CHANNELS.openKeyPage]({ company: "gemini" }), { status: "opened" });
  assert.deepEqual(opened, ["https://aistudio.google.com/apikey"]);
  assert.deepEqual(asked, ["Open Google's key page in your web browser?"]);
  const sent = fake.calls.length;
  const bad = [
    undefined,
    {},
    { company: "other" },
    { company: "local" },
    { company: "claude", url: "https://evil.example" },
    { company: "claude", baseUrl: "https://evil.example" },
    "claude",
  ];
  for (const payload of bad) {
    assert.deepEqual(await handlers[CHANNELS.listModels](payload), {
      ok: false,
      message: "Sage couldn't read that choice.",
    });
    assert.deepEqual(await handlers[CHANNELS.testKey](payload), {
      ok: false,
      message: "Sage couldn't read that choice.",
    });
    assert.deepEqual(await handlers[CHANNELS.openKeyPage](payload), {
      status: "failed",
      message: "Sage couldn't read that choice.",
      address: "",
    });
  }
  assert.equal(fake.calls.length, sent, "no bad request reached a service");
  assert.ok(fake.calls.every((call) => call.url.startsWith("https://api.anthropic.com/")));
  assert.deepEqual(opened, ["https://aistudio.google.com/apikey"], "no page opened for a bad request");
  // Nothing a channel answers ever holds the key.
  assert.ok(!JSON.stringify(await handlers[CHANNELS.getSettings](undefined)).includes(KEYS.claude));
});

test("without the main process's box, no key page opens", async (t) => {
  const opened: string[] = [];
  const sage = createSage({
    dataDir: await tempDir(t),
    keyStores: memoryKeyStores(),
    presenter: new FakePresenter(false),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
  });
  assert.deepEqual(await sage.services.openKeyPage("claude"), { status: "declined" });
  assert.deepEqual(opened, []);
});

test("one check at a time per company: a second Load models or Test shares the answer, and so does one right after", async () => {
  const gate = deferred<Response>();
  const { online, calls, clock } = await services((call) =>
    call.url.startsWith("https://api.anthropic.com/")
      ? gate.promise
      : jsonResponse(200, { data: [{ id: "gpt-6-astra" }] }),
  );
  clock.step = 0;
  const first = online.listModels("claude");
  const second = online.listModels("claude");
  const test = online.testKey("claude");
  // Another company is checked on its own.
  assert.deepEqual(await online.listModels("openai"), { ok: true, models: ["gpt-6-astra"] });
  await settled();
  assert.equal(calls.filter((call) => call.url.startsWith("https://api.anthropic.com/")).length, 1);
  gate.resolve(jsonResponse(200, { data: [{ id: "claude-sonnet-5-5" }] }));
  const expected = { ok: true, models: ["claude-sonnet-5-5"] };
  assert.deepEqual(await first, expected);
  assert.deepEqual(await second, expected);
  assert.deepEqual(await test, { ok: true, message: "The key works: Claude answered." });
  // Within a few seconds: the same answer, no new request.
  clock.now += COOLDOWN_MS - 1;
  assert.deepEqual(await online.listModels("claude"), expected);
  assert.equal(calls.length, 2);
  // After that, a new request.
  clock.now += 1;
  await online.listModels("claude");
  assert.equal(calls.length, 3);
  // A key saved or removed starts afresh at once.
  online.forget("claude");
  await online.testKey("claude");
  assert.equal(calls.length, 4);
  assert.ok(COOLDOWN_MS >= 2_000 && COOLDOWN_MS <= 10_000, "a few seconds");
});

test("without a saved key there is nothing to wait for: saving one and testing right away works", async (t) => {
  const keyStores = memoryKeyStores();
  const fake = fakeFetch(() => jsonResponse(200, { data: [{ id: "claude-sonnet-5-5" }] }));
  const sage = createSage({
    dataDir: await tempDir(t),
    keyStores,
    presenter: new FakePresenter(false),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    fetch: fake.fetch,
  });
  const handlers = createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null });
  assert.deepEqual(await handlers[CHANNELS.testKey]({ company: "claude" }), {
    ok: false,
    message: "Save a Claude key first.",
  });
  await handlers[CHANNELS.setKey]({ brain: "claude", key: KEYS.claude, baseUrl: "" });
  assert.deepEqual(await handlers[CHANNELS.testKey]({ company: "claude" }), {
    ok: true,
    message: "The key works: Claude answered.",
  });
  // Replaced right after: the next Test asks again, with the new key.
  await handlers[CHANNELS.setKey]({ brain: "claude", key: "fake-claude-key-number-two", baseUrl: "" });
  await handlers[CHANNELS.testKey]({ company: "claude" });
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1]!.headers["x-api-key"], "fake-claude-key-number-two");
  await handlers[CHANNELS.clearKey]({ brain: "claude" });
  assert.deepEqual(await handlers[CHANNELS.listModels]({ company: "claude" }), {
    ok: false,
    message: "Save a Claude key first.",
  });
});
