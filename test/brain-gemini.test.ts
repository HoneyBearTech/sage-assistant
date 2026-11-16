import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage } from "../src/core/brain/brain.js";
import {
  CREDIT_TOO_LOW,
  failureMessage,
  QUOTA_PER_DAY,
  readErrorKinds,
  serviceName,
  THINKING_SIGNATURE,
} from "../src/core/brain/errors.js";
import { GeminiBrain, generateRequest, geminiModel } from "../src/core/brain/gemini.js";
import { createSage } from "../src/core/sage.js";
import { defaultSettings } from "../src/core/settings.js";
import { failingBody, FakePresenter, fakeFetch, jsonResponse, memoryKeyStores, tempDir } from "./helpers.js";

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
  assert.deepEqual(answer, {
    ok: true,
    content: "Hello!",
    toolCalls: [],
    replay: { format: "generate", items: [{ text: "Hello!" }] },
  });
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

test("the model's turn goes back exactly as it came, signatures and ids included, with each result's id", async () => {
  const parts = [
    { text: "thinking out loud", thought: true },
    {
      functionCall: { id: "fc-1a2b", name: "web_search", args: { query: "news" } },
      thoughtSignature: "CiQBjz1rX2sQ0y8u7V+YQ7d6aW3pZ1nO9eXcG4hK2lM5vR8tU0w=",
    },
    { functionCall: { name: "web_search", args: { query: "more" } } },
    // A skill with no arguments may come without any.
    { functionCall: { id: "fc-3c4d", name: "list_notes" } },
  ];
  const { gemini } = brain(() => jsonResponse(200, reply(parts)));
  const first = await gemini.chat([{ role: "user", content: "q" }], tools);
  assert.ok(first.ok);
  assert.equal(first.content, "", "the model's own reasoning isn't part of the answer");
  assert.deepEqual(
    first.toolCalls.map((call) => [call.name, call.args, call.serviceId]),
    [
      ["web_search", { query: "news" }, "fc-1a2b"],
      ["web_search", { query: "more" }, undefined],
      ["list_notes", {}, "fc-3c4d"],
    ],
  );
  assert.notEqual(first.toolCalls[0]!.id, "fc-1a2b", "Sage's own id for approval");
  assert.deepEqual(first.replay, { format: "generate", items: parts });

  // What the assistant sends next: the model's turn as it came, then the results.
  const messages: ChatMessage[] = [
    { role: "user", content: "q" },
    { role: "assistant", content: "", toolCalls: first.toolCalls, replay: first.replay! },
    ...first.toolCalls.map((call) => ({
      role: "tool" as const,
      toolCallId: call.id,
      name: call.name,
      content: "results",
    })),
  ];
  const body = generateRequest(messages, tools);
  assert.equal(JSON.stringify((body.contents as unknown[])[1]), JSON.stringify({ role: "model", parts }));
  assert.deepEqual((body.contents as unknown[])[2], {
    role: "user",
    parts: [
      { functionResponse: { id: "fc-1a2b", name: "web_search", response: { result: "results" } } },
      { functionResponse: { name: "web_search", response: { result: "results" } } },
      { functionResponse: { id: "fc-3c4d", name: "list_notes", response: { result: "results" } } },
    ],
  });
  // Past the skill limit: the very same declarations, with mode NONE.
  const done = generateRequest(messages, tools, false);
  assert.deepEqual(done.toolConfig, { functionCallingConfig: { mode: "NONE" } });
  assert.equal(JSON.stringify(done.tools), JSON.stringify(body.tools));
  assert.equal(generateRequest([{ role: "user", content: "hi" }], []).tools, undefined);
  // A turn without a replay (from elsewhere) is rebuilt with its ids.
  const rebuilt = generateRequest(
    [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "s", name: "list_notes", args: {}, serviceId: "fc-9" }],
      },
    ],
    tools,
  );
  assert.deepEqual((rebuilt.contents as unknown[])[0], {
    role: "model",
    parts: [{ functionCall: { name: "list_notes", args: {}, id: "fc-9" } }],
  });
});

test("an echoed key is removed from the text and the arguments Sage shows or acts on", async () => {
  const { gemini } = brain(() =>
    jsonResponse(
      200,
      reply([{ text: `key ${KEY}` }, { functionCall: { name: "add_note", args: { text: KEY } } }]),
    ),
  );
  const answer = await gemini.chat([{ role: "user", content: "q" }], tools);
  assert.ok(answer.ok);
  assert.equal(answer.content, "key [redacted]");
  assert.deepEqual(answer.toolCalls[0]!.args, { text: "[redacted]" });
  assert.ok(!JSON.stringify([answer.content, answer.toolCalls]).includes(KEY));
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
    // A daily quota used up: waiting a minute won't help.
    [
      429,
      {
        error: {
          code: 429,
          message: `Google's own words ${KEY}`,
          status: "RESOURCE_EXHAUSTED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [
                {
                  quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                  quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                  quotaDimensions: { location: "global", model: "gemini-3.8-flash" },
                  quotaValue: "250",
                },
              ],
            },
            { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "41s" },
          ],
        },
      },
      /credit or quota is used up/,
    ],
    // A per-minute quota is a rate limit, as before.
    [
      429,
      {
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }],
            },
          ],
        },
      },
      /rate limit/,
    ],
    // The documented daily-quota code.
    [429, { error: { code: "quota_exceeded", message: "daily" } }, /credit or quota is used up/],
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
  for (const kind of [CREDIT_TOO_LOW, QUOTA_PER_DAY]) {
    assert.match(failureMessage(serviceName("Claude"), 400, new Set([kind])), /credit or quota is used up/);
  }
});

test("an error's message is only searched for a few fixed phrases, never kept", async () => {
  const credit = await readErrorKinds(
    jsonResponse(400, {
      type: "error",
      error: { type: "invalid_request_error", message: "Your Credit Balance is too low to access the API." },
    }),
  );
  assert.deepEqual([...credit].sort(), ["error", "invalid_request_error", CREDIT_TOO_LOW]);
  const signature = await readErrorKinds(
    jsonResponse(400, {
      type: "error",
      error: {
        type: "invalid_request_error",
        message:
          "messages.3.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation.",
      },
    }),
  );
  assert.ok(signature.has(THINKING_SIGNATURE));
  const plain = await readErrorKinds(
    jsonResponse(400, {
      error: { type: "invalid_request_error", message: "messages: text content blocks must be non-empty" },
    }),
  );
  assert.deepEqual([...plain], ["invalid_request_error"], "nothing from the message itself");
});

test("through Sage itself: a skill with no arguments runs, and its result goes back with the call's id", async (t) => {
  const first = [
    {
      functionCall: { id: "fc-77", name: "list_notes" },
      thoughtSignature: "CiQBjz1rX2sQ0y8u7V+YQ7d6aW3pZ1nO==",
    },
  ];
  let index = 0;
  const fake = fakeFetch(() =>
    jsonResponse(200, index++ === 0 ? reply(first) : reply([{ text: "You have one note." }])),
  );
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
  await sage.keyStore.setCompanyKey("gemini", KEY);
  await sage.settings.save({ ...defaultSettings(), brain: "gemini" });
  await sage.notes.add("Shopping", "milk");
  assert.equal(await sage.assistant.send("what notes do I have?"), "You have one note.");
  const [one, two] = fake.calls.map((call) => JSON.parse(call.body));
  assert.equal(JSON.stringify(two.contents[1]), JSON.stringify({ role: "model", parts: first }));
  const response = two.contents[2].parts[0].functionResponse;
  assert.equal(response.id, "fc-77");
  assert.equal(response.name, "list_notes");
  assert.match(response.response.result, /Shopping/, "the skill ran");
  assert.equal(JSON.stringify(two.tools), JSON.stringify(one.tools));
  assert.deepEqual(two.contents.slice(0, one.contents.length), one.contents);
});
