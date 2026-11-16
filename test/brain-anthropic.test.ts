import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage } from "../src/core/brain/brain.js";
import {
  ANTHROPIC_VERSION,
  MAX_TOKENS,
  MESSAGES_URL,
  MessagesBrain,
  messagesRequest,
} from "../src/core/brain/anthropic.js";
import { failingBody, fakeFetch, jsonResponse } from "./helpers.js";

// Claude through the Messages format: recorded replies, never the real service.

const KEY = "fake-claude-key-for-tests";
const tools = [
  { name: "web_search", description: "Search", parameters: { type: "object", properties: {} } },
  { name: "add_note", description: "Add a note", parameters: { type: "object" } },
];

function brain(handler: Parameters<typeof fakeFetch>[0], options: { timeoutMs?: number } = {}) {
  const fake = fakeFetch(handler);
  const asked: string[] = [];
  const claude = new MessagesBrain({
    model: "claude-sonnet-5-5",
    getKey: async (url) => {
      asked.push(url);
      return KEY;
    },
    fetch: fake.fetch,
    ...options,
  });
  return { claude, calls: fake.calls, asked };
}

const textReply = (text: string) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
});

test("posts to the fixed Messages address with the key, the version, a system prompt and max_tokens", async () => {
  const { claude, calls, asked } = brain(() => jsonResponse(200, textReply("Hello!")));
  const reply = await claude.chat(
    [
      { role: "system", content: "You are Sage." },
      { role: "user", content: "hi" },
    ],
    tools,
  );
  assert.deepEqual(reply, { ok: true, content: "Hello!", toolCalls: [] });
  const call = calls[0]!;
  assert.equal(call.url, "https://api.anthropic.com/v1/messages");
  assert.equal(MESSAGES_URL, call.url);
  assert.deepEqual(asked, [call.url], "the key is asked for the exact address the request goes to");
  assert.equal(call.method, "POST");
  assert.equal(call.redirect, "error", "a redirect can't carry the key elsewhere");
  assert.deepEqual(call.headers, {
    "x-api-key": KEY,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  });
  assert.equal(ANTHROPIC_VERSION, "2023-06-01");
  const body = JSON.parse(call.body);
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.equal(body.max_tokens, MAX_TOKENS);
  assert.equal(body.system, "You are Sage.");
  assert.deepEqual(body.messages, [{ role: "user", content: [{ type: "text", text: "hi" }] }]);
  assert.deepEqual(body.tools, [
    { name: "web_search", description: "Search", input_schema: { type: "object", properties: {} } },
    { name: "add_note", description: "Add a note", input_schema: { type: "object" } },
  ]);
  assert.deepEqual(body.tool_choice, { type: "auto" });
});

test("skill requests go out as tool_use blocks and results come back as tool_result blocks, first in a user turn", () => {
  const messages: ChatMessage[] = [
    { role: "system", content: "rules" },
    { role: "system", content: "more rules" },
    { role: "user", content: "find and note" },
    {
      role: "assistant",
      content: "Let me look.",
      toolCalls: [
        { id: "sage-1", name: "web_search", args: { query: "q" } },
        { id: "sage-2", name: "add_note", args: "not an object" },
      ],
    },
    { role: "tool", toolCallId: "sage-1", name: "web_search", content: "results" },
    { role: "tool", toolCallId: "sage-2", name: "add_note", content: "Not run: limit" },
    { role: "assistant", content: "" },
    { role: "user", content: "thanks" },
  ];
  const body = messagesRequest("m", messages, tools);
  assert.equal(body.system, "rules\n\nmore rules");
  assert.deepEqual(body.messages, [
    { role: "user", content: [{ type: "text", text: "find and note" }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Let me look." },
        { type: "tool_use", id: "sage-1", name: "web_search", input: { query: "q" } },
        { type: "tool_use", id: "sage-2", name: "add_note", input: {} },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "sage-1", content: "results" },
        { type: "tool_result", tool_use_id: "sage-2", content: "Not run: limit" },
        // The empty assistant turn adds nothing, so the next user text joins this turn, after the results.
        { type: "text", text: "thanks" },
      ],
    },
  ]);
});

test("with no skills left to offer, earlier skill requests stay valid and skills are switched off", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "go" },
    { role: "assistant", content: "", toolCalls: [{ id: "a", name: "web_search", args: {} }] },
    { role: "tool", toolCallId: "a", name: "web_search", content: "r" },
  ];
  const body = messagesRequest("m", messages, []);
  assert.deepEqual(body.tools, [
    { name: "web_search", description: "Not available now.", input_schema: { type: "object" } },
  ]);
  assert.deepEqual(body.tool_choice, { type: "none" });
  // A plain conversation with no skills sends no tools at all, and no empty system prompt.
  const plain = messagesRequest("m", [{ role: "user", content: "hi" }], []);
  assert.equal(plain.tools, undefined);
  assert.equal(plain.tool_choice, undefined);
  assert.equal(plain.system, undefined);
});

test("reads text and tool_use blocks, gives each call Sage's own id, and skips other block types", async () => {
  const { claude } = brain(() =>
    jsonResponse(200, {
      content: [
        { type: "text", text: "Searching " },
        { type: "tool_use", id: "toolu_1", name: "web_search", input: { query: "news" } },
        { type: "something_new", data: 1 },
        { type: "tool_use", id: "toolu_1", name: "add_note", input: { title: "t", text: "x" } },
        { type: "text", text: "now." },
      ],
      stop_reason: "tool_use",
    }),
  );
  const reply = await claude.chat([{ role: "user", content: "q" }], tools);
  assert.ok(reply.ok);
  assert.equal(reply.content, "Searching now.");
  assert.deepEqual(
    reply.toolCalls.map((call) => [call.name, call.args]),
    [
      ["web_search", { query: "news" }],
      ["add_note", { title: "t", text: "x" }],
    ],
  );
  assert.notEqual(reply.toolCalls[0]!.id, "toolu_1");
  assert.notEqual(reply.toolCalls[0]!.id, reply.toolCalls[1]!.id);
  assert.equal(reply.toolCalls[0]!.signature, undefined);
});

test("a successful reply that echoes the key has it removed from the text and the arguments", async () => {
  const { claude } = brain(() =>
    jsonResponse(200, {
      content: [
        { type: "text", text: `Your key is ${KEY}` },
        {
          type: "tool_use",
          id: "x",
          name: "add_note",
          input: { title: KEY, nested: [{ [KEY]: `a ${KEY}` }] },
        },
      ],
    }),
  );
  const redacting = new MessagesBrain({
    model: "m",
    getKey: async () => KEY,
    redact: (text) => text.replace("other-secret", "[redacted]"),
    fetch: fakeFetch(() => jsonResponse(200, { content: [{ type: "text", text: "other-secret here" }] }))
      .fetch,
  });
  const reply = await claude.chat([{ role: "user", content: "q" }], tools);
  assert.ok(reply.ok);
  assert.equal(reply.content, "Your key is [redacted]");
  assert.deepEqual(reply.toolCalls[0]!.args, {
    title: "[redacted]",
    nested: [{ "[redacted]": "a [redacted]" }],
  });
  assert.ok(!JSON.stringify(reply).includes(KEY));
  const other = await redacting.chat([{ role: "user", content: "q" }], tools);
  assert.ok(other.ok && other.content === "[redacted] here");
});

test("asks for the model and the key before sending anything", async () => {
  const { fetch, calls } = fakeFetch(() => jsonResponse(200, {}));
  const noKey = new MessagesBrain({ model: "m", getKey: async () => null, fetch });
  assert.deepEqual(await noKey.chat([], tools), {
    ok: false,
    message: "Add your Claude key in Settings first.",
  });
  const noModel = new MessagesBrain({ model: " ", getKey: async () => KEY, fetch });
  assert.deepEqual(await noModel.chat([], tools), {
    ok: false,
    message: "Choose the model for Claude in Settings first.",
  });
  assert.equal(calls.length, 0);
});

test("a refused key, credit used up, a retired model, a busy service: plain messages, never the service's text", async () => {
  const cases: [number, unknown, RegExp][] = [
    [
      401,
      { type: "error", error: { type: "authentication_error", message: `bad ${KEY}` } },
      /didn't accept the key/,
    ],
    [403, { type: "error", error: { type: "permission_error", message: "no" } }, /didn't accept the key/],
    [402, { type: "error", error: { type: "billing_error", message: "pay" } }, /credit or quota is used up/],
    [400, { type: "error", error: { type: "billing_error", message: "pay" } }, /credit or quota is used up/],
    [
      404,
      { type: "error", error: { type: "not_found_error", message: "model: x" } },
      /doesn't know that model, or it was retired/,
    ],
    [429, { type: "error", error: { type: "rate_limit_error", message: "slow" } }, /rate limit/],
    [529, { type: "error", error: { type: "overloaded_error", message: "busy" } }, /busy or overloaded/],
    [500, { type: "error", error: { type: "api_error", message: "oops" } }, /busy or overloaded/],
    [400, { type: "error", error: { type: "invalid_request_error", message: `echo ${KEY}` } }, /HTTP 400/],
  ];
  for (const [status, body, pattern] of cases) {
    const { claude } = brain(() => jsonResponse(status, body));
    const reply = await claude.chat([{ role: "user", content: "q" }], tools);
    assert.ok(!reply.ok, String(status));
    assert.match(reply.message, pattern, String(status));
    assert.match(reply.message, /^Claude /);
    assert.ok(!reply.message.includes(KEY));
    assert.doesNotMatch(reply.message, /bad|pay|slow|oops|echo|model: x/, "never the service's own words");
  }
});

test("a time-out, a stalled body, no network and an unreadable reply each get their message", async () => {
  const timedOut = brain(() => {
    throw new DOMException("The operation timed out.", "TimeoutError");
  });
  assert.deepEqual(await timedOut.claude.chat([], tools), {
    ok: false,
    message: "Claude took too long to answer. Try again.",
  });
  // The request's own time limit fires while the service never answers.
  const waiting = brain(
    (_call, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    { timeoutMs: 20 },
  );
  assert.match(((await waiting.claude.chat([], tools)) as { message: string }).message, /took too long/);
  const stalled = brain(() => failingBody(new DOMException("The operation timed out.", "TimeoutError")));
  assert.match(((await stalled.claude.chat([], tools)) as { message: string }).message, /took too long/);
  const offline = brain(() => {
    throw new TypeError("fetch failed");
  });
  assert.deepEqual(await offline.claude.chat([], tools), {
    ok: false,
    message: "Sage can't reach Claude. Check your internet connection.",
  });
  for (const body of [{ content: "not a list" }, { nothing: true }]) {
    const odd = brain(() => jsonResponse(200, body));
    assert.deepEqual(await odd.claude.chat([], tools), {
      ok: false,
      message: "Claude sent a reply Sage couldn't read.",
    });
  }
  const dropped = brain(() => failingBody(new TypeError("terminated")));
  assert.match(((await dropped.claude.chat([], tools)) as { message: string }).message, /couldn't read/);
});
