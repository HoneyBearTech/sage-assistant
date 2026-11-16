import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage } from "../src/core/brain/brain.js";
import { failureMessage, readErrorKinds, serviceName } from "../src/core/brain/errors.js";
import { GeminiBrain, generateRequest, geminiModel } from "../src/core/brain/gemini.js";
import { failingBody, fakeFetch, jsonResponse } from "./helpers.js";

// Gemini through Google's own generateContent format: recorded replies, never the real service.

const KEY = "fake-gemini-key-for-tests";
const tools = [
  { name: "web_search", description: "Search", parameters: { type: "object", additionalProperties: false } },
];

function brain(handler: Parameters<typeof fakeFetch>[0], model = "gemini-3.8-flash") {
  const fake = fakeFetch(handler);
  const asked: string[] = [];
  const gemini = new GeminiBrain({
    model,
    getKey: async (url) => {
      asked.push(url);
      return KEY;
    },
    fetch: fake.fetch,
  });
  return { gemini, calls: fake.calls, asked };
}

const reply = (parts: unknown[]) => ({ candidates: [{ content: { role: "model", parts } }] });

test("posts to Google's fixed address with the key in a header, never in the address", async () => {
  const { gemini, calls, asked } = brain(() => jsonResponse(200, reply([{ text: "Hello!" }])));
  const answer = await gemini.chat(
    [
      { role: "system", content: "You are Sage." },
      { role: "user", content: "hi" },
    ],
    tools,
  );
  assert.deepEqual(answer, { ok: true, content: "Hello!", toolCalls: [] });
  const call = calls[0]!;
  assert.equal(
    call.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
  );
  assert.ok(!call.url.includes(KEY));
  assert.deepEqual(asked, [call.url], "the key is asked for the exact address the request goes to");
  assert.equal(call.redirect, "error");
  assert.deepEqual(call.headers, { "x-goog-api-key": KEY, "content-type": "application/json" });
  const body = JSON.parse(call.body);
  assert.deepEqual(body.systemInstruction, { parts: [{ text: "You are Sage." }] });
  assert.deepEqual(body.contents, [{ role: "user", parts: [{ text: "hi" }] }]);
  assert.deepEqual(body.tools, [
    {
      functionDeclarations: [
        { name: "web_search", description: "Search", parametersJsonSchema: tools[0]!.parameters },
      ],
    },
  ]);
  assert.deepEqual(body.toolConfig, { functionCallingConfig: { mode: "AUTO" } });
});

test("the model name is checked before it goes into the address", async () => {
  assert.equal(geminiModel("models/gemini-3.6-flash"), "gemini-3.6-flash");
  assert.equal(geminiModel(" gemini-2.5-flash-lite "), "gemini-2.5-flash-lite");
  for (const bad of ["../v1/files", "gemini?x=1", "a/b", "gemini 3", "", "-x", "x".repeat(129)]) {
    assert.equal(geminiModel(bad), null, bad);
  }
  const { gemini, calls } = brain(() => jsonResponse(200, reply([])), "../../upload");
  const refused = await gemini.chat([{ role: "user", content: "q" }], tools);
  assert.ok(!refused.ok && /model name in Settings isn't valid/.test(refused.message));
  assert.equal(calls.length, 0);
  const empty = brain(() => jsonResponse(200, reply([])), "  ");
  assert.deepEqual(await empty.gemini.chat([], tools), {
    ok: false,
    message: "Choose the model for Gemini in Settings first.",
  });
});

test("skill requests carry their thought signatures back on the next request of the turn", async () => {
  const { gemini } = brain(() =>
    jsonResponse(
      200,
      reply([
        { text: "thinking out loud", thought: true },
        { functionCall: { name: "web_search", args: { query: "news" } }, thoughtSignature: "c2lnbmF0dXJl" },
        { functionCall: { name: "web_search", args: { query: "more" } } },
        { functionCall: { name: "web_search", args: {} }, thoughtSignature: "not base64 !" },
      ]),
    ),
  );
  const first = await gemini.chat([{ role: "user", content: "q" }], tools);
  assert.ok(first.ok);
  assert.equal(first.content, "", "the model's own reasoning isn't part of the answer");
  assert.deepEqual(
    first.toolCalls.map((call) => [call.args, call.signature]),
    [
      [{ query: "news" }, "c2lnbmF0dXJl"],
      [{ query: "more" }, undefined],
      [{}, undefined],
    ],
  );
  assert.notEqual(first.toolCalls[0]!.id, first.toolCalls[1]!.id);

  // What the assistant sends next: the calls as they came, then their results.
  const messages: ChatMessage[] = [
    { role: "user", content: "q" },
    { role: "assistant", content: "", toolCalls: first.toolCalls },
    ...first.toolCalls.map((call) => ({
      role: "tool" as const,
      toolCallId: call.id,
      name: call.name,
      content: "results",
    })),
  ];
  const body = generateRequest(messages, tools);
  assert.deepEqual(body.contents, [
    { role: "user", parts: [{ text: "q" }] },
    {
      role: "model",
      parts: [
        { functionCall: { name: "web_search", args: { query: "news" } }, thoughtSignature: "c2lnbmF0dXJl" },
        { functionCall: { name: "web_search", args: { query: "more" } } },
        { functionCall: { name: "web_search", args: {} } },
      ],
    },
    {
      role: "user",
      parts: [1, 2, 3].map(() => ({
        functionResponse: { name: "web_search", response: { result: "results" } },
      })),
    },
  ]);
  // With no skills left to offer, the earlier requests stay valid and skills are switched off.
  const done = generateRequest(messages, []);
  assert.deepEqual(done.toolConfig, { functionCallingConfig: { mode: "NONE" } });
  assert.deepEqual(done.tools, [
    {
      functionDeclarations: [
        { name: "web_search", description: "Not available now.", parametersJsonSchema: { type: "object" } },
      ],
    },
  ]);
  assert.equal(generateRequest([{ role: "user", content: "hi" }], []).tools, undefined);
});

test("an echoed key is removed from the text and the arguments, and a signature that holds it is dropped", async () => {
  const { gemini } = brain(() =>
    jsonResponse(
      200,
      reply([
        { text: `key ${KEY}` },
        { functionCall: { name: "add_note", args: { text: KEY } }, thoughtSignature: `abc${KEY}` },
      ]),
    ),
  );
  const answer = await gemini.chat([{ role: "user", content: "q" }], tools);
  assert.ok(answer.ok);
  assert.equal(answer.content, "key [redacted]");
  assert.deepEqual(answer.toolCalls[0]!.args, { text: "[redacted]" });
  assert.equal(answer.toolCalls[0]!.signature, undefined);
  assert.ok(!JSON.stringify(answer).includes(KEY));
});

test("no candidate is an empty answer; an odd reply is unreadable", async () => {
  const blocked = brain(() => jsonResponse(200, { promptFeedback: { blockReason: "SAFETY" } }));
  assert.deepEqual(await blocked.gemini.chat([], tools), { ok: true, content: "", toolCalls: [] });
  const odd = brain(() => jsonResponse(200, { candidates: "no" }));
  assert.deepEqual(await odd.gemini.chat([], tools), {
    ok: false,
    message: "Gemini sent a reply Sage couldn't read.",
  });
  const noKey = new GeminiBrain({ model: "m", getKey: async () => null });
  assert.deepEqual(await noKey.chat([], tools), {
    ok: false,
    message: "Add your Gemini key in Settings first.",
  });
});

test("Google's errors: a bad key (even as a 400), quota or rate limits, a retired model, busy, no network", async () => {
  const google = (code: number, status: string, reason?: string) => ({
    error: {
      code,
      message: `Google's own words ${KEY}`,
      status,
      ...(reason ? { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason }] } : {}),
    },
  });
  const cases: [number, unknown, RegExp][] = [
    [400, google(400, "INVALID_ARGUMENT", "API_KEY_INVALID"), /didn't accept the key/],
    [403, google(403, "PERMISSION_DENIED"), /didn't accept the key/],
    [404, google(404, "NOT_FOUND"), /doesn't know that model, or it was retired/],
    [429, google(429, "RESOURCE_EXHAUSTED"), /rate limit/],
    [503, google(503, "UNAVAILABLE"), /busy or overloaded/],
    // Some answers come wrapped in a list.
    [400, [google(400, "INVALID_ARGUMENT", "API_KEY_INVALID")], /didn't accept the key/],
  ];
  for (const [status, body, pattern] of cases) {
    const { gemini } = brain(() => jsonResponse(status, body));
    const answer = await gemini.chat([], tools);
    assert.ok(!answer.ok);
    assert.match(answer.message, pattern, String(status));
    assert.doesNotMatch(answer.message, /Google's own words/);
    assert.ok(!answer.message.includes(KEY));
  }
  const offline = brain(() => {
    throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
  });
  assert.deepEqual(await offline.gemini.chat([], tools), {
    ok: false,
    message: "Sage can't reach Gemini. Check your internet connection.",
  });
  const slow = brain(() => failingBody(new DOMException("timed out", "TimeoutError")));
  assert.match(((await slow.gemini.chat([], tools)) as { message: string }).message, /took too long/);
});

test("only the known type fields of an error body are read, and only if they look like identifiers", async () => {
  const kinds = await readErrorKinds(
    jsonResponse(429, {
      type: "error",
      error: {
        type: "insufficient_quota",
        code: "x y z",
        status: 5,
        details: [{ reason: "A".repeat(65) }, null],
      },
      message: "anything else is ignored",
    }),
  );
  assert.deepEqual([...kinds].sort(), ["error", "insufficient_quota"]);
  assert.deepEqual([...(await readErrorKinds(new Response("not json", { status: 500 })))], []);
  assert.deepEqual([...(await readErrorKinds(new Response("x".repeat(70_000), { status: 500 })))], []);
  assert.deepEqual([...(await readErrorKinds(jsonResponse(500, "a string")))], []);
  // OpenAI's quota and spending-limit codes count as credit used up, whatever the status.
  const openai = serviceName("OpenAI");
  for (const code of ["insufficient_quota", "credit_balance_exhausted", "project_spend_limit_exceeded"]) {
    assert.match(failureMessage(openai, 429, new Set([code])), /credit or quota is used up/);
  }
  assert.match(failureMessage(openai, 400, new Set(["model_not_found"])), /doesn't know that model/);
  assert.match(failureMessage(openai, 502, new Set()), /busy or overloaded/);
  assert.match(failureMessage(openai, 418, new Set()), /HTTP 418/);
});
