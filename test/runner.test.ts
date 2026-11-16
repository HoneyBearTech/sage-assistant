import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import {
  hasModel,
  MAX_PULL_LINE_BYTES,
  PULL_MESSAGES,
  PULL_STALL_MS,
  type PullProgress,
  pullErrorMessage,
  RunnerClient,
  sameModel,
} from "../src/core/brain/runner.js";
import { deferred, fakeServer, json, ManualTimers, type Recorded, REFUSED_PORT } from "./helpers.js";

// The local model runner's model list, model download and model details, against a fake runner on
// 127.0.0.1 started by each test.

const RUNNER_TEXT = "secret-runner-wording-xyz";

function lines(res: ServerResponse, items: unknown[], end = true): void {
  res.writeHead(200, { "content-type": "application/x-ndjson" });
  for (const item of items) res.write(`${JSON.stringify(item)}\n`);
  if (end) res.end();
}

async function runner(
  t: Parameters<typeof fakeServer>[0],
  handler: (req: Recorded, res: ServerResponse) => void,
) {
  const server = await fakeServer(t, handler);
  return { server, client: new RunnerClient({ port: server.port }) };
}

test("model names match exactly, and an untagged name is the same as its latest tag", () => {
  assert.equal(sameModel("qwen3:4b", "qwen3:4b"), true);
  assert.equal(sameModel("qwen3:4b", "qwen3:1.7b"), false);
  assert.equal(sameModel("qwen3:4b-q8_0", "qwen3:4b"), false, "a different build isn't the same model");
  assert.equal(sameModel("mymodel:latest", "mymodel"), true);
  assert.equal(sameModel("mymodel", "mymodel:latest"), true);
  assert.equal(sameModel("mymodel:7b", "mymodel"), false);
  assert.equal(sameModel("QWEN3:4b", "qwen3:4b"), false, "names are compared exactly");
  // A registry with a port: the colon there isn't a tag.
  assert.equal(sameModel("host:5000/team/model:latest", "host:5000/team/model"), true);
  assert.equal(hasModel(["a:1", "qwen3:1.7b"], "qwen3:1.7b"), true);
  assert.equal(hasModel([], "qwen3:1.7b"), false);
});

test("the model list comes from GET /api/tags on 127.0.0.1", async (t) => {
  const { server, client } = await runner(t, (_req, res) =>
    json(res, 200, { models: [{ name: "qwen3:4b", size: 1 }, { name: "other:latest" }] }),
  );
  assert.deepEqual(await client.models(), { ok: true, names: ["qwen3:4b", "other:latest"] });
  assert.equal(server.requests[0]!.method, "GET");
  assert.equal(server.requests[0]!.url, "/api/tags");
});

test("no runner, a broken reply, a refused redirect or a slow runner give a plain answer", async (t) => {
  assert.deepEqual(await new RunnerClient({ port: REFUSED_PORT }).models(), {
    ok: false,
    reason: "unreachable",
  });
  for (const [name, handler] of [
    ["an error status", (_req: Recorded, res: ServerResponse) => json(res, 500, { error: RUNNER_TEXT })],
    ["not JSON", (_req: Recorded, res: ServerResponse) => res.end("<html>")],
    ["the wrong shape", (_req: Recorded, res: ServerResponse) => json(res, 200, { models: "none" })],
    [
      "too large",
      (_req: Recorded, res: ServerResponse) =>
        json(res, 200, { models: [{ name: "x".repeat(400) }], padding: "x".repeat(1_100_000) }),
    ],
  ] as const) {
    const { client } = await runner(t, handler);
    assert.deepEqual(await client.models(), { ok: false, reason: "unreadable" }, name);
  }
  // A redirect is never followed.
  const target = await fakeServer(t, (_req, res) => json(res, 200, { models: [] }));
  const { client } = await runner(t, (_req, res) => {
    res.writeHead(302, { location: `${target.url}/api/tags` });
    res.end();
  });
  assert.deepEqual(await client.models(), { ok: false, reason: "unreachable" });
  assert.equal(target.requests.length, 0);
  // A runner that never answers: the outcome is the same however slow the machine is.
  const silent = await fakeServer(t, () => {});
  const slow = new RunnerClient({ port: silent.port, statusTimeoutMs: 20 });
  assert.deepEqual(await slow.models(), { ok: false, reason: "unreachable" });
});

test("a download streams its progress per layer, and ends on the runner's success line", async (t) => {
  const { server, client } = await runner(t, (_req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write('{"status":"pulling manifest"}\n');
    res.write('{"status":"pulling a","digest":"sha256:a","total":1000,"completed":250}\n{"status":"pul');
    res.write('ling b","digest":"sha256:b","total":3000}\n');
    res.write('{"status":"pulling a","digest":"sha256:a","total":1000,"completed":1000}\n');
    res.write('{"status":"pulling b","digest":"sha256:b","total":3000,"completed":3000}\n\n');
    res.write('{"status":"verifying sha256 digest"}\n{"status":"writing manifest"}\n');
    res.end('{"status":"success"}\n');
  });
  const seen: PullProgress[] = [];
  const timers = new ManualTimers();
  const outcome = await client.pull("qwen3:4b", {
    signal: new AbortController().signal,
    onProgress: (progress) => seen.push(progress),
    timers,
  });
  assert.deepEqual(outcome, { status: "done" });
  assert.deepEqual(seen, [
    { completed: 250, total: 1000 },
    { completed: 250, total: 4000 },
    { completed: 1000, total: 4000 },
    { completed: 4000, total: 4000 },
  ]);
  const request = server.requests[0]!;
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/api/pull");
  assert.deepEqual(JSON.parse(request.body), { model: "qwen3:4b", stream: true });
  assert.ok(timers.started.every((ms) => ms === PULL_STALL_MS));
  assert.equal(timers.pending.size, 0, "nothing left waiting");
  assert.equal(PULL_STALL_MS, 120_000);
});

test("the last line may end without a newline", async (t) => {
  const { client } = await runner(t, (_req, res) => {
    res.writeHead(200);
    res.end('{"status":"success"}');
  });
  assert.deepEqual(await client.pull("m", { signal: new AbortController().signal }), { status: "done" });
});

test("an error line or status gives Sage's own message, never the runner's text", async (t) => {
  const cases: [string, string][] = [
    [`write /models/blobs: no space left on device ${RUNNER_TEXT}`, PULL_MESSAGES.disk],
    [`pull model manifest: file does not exist ${RUNNER_TEXT}`, PULL_MESSAGES.notFound],
    [`Get "https://registry": dial tcp: lookup registry: no such host ${RUNNER_TEXT}`, PULL_MESSAGES.offline],
    [`something else went wrong ${RUNNER_TEXT}`, PULL_MESSAGES.other],
  ];
  for (const [error, message] of cases) {
    const { client } = await runner(t, (_req, res) =>
      lines(res, [{ status: "pulling manifest" }, { error }]),
    );
    const outcome = await client.pull("m", { signal: new AbortController().signal });
    assert.deepEqual(outcome, { status: "failed", message }, error);
    assert.ok(!JSON.stringify(outcome).includes(RUNNER_TEXT));
  }
  // Not a string: still Sage's own message.
  const { client: odd } = await runner(t, (_req, res) => lines(res, [{ error: { nested: RUNNER_TEXT } }]));
  assert.deepEqual(await odd.pull("m", { signal: new AbortController().signal }), {
    status: "failed",
    message: PULL_MESSAGES.other,
  });
  // A refused request: the error in its body, or only its status.
  const { client: missing } = await runner(t, (_req, res) =>
    json(res, 500, { error: `pull model manifest: file does not exist ${RUNNER_TEXT}` }),
  );
  assert.deepEqual(await missing.pull("m", { signal: new AbortController().signal }), {
    status: "failed",
    message: PULL_MESSAGES.notFound,
  });
  const { client: notFound } = await runner(t, (_req, res) => {
    res.writeHead(404);
    res.end("not json");
  });
  assert.deepEqual(await notFound.pull("m", { signal: new AbortController().signal }), {
    status: "failed",
    message: PULL_MESSAGES.notFound,
  });
  const { client: broken } = await runner(t, (_req, res) => json(res, 500, {}));
  assert.deepEqual(await broken.pull("m", { signal: new AbortController().signal }), {
    status: "failed",
    message: PULL_MESSAGES.other,
  });
  assert.equal(pullErrorMessage("Disk quota exceeded"), PULL_MESSAGES.disk);
  assert.equal(pullErrorMessage("i/o timeout"), PULL_MESSAGES.offline);
  assert.equal(pullErrorMessage("", 404), PULL_MESSAGES.notFound);
});

test("an oversized, malformed or unexpected line stops the download with a plain message", async (t) => {
  const bad: [string, (res: ServerResponse) => void][] = [
    [
      "oversized",
      (res) => {
        res.writeHead(200);
        res.write('{"status":"pulling a","digest":"sha256:a","total":10,"completed":1}\n');
        // More than the cap, in pieces, with no newline: never held whole.
        const piece = "x".repeat(16 * 1024);
        for (let i = 0; i < 6; i++) res.write(piece);
      },
    ],
    [
      "malformed JSON",
      (res) => {
        res.writeHead(200);
        res.end('{"status": "pull\n');
      },
    ],
    ["the wrong shape", (res) => lines(res, [{ status: "pulling", total: "lots", digest: "a" }])],
    ["not an object", (res) => lines(res, ["success"])],
  ];
  for (const [name, send] of bad) {
    const { client } = await runner(t, (_req, res) => send(res));
    const outcome = await client.pull("m", { signal: new AbortController().signal });
    assert.deepEqual(outcome, { status: "failed", message: PULL_MESSAGES.unreadable }, name);
  }
  assert.equal(MAX_PULL_LINE_BYTES, 64 * 1024);
  // The stream ends without the success line.
  const { client } = await runner(t, (_req, res) => lines(res, [{ status: "pulling manifest" }]));
  assert.deepEqual(await client.pull("m", { signal: new AbortController().signal }), {
    status: "failed",
    message: PULL_MESSAGES.other,
  });
  // No runner at all.
  assert.deepEqual(
    await new RunnerClient({ port: REFUSED_PORT }).pull("m", { signal: new AbortController().signal }),
    {
      status: "failed",
      message: PULL_MESSAGES.unreachable,
    },
  );
});

test("a download with no new line for 2 minutes is stopped, before or after it starts", async (t) => {
  // The runner takes the request and never answers.
  const arrived = deferred<void>();
  const { client: silent } = await runner(t, () => arrived.resolve());
  const timers = new ManualTimers();
  const waiting = silent.pull("m", { signal: new AbortController().signal, timers });
  await arrived.promise;
  assert.deepEqual(
    [...timers.pending.values()].map((p) => p.ms),
    [PULL_STALL_MS],
  );
  timers.fire();
  assert.deepEqual(await waiting, { status: "failed", message: PULL_MESSAGES.stalled });

  // It sends some progress, then nothing more.
  const { client } = await runner(t, (_req, res) =>
    lines(res, [{ status: "pulling a", digest: "a", total: 10, completed: 2 }], false),
  );
  const later = new ManualTimers();
  const progressed = deferred<void>();
  const running = client.pull("m", {
    signal: new AbortController().signal,
    timers: later,
    onProgress: () => progressed.resolve(),
  });
  await progressed.promise;
  assert.equal(later.pending.size, 1, "one wait running at a time");
  later.fire();
  assert.deepEqual(await running, { status: "failed", message: PULL_MESSAGES.stalled });
  assert.equal(later.pending.size, 0);
});

test("Cancel stops a download at any point, and is a cancel, not an error", async (t) => {
  const { client } = await runner(t, (_req, res) =>
    lines(res, [{ status: "pulling a", digest: "a", total: 10, completed: 2 }], false),
  );
  const controller = new AbortController();
  const progressed = deferred<void>();
  const timers = new ManualTimers();
  const running = client.pull("m", {
    signal: controller.signal,
    timers,
    onProgress: () => progressed.resolve(),
  });
  await progressed.promise;
  controller.abort(new Error("cancelled"));
  assert.deepEqual(await running, { status: "cancelled" });
  assert.equal(timers.pending.size, 0);

  // Cancelled before the runner answered.
  const arrived = deferred<void>();
  const { client: silent } = await runner(t, () => arrived.resolve());
  const early = new AbortController();
  const waiting = silent.pull("m", { signal: early.signal, timers });
  await arrived.promise;
  early.abort(new Error("cancelled"));
  assert.deepEqual(await waiting, { status: "cancelled" });
});

test("whether a model can use tools: from its capabilities, or unknown if the runner doesn't say", async (t) => {
  const answers: unknown[] = [
    { capabilities: ["completion", "tools", "thinking"] },
    { capabilities: ["completion"] },
    { details: { family: "x" } },
  ];
  let index = 0;
  const { server, client } = await runner(t, (_req, res) => json(res, 200, answers[index++]));
  assert.equal(await client.toolSupport("qwen3:4b"), "tools");
  assert.equal(await client.toolSupport("qwen3:4b"), "no-tools");
  assert.equal(await client.toolSupport("qwen3:4b"), "unknown");
  assert.equal(server.requests[0]!.url, "/api/show");
  assert.equal(server.requests[0]!.method, "POST");
  assert.deepEqual(JSON.parse(server.requests[0]!.body), { model: "qwen3:4b" });

  const { client: missing } = await runner(t, (_req, res) => json(res, 404, { error: RUNNER_TEXT }));
  assert.equal(await missing.toolSupport("m"), "unknown");
  const { client: odd } = await runner(t, (_req, res) => json(res, 200, { capabilities: "tools" }));
  assert.equal(await odd.toolSupport("m"), "unknown");
  assert.equal(await new RunnerClient({ port: REFUSED_PORT }).toolSupport("m"), "unknown");
});
