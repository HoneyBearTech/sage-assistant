import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANTHROPIC_VERSION,
  CHAT_TIMEOUT_MS,
  CUT_OFF_MESSAGE,
  CUT_OFF_NOTE,
  MAX_TOKENS,
  MESSAGES_URL,
  MessagesBrain,
  messagesRequest,
  REFUSAL_MESSAGE,
} from "../src/core/brain/anthropic.js";
import type { ChatMessage } from "../src/core/brain/brain.js";
import { CLEARED_REPLY, SETTINGS_CHANGED_REPLY } from "../src/core/assistant.js";
import { createSage } from "../src/core/sage.js";
import { createIpcHandlers } from "../src/main/ipc.js";
import { CHANNELS } from "../src/shared/api.js";
import { defaultSettings } from "../src/core/settings.js";
import {
  deferred,
  failingBody,
  FakePresenter,
  type FetchCall,
  fakeFetch,
  jsonResponse,
  memoryKeyStores,
  settled,
  tempDir,
} from "./helpers.js";

// Claude through the Messages format: recorded replies, never the real service.

const KEY = "fake-claude-key-for-tests";
const tools = [
  { name: "web_search", description: "Search", parameters: { type: "object", properties: {} } },
  { name: "add_note", description: "Add a note", parameters: { type: "object" } },
];

function brain(
  handler: Parameters<typeof fakeFetch>[0],
  options: { timeoutSignal?: (ms: number) => AbortSignal } = {},
) {
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
  assert.deepEqual(reply, {
    ok: true,
    content: "Hello!",
    toolCalls: [],
    replay: { format: "messages", items: [{ type: "text", text: "Hello!" }] },
  });
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
  assert.equal(MAX_TOKENS, 16_000, "room for thinking, which counts toward the limit");
  assert.equal(CHAT_TIMEOUT_MS, 180_000);
  assert.equal(body.thinking, undefined, "no thinking setting is sent: each model keeps its own default");
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

test("past the skill limit the same tools are sent, with tool use switched off", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "a", name: "web_search", args: {}, serviceId: "toolu_01" }],
    },
    { role: "tool", toolCallId: "a", name: "web_search", content: "r" },
  ];
  const open = messagesRequest("m", messages, tools);
  const closed = messagesRequest("m", messages, tools, { allowTools: false });
  assert.equal(JSON.stringify(closed.tools), JSON.stringify(open.tools), "the very same tools");
  assert.deepEqual(open.tool_choice, { type: "auto" });
  assert.deepEqual(closed.tool_choice, { type: "none" });
  // The result is matched by the service's own id for the call.
  assert.deepEqual((closed.messages as { content: unknown[] }[])[2]!.content, [
    { type: "tool_result", tool_use_id: "toolu_01", content: "r" },
  ]);
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
  assert.equal(reply.toolCalls[0]!.serviceId, "toolu_1", "the service's id is kept to match the result");
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
  assert.ok(!JSON.stringify([reply.content, reply.toolCalls]).includes(KEY), "nothing Sage shows or acts on");
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
    [
      400,
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          message:
            "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
        },
      },
      /credit or quota is used up/,
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
    assert.doesNotMatch(
      reply.message,
      /bad|pay|slow|oops|echo|model: x|balance|Plans/,
      "never the service's own words",
    );
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
  const limit = new AbortController();
  const limits: number[] = [];
  const waiting = brain(
    (_call, init) =>
      new Promise<Response>((_resolve, reject) => {
        if (init.signal?.aborted) reject(init.signal.reason);
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
    {
      timeoutSignal: (ms) => {
        limits.push(ms);
        return limit.signal;
      },
    },
  );
  const pending = waiting.claude.chat([], tools);
  await settled();
  assert.equal(waiting.calls.length, 1, "the request is out and waiting");
  limit.abort(new DOMException("The operation timed out.", "TimeoutError"));
  assert.match(((await pending) as { message: string }).message, /took too long/);
  assert.deepEqual(limits, [CHAT_TIMEOUT_MS]);
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

// Recorded-style replies from a current model, which thinks by default: thinking blocks (often with
// empty text) carrying signatures, before text and tool_use blocks.
const SIG_1 =
  "EqQBCkgIBhABGAIiQL7kRGYvT3mEU0dYqG8yC1yGJbN3qZ1Q5tX0bE9oQhK2u4c6c3cP5zv+1/Z0rM8fYcnR3Lm2Kq9nWxV0aT8SDJ2fZx==";
const SIG_2 =
  "ErUBCkYIBhABGAIiQHb2hE4F0u9vY8+2bZq7xL5c3rM1nP0sK6tW9eJ4dQ1gA2fH8yU7iO0pL3kN5mB6vC9xZ4wR1sT2uV3yX5aB==";
const ROUND_1 = {
  id: "msg_01XFDUDYJgAACzvnptvVoYEL",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content: [
    { type: "thinking", thinking: "", signature: SIG_1 },
    {
      type: "redacted_thinking",
      data: "EmwKAhgBEgy3va3pzix/LafPsn4aDFIT2Xlxh0L5L8rLVyIwxtE3rAFBa8cr3qpPkNRj2YfWXGmKDxH4mPnZ5sQ7vB8=",
    },
    { type: "text", text: "Let me check your notes." },
    { type: "tool_use", id: "toolu_01A09q90qw90lq917835lq9", name: "list_notes", input: {} },
  ],
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 812, output_tokens: 96 },
};
const ROUND_2 = {
  id: "msg_01Aq9w938a90dw8q",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content: [
    { type: "thinking", thinking: "", signature: SIG_2 },
    { type: "tool_use", id: "toolu_01B7Xz2kq8LmN3pQ4rS5tU6v", name: "list_reminders", input: {} },
  ],
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 990, output_tokens: 61 },
};
const FINAL = {
  id: "msg_01Final",
  type: "message",
  role: "assistant",
  content: [
    { type: "thinking", thinking: "", signature: SIG_1 },
    { type: "text", text: "You have no notes and no reminders." },
  ],
  stop_reason: "end_turn",
};

/** Sage itself (the real assistant, skills and gate) with Claude chosen, answering from `replies`. */
async function sageWithClaude(
  t: Parameters<typeof tempDir>[0],
  replies: (call: FetchCall, index: number, init: RequestInit) => Response | Promise<Response>,
) {
  let index = 0;
  const fake = fakeFetch((call, init) => replies(call, index++, init));
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
  await sage.keyStore.setCompanyKey("claude", KEY);
  await sage.settings.save({ ...defaultSettings(), brain: "claude" });
  const bodies = () => fake.calls.map((call) => JSON.parse(call.body) as Record<string, any>);
  const handlers = createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null });
  return { sage, handlers, calls: fake.calls, bodies };
}

test("within one message, each reply goes back exactly as it came, thinking blocks and signatures included", async (t) => {
  const { sage, calls, bodies } = await sageWithClaude(t, (_call, index) =>
    jsonResponse(200, [ROUND_1, ROUND_2, FINAL][index]),
  );
  assert.equal(await sage.assistant.send("what do I have?"), "You have no notes and no reminders.");
  assert.equal(calls.length, 3);
  const [first, second, third] = bodies();
  // Byte for byte: the reply's content array is in the next request's text unchanged.
  assert.ok(calls[1]!.body.includes(JSON.stringify(ROUND_1.content)));
  assert.ok(calls[2]!.body.includes(JSON.stringify(ROUND_1.content)));
  assert.ok(calls[2]!.body.includes(JSON.stringify(ROUND_2.content)));
  assert.deepEqual(second!.messages[1], { role: "assistant", content: ROUND_1.content });
  assert.equal(second!.messages[2].content[0].tool_use_id, "toolu_01A09q90qw90lq917835lq9");
  assert.equal(third!.messages[4].content[0].tool_use_id, "toolu_01B7Xz2kq8LmN3pQ4rS5tU6v");
  // The history only grows: every request starts with the one before, and the system prompt and
  // tools never change.
  assert.deepEqual(second!.messages.slice(0, first!.messages.length), first!.messages);
  assert.deepEqual(third!.messages.slice(0, second!.messages.length), second!.messages);
  for (const body of [second!, third!]) {
    assert.equal(JSON.stringify(body.system), JSON.stringify(first!.system));
    assert.equal(JSON.stringify(body.tools), JSON.stringify(first!.tools));
    assert.equal(body.thinking, undefined);
  }
  // Nothing of the thinking reaches the chat history.
  assert.ok(!JSON.stringify(sage.assistant.transcript).includes(SIG_1));
  // The next message starts afresh from the chat history: no earlier thinking block is sent.
  await sage.assistant.send("thanks");
  const next = bodies()[3]!;
  assert.ok(!calls[3]!.body.includes("signature") && !calls[3]!.body.includes("redacted_thinking"));
  assert.deepEqual(next.messages.at(-2), {
    role: "assistant",
    content: [{ type: "text", text: "You have no notes and no reminders." }],
  });
});

test("past the skill limit, the same tools go out with tool_choice none", async (t) => {
  const many = {
    ...ROUND_1,
    content: [
      ROUND_1.content[0],
      ...Array.from({ length: 7 }, (_, n) => ({
        type: "tool_use",
        id: `toolu_0${n}`,
        name: "list_notes",
        input: {},
      })),
    ],
  };
  const { sage, bodies } = await sageWithClaude(t, (_call, index) => jsonResponse(200, [many, FINAL][index]));
  await sage.assistant.send("go");
  const [first, second] = bodies();
  assert.deepEqual(first!.tool_choice, { type: "auto" });
  assert.deepEqual(second!.tool_choice, { type: "none" });
  assert.equal(JSON.stringify(second!.tools), JSON.stringify(first!.tools));
  assert.ok(first!.tools.length > 5, "Sage's skills, all of them");
  assert.deepEqual(second!.messages[1].content, many.content, "the reply went back as it came");
});

const SIGNATURE_ERROR = {
  type: "error",
  error: {
    type: "invalid_request_error",
    message:
      'messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. Remove the block, or set `thinking.block_binding.prefix_mismatch_behavior` to "drop_block".',
  },
};

test("a refused thinking signature: the request is sent once more without any thinking block", async (t) => {
  const { sage, calls, bodies } = await sageWithClaude(
    t,
    (_call, index) =>
      [jsonResponse(200, ROUND_1), jsonResponse(400, SIGNATURE_ERROR), jsonResponse(200, FINAL)][index]!,
  );
  assert.equal(await sage.assistant.send("what do I have?"), "You have no notes and no reminders.");
  assert.equal(calls.length, 3);
  const [, refused, retried] = bodies();
  assert.deepEqual(refused!.messages[1].content, ROUND_1.content);
  assert.deepEqual(retried!.messages[1].content, [ROUND_1.content[2], ROUND_1.content[3]]);
  assert.ok(!calls[2]!.body.includes("signature") && !calls[2]!.body.includes("redacted_thinking"));
  // Everything else is the same request.
  assert.deepEqual({ ...retried!, messages: undefined }, { ...refused!, messages: undefined });
  assert.deepEqual(retried!.messages.slice(2), refused!.messages.slice(2));
});

test("the retry is made once, and only for a refused signature", async (t) => {
  const twice = await sageWithClaude(t, (_call, index) =>
    index === 0 ? jsonResponse(200, ROUND_1) : jsonResponse(400, SIGNATURE_ERROR),
  );
  const reply = await twice.sage.assistant.send("go");
  assert.equal(twice.calls.length, 3, "one request, then the refused one and a single retry");
  assert.equal(reply, "Claude returned an error (HTTP 400). Try again later.");
  assert.doesNotMatch(reply, /signature|block/);
  const other = await sageWithClaude(t, (_call, index) =>
    index === 0
      ? jsonResponse(200, ROUND_1)
      : jsonResponse(400, {
          type: "error",
          error: { type: "invalid_request_error", message: "messages: bad" },
        }),
  );
  await other.sage.assistant.send("go");
  assert.equal(other.calls.length, 2, "no retry for another kind of 400");
});

test("a reply cut off at max_tokens keeps its text, runs no skill and says so; a refusal is said plainly", async () => {
  const cut = brain(() =>
    jsonResponse(200, {
      content: [
        { type: "thinking", thinking: "", signature: SIG_1 },
        { type: "text", text: "Here is the start" },
        { type: "tool_use", id: "toolu_x", name: "add_note", input: { title: "half" } },
      ],
      stop_reason: "max_tokens",
    }),
  );
  assert.deepEqual(await cut.claude.chat([{ role: "user", content: "q" }], tools), {
    ok: true,
    content: `Here is the start\n\n${CUT_OFF_NOTE}`,
    toolCalls: [],
  });
  const nothing = brain(() =>
    jsonResponse(200, {
      content: [{ type: "thinking", thinking: "", signature: SIG_1 }],
      stop_reason: "max_tokens",
    }),
  );
  assert.deepEqual(await nothing.claude.chat([{ role: "user", content: "q" }], tools), {
    ok: true,
    content: CUT_OFF_MESSAGE,
    toolCalls: [],
  });
  const refused = brain(() =>
    jsonResponse(200, { content: [{ type: "text", text: "partial" }], stop_reason: "refusal" }),
  );
  assert.deepEqual(await refused.claude.chat([{ role: "user", content: "q" }], tools), {
    ok: false,
    message: REFUSAL_MESSAGE,
  });
  // Nothing to say (only thinking, at end_turn) stays an empty answer, as before.
  const empty = brain(() =>
    jsonResponse(200, {
      content: [{ type: "thinking", thinking: "", signature: SIG_1 }],
      stop_reason: "end_turn",
    }),
  );
  const reply = await empty.claude.chat([{ role: "user", content: "q" }], tools);
  assert.ok(reply.ok && reply.content === "" && reply.toolCalls.length === 0);
});

test("a turn stopped while a request is out sends nothing more: no retry after the key is removed, the brain switched or New chat", async (t) => {
  const stops: [string, (ctx: Awaited<ReturnType<typeof sageWithClaude>>) => Promise<unknown>, string][] = [
    [
      "the key removed",
      (ctx) => ctx.handlers[CHANNELS.clearKey]({ brain: "claude" }),
      SETTINGS_CHANGED_REPLY,
    ],
    [
      "the brain switched to this computer",
      (ctx) => ctx.handlers[CHANNELS.saveSettings]({ ...defaultSettings(), brain: "local" }),
      SETTINGS_CHANGED_REPLY,
    ],
    ["New chat", (ctx) => ctx.handlers[CHANNELS.reset](undefined), CLEARED_REPLY],
  ];
  for (const honoursAbort of [false, true]) {
    for (const [what, stop, expected] of stops) {
      const held = deferred<Response>();
      const ctx = await sageWithClaude(t, (_call, index, init) => {
        if (index === 0) return jsonResponse(200, ROUND_1);
        if (honoursAbort) {
          // As a real request does: the turn's signal cancels it.
          init.signal?.addEventListener("abort", () => held.resolve(jsonResponse(400, SIGNATURE_ERROR)));
        }
        return held.promise;
      });
      const turn = ctx.sage.assistant.send("what do I have?");
      while (ctx.calls.length < 2) await settled();
      await stop(ctx);
      // The service then refuses a thinking signature: the retry is not sent for a stopped turn.
      held.resolve(jsonResponse(400, SIGNATURE_ERROR));
      assert.equal(await turn, expected, what);
      await settled();
      assert.equal(ctx.calls.length, 2, `${what}: no request after the turn stopped`);
    }
  }
});

test("each request reads the key again, the retry included, and none is sent once the signal fired", async () => {
  const keys = [KEY, "fake-claude-key-replaced"];
  let reads = 0;
  const controller = new AbortController();
  const fake = fakeFetch((_call) => jsonResponse(400, SIGNATURE_ERROR));
  const claude = new MessagesBrain({
    model: "claude-sonnet-5-5",
    getKey: async () => keys[Math.min(reads++, 1)]!,
    fetch: fake.fetch,
  });
  await claude.chat([{ role: "user", content: "q" }], tools);
  assert.equal(reads, 2);
  assert.deepEqual(
    fake.calls.map((call) => call.headers["x-api-key"]),
    [KEY, "fake-claude-key-replaced"],
  );
  // A key removed before the retry: nothing is sent without one.
  let removed = false;
  const gone = fakeFetch(() => {
    removed = true;
    return jsonResponse(400, SIGNATURE_ERROR);
  });
  const vanishing = new MessagesBrain({
    model: "m",
    getKey: async () => (removed ? null : KEY),
    fetch: gone.fetch,
  });
  assert.deepEqual(await vanishing.chat([{ role: "user", content: "q" }], tools), {
    ok: false,
    message: "Add your Claude key in Settings first.",
  });
  assert.equal(gone.calls.length, 1);
  // The signal fires while the first request is out: no retry.
  const stopping = fakeFetch(() => {
    controller.abort();
    return jsonResponse(400, SIGNATURE_ERROR);
  });
  const stopped = new MessagesBrain({ model: "m", getKey: async () => KEY, fetch: stopping.fetch });
  const reply = await stopped.chat([{ role: "user", content: "q" }], tools, { signal: controller.signal });
  assert.ok(!reply.ok);
  assert.equal(stopping.calls.length, 1);
  assert.equal((await stopped.chat([], tools, { signal: controller.signal })).ok, false);
  assert.equal(stopping.calls.length, 1, "an already-stopped turn sends nothing");
});
