import assert from "node:assert/strict";
import { test } from "node:test";
import { isConnectionRefused, parseArgs } from "../src/core/brain/brain.js";
import { completionsUrl, OnlineBrain } from "../src/core/brain/online.js";
import { failingBody, fakeServer, json, REFUSED_PORT, stallAfterHeaders } from "./helpers.js";

const tools = [{ name: "web_search", description: "Search", parameters: { type: "object" } }];
const KEY = "fake-test-value";

test("builds the endpoint from the base address, with or without /v1", () => {
  assert.equal(completionsUrl("https://api.example.com"), "https://api.example.com/v1/chat/completions");
  assert.equal(completionsUrl("https://api.example.com/v1/"), "https://api.example.com/v1/chat/completions");
  assert.equal(
    completionsUrl("https://api.example.com/compat"),
    "https://api.example.com/compat/v1/chat/completions",
  );
  assert.equal(completionsUrl("http://127.0.0.1:8080"), "http://127.0.0.1:8080/v1/chat/completions");
  assert.equal(completionsUrl("http://localhost:8080"), "http://localhost:8080/v1/chat/completions");
});

test("refuses plain http to other computers, credentials in the address, and junk", () => {
  assert.equal(completionsUrl("http://api.example.com"), null);
  assert.equal(completionsUrl("https://user:pass@api.example.com"), null);
  assert.equal(completionsUrl("https://api.example.com/?x=1"), null);
  assert.equal(completionsUrl("ftp://api.example.com"), null);
  assert.equal(completionsUrl("not a url"), null);
});

test("posts the chat-completions request with the key as a bearer token", async (t) => {
  const server = await fakeServer(t, (_req, res) =>
    json(res, 200, { choices: [{ message: { role: "assistant", content: "Hi!" } }] }),
  );
  const brain = new OnlineBrain({ baseUrl: server.url, model: "some-model", getKey: async () => KEY });
  const reply = await brain.chat(
    [
      { role: "user", content: "hello" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "web_search", args: { query: "q" } }] },
      { role: "tool", toolCallId: "c1", name: "web_search", content: "results" },
    ],
    tools,
  );
  assert.deepEqual(reply, { ok: true, content: "Hi!", toolCalls: [] });
  const request = server.requests[0]!;
  assert.equal(request.url, "/v1/chat/completions");
  assert.equal(request.headers.authorization, `Bearer ${KEY}`);
  const body = JSON.parse(request.body);
  assert.equal(body.model, "some-model");
  assert.equal(body.tool_choice, "auto");
  assert.deepEqual(body.tools, [{ type: "function", function: tools[0] }]);
  assert.deepEqual(body.messages[1].tool_calls, [
    { id: "c1", type: "function", function: { name: "web_search", arguments: '{"query":"q"}' } },
  ]);
  assert.deepEqual(body.messages[2], { role: "tool", tool_call_id: "c1", content: "results" });
});

test("parses tool calls, giving each one Sage's own id instead of the service's", async (t) => {
  const server = await fakeServer(t, (_req, res) =>
    json(res, 200, {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "svc-1",
                type: "function",
                function: { name: "web_search", arguments: '{"query":"news"}' },
              },
              { id: "svc-1", type: "function", function: { name: "web_search", arguments: "{broken" } },
            ],
          },
        },
      ],
    }),
  );
  const brain = new OnlineBrain({ baseUrl: server.url, model: "m", getKey: async () => KEY });
  const reply = await brain.chat([], tools);
  assert.ok(reply.ok);
  assert.equal(reply.content, "");
  assert.deepEqual(reply.toolCalls[0]!.args, { query: "news" });
  assert.equal(reply.toolCalls[1]!.args, "{broken");
  assert.notEqual(reply.toolCalls[0]!.id, "svc-1");
  assert.notEqual(reply.toolCalls[0]!.id, reply.toolCalls[1]!.id);
});

test("a successful reply that echoes the key has it removed from the text and the arguments", async (t) => {
  const server = await fakeServer(t, (_req, res) =>
    json(res, 200, {
      choices: [
        {
          message: {
            content: `<think>${KEY}</think>Here you go: ${KEY} <think>more ${KEY}`,
            tool_calls: [
              {
                id: "x",
                type: "function",
                function: {
                  name: "add_note",
                  arguments: JSON.stringify({ title: KEY, text: `a ${KEY} b`, nested: [{ [KEY]: KEY }] }),
                },
              },
            ],
          },
        },
      ],
    }),
  );
  const brain = new OnlineBrain({
    baseUrl: server.url,
    model: "m",
    getKey: async () => KEY,
    redact: (text) => text.replace("other-secret", "[redacted]"),
  });
  const reply = await brain.chat([], tools);
  assert.ok(reply.ok);
  // Only the leading thinking block goes; the later unclosed tag stays, with the key still removed.
  assert.equal(reply.content, "Here you go: [redacted] <think>more [redacted]");
  assert.deepEqual(reply.toolCalls[0]!.args, {
    title: "[redacted]",
    text: "a [redacted] b",
    nested: [{ "[redacted]": "[redacted]" }],
  });
  assert.ok(!JSON.stringify(reply).includes(KEY));
});

test("refuses online replies larger than about 2 MB", async (t) => {
  const server = await fakeServer(t, (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(`{"choices":[{"message":{"content":"${"y".repeat(2 * 1024 * 1024 + 1)}"}}]}`);
  });
  const reply = await new OnlineBrain({ baseUrl: server.url, model: "m", getKey: async () => KEY }).chat(
    [],
    tools,
  );
  assert.ok(!reply.ok && /couldn't read/.test(reply.message));
});

test("leaves tools out when there are none to offer", async (t) => {
  const server = await fakeServer(t, (_req, res) =>
    json(res, 200, { choices: [{ message: { content: "x" } }] }),
  );
  await new OnlineBrain({ baseUrl: server.url, model: "m", getKey: async () => KEY }).chat([], []);
  const body = JSON.parse(server.requests[0]!.body);
  assert.equal(body.tools, undefined);
  assert.equal(body.tool_choice, undefined);
});

test("asks for missing settings before calling anything", async () => {
  const noKey = new OnlineBrain({ baseUrl: "https://api.example.com", model: "m", getKey: async () => null });
  assert.deepEqual(await noKey.chat([], tools), {
    ok: false,
    message: "Add your online service key in Settings first.",
  });
  const noModel = new OnlineBrain({
    baseUrl: "https://api.example.com",
    model: " ",
    getKey: async () => KEY,
  });
  assert.ok(!(await noModel.chat([], tools)).ok);
  const badUrl = new OnlineBrain({ baseUrl: "http://api.example.com", model: "m", getKey: async () => KEY });
  const reply = await badUrl.chat([], tools);
  assert.ok(!reply.ok && /https:\/\//.test(reply.message));
});

test("maps error statuses to plain messages that never include the key or the reply body", async (t) => {
  let status = 401;
  const server = await fakeServer(t, (req, res) =>
    json(res, status, { error: { message: `bad key ${req.headers.authorization}` } }),
  );
  const brain = new OnlineBrain({ baseUrl: server.url, model: "m", getKey: async () => KEY });
  const expected: Record<number, RegExp> = {
    401: /didn't accept the key/,
    403: /didn't accept the key/,
    404: /didn't recognise/,
    429: /busy or your quota/,
    500: /HTTP 500/,
  };
  for (const [code, pattern] of Object.entries(expected)) {
    status = Number(code);
    const reply = await brain.chat([], tools);
    assert.ok(!reply.ok, `status ${code}`);
    assert.match(reply.message, pattern);
    assert.ok(!reply.message.includes(KEY));
  }
});

test("reports unreadable replies, timeouts and unreachable services", async (t) => {
  let mode = "shape";
  const server = await fakeServer(t, (_req, res) => {
    if (mode === "shape") return json(res, 200, { choices: [] });
    if (mode === "json") {
      res.writeHead(200);
      return res.end("<html>");
    }
    // "slow": never answers
  });
  // Replies that do arrive get the normal timeout, so a busy machine can't turn them into "too long".
  const brain = new OnlineBrain({ baseUrl: server.url, model: "m", getKey: async () => KEY });
  const shape = await brain.chat([], tools);
  assert.ok(!shape.ok && /couldn't read/.test(shape.message), shape.ok ? "ok" : shape.message);
  mode = "json";
  const notJson = await brain.chat([], tools);
  assert.ok(!notJson.ok && /couldn't read/.test(notJson.message), notJson.ok ? "ok" : notJson.message);
  // Only the server that never answers meets a short timeout; it times out however slow the machine is.
  mode = "slow";
  const impatient = new OnlineBrain({
    baseUrl: server.url,
    model: "m",
    getKey: async () => KEY,
    timeoutMs: 50,
  });
  const slow = await impatient.chat([], tools);
  assert.ok(!slow.ok && /too long/.test(slow.message));

  const refused = new OnlineBrain({
    baseUrl: `http://127.0.0.1:${REFUSED_PORT}`,
    model: "m",
    getKey: async () => KEY,
  });
  const down = await refused.chat([], tools);
  assert.ok(!down.ok && /can't reach the online service/.test(down.message));

  const offline = new OnlineBrain({
    baseUrl: "https://api.example.com",
    model: "m",
    getKey: async () => KEY,
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });
  const noNet = await offline.chat([], tools);
  assert.ok(!noNet.ok && /internet connection/.test(noNet.message));
});

test("a reply body that drops or stalls gives the plain unreadable or too-slow message", async (t) => {
  const options = { baseUrl: "https://api.example.com", model: "m", getKey: async () => KEY };
  const dropped = new OnlineBrain({
    ...options,
    fetch: async () => failingBody(new TypeError("terminated")),
  });
  assert.deepEqual(await dropped.chat([], tools), {
    ok: false,
    message: "The online service sent a reply Sage couldn't read.",
  });
  const slowMessage = { ok: false, message: "The online service took too long to answer. Try again." };
  const timedOut = new OnlineBrain({
    ...options,
    fetch: async () => failingBody(new DOMException("The operation timed out.", "TimeoutError")),
  });
  assert.deepEqual(await timedOut.chat([], tools), slowMessage);
  // A real server that sends the start of a reply and then stalls: the body read times out.
  const server = await fakeServer(t, stallAfterHeaders);
  const stalled = new OnlineBrain({ ...options, baseUrl: server.url, timeoutMs: 50 });
  assert.deepEqual(await stalled.chat([], tools), slowMessage);
});

test("helpers: argument parsing and connection-refused detection", () => {
  assert.deepEqual(parseArgs(undefined), {});
  assert.deepEqual(parseArgs("  "), {});
  assert.deepEqual(parseArgs({ a: 1 }), { a: 1 });
  assert.equal(parseArgs("nope"), "nope");
  assert.ok(isConnectionRefused(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } })));
  assert.ok(!isConnectionRefused(new Error("other")));
});
