import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCAL_HOST, LOCAL_PORT, LocalBrain, UNREACHABLE_MESSAGE } from "../src/core/brain/local.js";
import { closedPort, fakeServer, json } from "./helpers.js";

const tools = [{ name: "add_note", description: "Add a note", parameters: { type: "object" } }];

test("the local brain is fixed to the loopback address and the standard port", () => {
  assert.equal(LOCAL_HOST, "127.0.0.1");
  assert.equal(LOCAL_PORT, 11434);
});

test("sends the conversation and tools to /api/chat and returns the reply", async (t) => {
  const server = await fakeServer(t, (_req, res) =>
    json(res, 200, { message: { role: "assistant", content: "Hello there" }, done: true }),
  );
  const brain = new LocalBrain({ model: "small-model", port: server.port });
  const reply = await brain.chat(
    [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "a", name: "add_note", args: { title: "x", text: "y" } }],
      },
      { role: "tool", toolCallId: "a", name: "add_note", content: "saved" },
    ],
    tools,
  );
  assert.deepEqual(reply, { ok: true, content: "Hello there", toolCalls: [] });
  const request = server.requests[0]!;
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/api/chat");
  const body = JSON.parse(request.body);
  assert.equal(body.model, "small-model");
  assert.equal(body.stream, false);
  assert.deepEqual(body.tools, [{ type: "function", function: tools[0] }]);
  assert.deepEqual(body.messages[2].tool_calls, [
    { function: { name: "add_note", arguments: { title: "x", text: "y" } } },
  ]);
  assert.deepEqual(body.messages[3], { role: "tool", content: "saved", tool_name: "add_note" });
});

test("tool calls get Sage's own ids, and string arguments are parsed", async (t) => {
  const server = await fakeServer(t, (_req, res) =>
    json(res, 200, {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          { function: { name: "add_note", arguments: { title: "a", text: "b" } } },
          { function: { name: "web_search", arguments: '{"query":"weather"}' } },
        ],
      },
    }),
  );
  const reply = await new LocalBrain({ model: "m", port: server.port }).chat([], tools);
  assert.ok(reply.ok);
  assert.equal(reply.toolCalls.length, 2);
  assert.deepEqual(reply.toolCalls[0]!.args, { title: "a", text: "b" });
  assert.deepEqual(reply.toolCalls[1]!.args, { query: "weather" });
  assert.notEqual(reply.toolCalls[0]!.id, reply.toolCalls[1]!.id);
  assert.match(reply.toolCalls[0]!.id, /^[0-9a-f-]{36}$/);
});

test("says Ollama isn't running when nothing answers", async () => {
  const brain = new LocalBrain({ model: "m", port: await closedPort() });
  assert.deepEqual(await brain.chat([], tools), { ok: false, message: UNREACHABLE_MESSAGE });
  assert.match(UNREACHABLE_MESSAGE, /Is Ollama running\?/);
});

test("explains how to download a missing model", async (t) => {
  const server = await fakeServer(t, (_req, res) => json(res, 404, { error: "model not found" }));
  const reply = await new LocalBrain({ model: "tiny:1b", port: server.port }).chat([], tools);
  assert.deepEqual(reply, {
    ok: false,
    message: 'The local model "tiny:1b" isn\'t downloaded yet. Run: ollama pull tiny:1b',
  });
});

test("reports other errors, bad JSON and replies of the wrong shape in plain words", async (t) => {
  let mode = "500";
  const server = await fakeServer(t, (_req, res) => {
    if (mode === "500") return json(res, 500, { error: "boom" });
    if (mode === "bad-json") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end("{not json");
    }
    return json(res, 200, { message: { content: 5 } });
  });
  const brain = new LocalBrain({ model: "m", port: server.port });
  const first = await brain.chat([], tools);
  assert.ok(!first.ok && /HTTP 500/.test(first.message));
  mode = "bad-json";
  const second = await brain.chat([], tools);
  assert.ok(!second.ok && /couldn't read/.test(second.message));
  mode = "wrong-shape";
  const third = await brain.chat([], tools);
  assert.ok(!third.ok && /couldn't read/.test(third.message));
});

test("gives up with a clear message when the runner is too slow", async (t) => {
  const server = await fakeServer(t, () => {
    /* never answers */
  });
  const reply = await new LocalBrain({ model: "m", port: server.port, timeoutMs: 50 }).chat([], tools);
  assert.deepEqual(reply, { ok: false, message: "The local model took too long to answer. Try again." });
});
