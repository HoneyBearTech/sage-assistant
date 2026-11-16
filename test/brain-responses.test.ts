import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage } from "../src/core/brain/brain.js";
import {
  CHAT_TIMEOUT_MS,
  CUT_OFF_MESSAGE,
  CUT_OFF_NOTE,
  MAX_OUTPUT_TOKENS,
  REFUSAL_MESSAGE,
  RESPONSES_URL,
  ResponsesBrain,
  responsesRequest,
} from "../src/core/brain/responses.js";
import { createSage } from "../src/core/sage.js";
import { defaultSettings } from "../src/core/settings.js";
import { FakePresenter, fakeFetch, jsonResponse, memoryKeyStores, settled, tempDir } from "./helpers.js";

// OpenAI through its Responses format: recorded-style replies, never the real service.

const KEY = "fake-openai-key-for-tests";
const tools = [{ name: "web_search", description: "Search", parameters: { type: "object", properties: {} } }];

function brain(
  handler: Parameters<typeof fakeFetch>[0],
  extra: { timeoutSignal?: (ms: number) => AbortSignal } = {},
) {
  const fake = fakeFetch(handler);
  const asked: string[] = [];
  const openai = new ResponsesBrain({
    model: "gpt-6-astra",
    getKey: async (url) => {
      asked.push(url);
      return KEY;
    },
    fetch: fake.fetch,
    ...extra,
  });
  return { openai, calls: fake.calls, asked };
}

const REASONING = {
  id: "rs_68a1f0c2d3e4",
  type: "reasoning",
  summary: [],
  encrypted_content: "gAAAAABo8xY2kQ9vR4mT1zL0pW7nB3cX5eH8jK6uF2aS9dG1qV4yN0rM3tE7oI5wZ2lC8bA6xP==",
};
const ROUND_1 = {
  id: "resp_68a1f0c2",
  object: "response",
  status: "completed",
  model: "gpt-6-astra",
  output: [
    REASONING,
    {
      id: "fc_68a1f0c2aa",
      type: "function_call",
      status: "completed",
      call_id: "call_Qx7pL2mN9vB4",
      name: "list_notes",
      arguments: "{}",
    },
  ],
  usage: { input_tokens: 700, output_tokens: 80 },
};
const FINAL = {
  id: "resp_68a1f0c3",
  object: "response",
  status: "completed",
  output: [
    { ...REASONING, id: "rs_68a1f0c3" },
    {
      id: "msg_68a1f0c3",
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: "You have one note.", annotations: [] }],
    },
  ],
};

test("posts to the fixed Responses address with the key, instructions, tools and nothing stored", async () => {
  const { openai, calls, asked } = brain(() => jsonResponse(200, FINAL));
  const reply = await openai.chat(
    [
      { role: "system", content: "You are Sage." },
      { role: "user", content: "hi" },
    ],
    tools,
  );
  assert.ok(reply.ok);
  assert.equal(reply.content, "You have one note.");
  assert.deepEqual(reply.replay, { format: "responses", items: FINAL.output });
  const call = calls[0]!;
  assert.equal(call.url, "https://api.openai.com/v1/responses");
  assert.equal(RESPONSES_URL, call.url);
  assert.deepEqual(asked, [call.url]);
  assert.equal(call.redirect, "error");
  assert.deepEqual(call.headers, { authorization: `Bearer ${KEY}`, "content-type": "application/json" });
  const body = JSON.parse(call.body);
  assert.deepEqual(body, {
    model: "gpt-6-astra",
    instructions: "You are Sage.",
    input: [{ role: "user", content: "hi" }],
    tools: [
      {
        type: "function",
        name: "web_search",
        description: "Search",
        parameters: { type: "object", properties: {} },
        strict: false,
      },
    ],
    tool_choice: "auto",
    store: false,
    include: ["reasoning.encrypted_content"],
    max_output_tokens: MAX_OUTPUT_TOKENS,
  });
  assert.equal(CHAT_TIMEOUT_MS, 180_000);
});

test("through Sage itself: the output items go back as they came, with the result under the call's id", async (t) => {
  let index = 0;
  const fake = fakeFetch(() => jsonResponse(200, index++ === 0 ? ROUND_1 : FINAL));
  const sage = createSage({
    dataDir: await tempDir(t),
    keyStores: memoryKeyStores(),
    presenter: new FakePresenter(false),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    fetch: fake.fetch,
  });
  await sage.keyStore.setCompanyKey("openai", KEY);
  await sage.settings.save({ ...defaultSettings(), brain: "openai" });
  await sage.notes.add("Shopping", "milk");
  assert.equal(await sage.assistant.send("what notes do I have?"), "You have one note.");
  const [one, two] = fake.calls.map((call) => JSON.parse(call.body));
  assert.equal(fake.calls[0]!.url, "https://api.openai.com/v1/responses");
  assert.ok(fake.calls[1]!.body.includes(JSON.stringify(ROUND_1.output[0])), "reasoning, byte for byte");
  assert.deepEqual(two.input.slice(0, one.input.length), one.input, "the input only grows");
  assert.deepEqual(two.input.slice(one.input.length, one.input.length + 2), ROUND_1.output);
  const output = two.input.at(-1);
  assert.equal(output.type, "function_call_output");
  assert.equal(output.call_id, "call_Qx7pL2mN9vB4");
  assert.match(output.output, /Shopping/, "the skill ran");
  assert.equal(JSON.stringify(two.tools), JSON.stringify(one.tools));
  assert.equal(two.instructions, one.instructions);
  assert.ok(!JSON.stringify(sage.assistant.transcript).includes("encrypted"), "never in the chat history");
});

test("past the skill limit the same tools go out with tool_choice none; history turns are plain text", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "earlier" },
    { role: "assistant", content: "an earlier answer" },
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: "Looking.",
      toolCalls: [{ id: "sage-1", name: "web_search", args: { query: "q" }, serviceId: "call_1" }],
    },
    { role: "tool", toolCallId: "sage-1", name: "web_search", content: "results" },
    { role: "user", content: "" },
  ];
  const open = responsesRequest("m", messages, tools);
  const closed = responsesRequest("m", messages, tools, false);
  assert.equal(JSON.stringify(closed.tools), JSON.stringify(open.tools));
  assert.equal(closed.tool_choice, "none");
  assert.deepEqual(closed.input, [
    { role: "user", content: "earlier" },
    { role: "assistant", content: "an earlier answer" },
    { role: "user", content: "go" },
    { role: "assistant", content: "Looking." },
    { type: "function_call", call_id: "call_1", name: "web_search", arguments: '{"query":"q"}' },
    { type: "function_call_output", call_id: "call_1", output: "results" },
  ]);
  const plain = responsesRequest("m", [{ role: "user", content: "hi" }], []);
  assert.equal(plain.tools, undefined);
  assert.equal(plain.instructions, undefined);
});

test("skill requests get Sage's own ids and parsed arguments; an echoed key is removed", async () => {
  const { openai } = brain(() =>
    jsonResponse(200, {
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: `key ${KEY}` }] },
        {
          type: "function_call",
          call_id: "call_A",
          name: "add_note",
          arguments: JSON.stringify({ text: KEY }),
        },
        { type: "function_call", call_id: "call_B", name: "web_search", arguments: "not json" },
        { type: "something_new" },
      ],
    }),
  );
  const reply = await openai.chat([{ role: "user", content: "q" }], tools);
  assert.ok(reply.ok);
  assert.equal(reply.content, "key [redacted]");
  assert.deepEqual(
    reply.toolCalls.map((call) => [call.name, call.args, call.serviceId]),
    [
      ["add_note", { text: "[redacted]" }, "call_A"],
      ["web_search", "not json", "call_B"],
    ],
  );
  assert.notEqual(reply.toolCalls[0]!.id, "call_A");
});

test("a reply cut off at the token limit keeps its text and runs no skill; a refusal is said plainly", async () => {
  const cut = brain(() =>
    jsonResponse(200, {
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [
        { type: "message", content: [{ type: "output_text", text: "The start" }] },
        { type: "function_call", call_id: "c", name: "add_note", arguments: '{"tit' },
      ],
    }),
  );
  assert.deepEqual(await cut.openai.chat([{ role: "user", content: "q" }], tools), {
    ok: true,
    content: `The start\n\n${CUT_OFF_NOTE}`,
    toolCalls: [],
  });
  const nothing = brain(() =>
    jsonResponse(200, {
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [REASONING],
    }),
  );
  assert.deepEqual(await nothing.openai.chat([], tools), {
    ok: true,
    content: CUT_OFF_MESSAGE,
    toolCalls: [],
  });
  const refused = brain(() =>
    jsonResponse(200, {
      status: "completed",
      output: [{ type: "message", content: [{ type: "refusal", refusal: "I can't help with that." }] }],
    }),
  );
  assert.deepEqual(await refused.openai.chat([], tools), { ok: false, message: REFUSAL_MESSAGE });
  const filtered = brain(() =>
    jsonResponse(200, { status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] }),
  );
  assert.deepEqual(await filtered.openai.chat([], tools), { ok: false, message: REFUSAL_MESSAGE });
});

test("errors, a missing key or model, an odd reply and a time-out get plain messages", async () => {
  const cases: [number, unknown, RegExp][] = [
    [
      401,
      { error: { type: "invalid_request_error", code: "invalid_api_key", message: `bad ${KEY}` } },
      /didn't accept the key/,
    ],
    [
      429,
      { error: { type: "insufficient_quota", code: "insufficient_quota", message: "pay" } },
      /credit or quota/,
    ],
    [429, { error: { type: "requests", code: "rate_limit_exceeded", message: "slow" } }, /rate limit/],
    [404, { error: { code: "model_not_found", message: "no" } }, /doesn't know that model/],
  ];
  for (const [status, body, pattern] of cases) {
    const { openai } = brain(() => jsonResponse(status, body));
    const reply = await openai.chat([], tools);
    assert.ok(!reply.ok);
    assert.match(reply.message, pattern);
    assert.match(reply.message, /^OpenAI /);
    assert.doesNotMatch(reply.message, /bad|pay|slow|fake/);
  }
  const { fetch, calls } = fakeFetch(() => jsonResponse(200, {}));
  assert.deepEqual(
    await new ResponsesBrain({ model: "m", getKey: async () => null, fetch }).chat([], tools),
    {
      ok: false,
      message: "Add your OpenAI key in Settings first.",
    },
  );
  assert.deepEqual(await new ResponsesBrain({ model: " ", getKey: async () => KEY, fetch }).chat([], tools), {
    ok: false,
    message: "Choose the model for OpenAI in Settings first.",
  });
  assert.equal(calls.length, 0);
  const odd = brain(() => jsonResponse(200, { output: "no" }));
  assert.deepEqual(await odd.openai.chat([], tools), {
    ok: false,
    message: "OpenAI sent a reply Sage couldn't read.",
  });
  const limit = new AbortController();
  const waiting = brain(
    (_call, init) =>
      new Promise<Response>((_resolve, reject) => {
        if (init.signal?.aborted) reject(init.signal.reason);
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    { timeoutSignal: () => limit.signal },
  );
  const pending = waiting.openai.chat([], tools);
  await settled();
  limit.abort(new DOMException("The operation timed out.", "TimeoutError"));
  assert.deepEqual(await pending, { ok: false, message: "OpenAI took too long to answer. Try again." });
});

test("a reply that says it failed or was cancelled gets a plain error, never an empty answer", async () => {
  const cases: [unknown, RegExp][] = [
    [
      { status: "failed", error: { code: "server_error", message: `The model failed ${KEY}` }, output: [] },
      /^OpenAI is busy or overloaded right now/,
    ],
    [
      { status: "failed", error: { code: "rate_limit_exceeded", message: "slow down" }, output: [] },
      /rate limit/,
    ],
    [
      { status: "failed", error: { code: "insufficient_quota", message: "pay" }, output: [] },
      /credit or quota is used up/,
    ],
    [
      { status: "failed", error: { code: "vector_store_timeout", message: "x" }, output: [] },
      /couldn't finish its reply/,
    ],
    [{ status: "failed", error: null, output: [] }, /^OpenAI couldn't finish its reply\. Try again later\.$/],
    [{ status: "cancelled", output: [] }, /^OpenAI couldn't finish its reply\. Try again later\.$/],
    [{ status: "failed", error: { code: "bad code with spaces" }, output: [] }, /couldn't finish its reply/],
  ];
  for (const [body, pattern] of cases) {
    const { openai } = brain(() => jsonResponse(200, body));
    const reply = await openai.chat([{ role: "user", content: "q" }], tools);
    assert.ok(!reply.ok, JSON.stringify(body));
    assert.match(reply.message, pattern);
    assert.doesNotMatch(reply.message, /failed|slow|pay|fake|spaces/, "never the service's own words");
  }
});
