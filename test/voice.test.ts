import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import type { FetchLike } from "../src/core/brain/brain.js";
import { DOWNLOAD_MESSAGES } from "../src/core/voice/download.js";
import {
  createHelperHandler,
  type HelperReply,
  MAX_TRANSCRIPT_CHARS,
  type SpeechEngine,
  type TranscribeRequest,
} from "../src/core/voice/helper-protocol.js";
import { MAX_SAMPLES, modelDir, moonshineConfig, type SpeechModel } from "../src/core/voice/model.js";
import {
  type HelperProcess,
  HelperTranscriber,
  TRANSCRIBE_MESSAGES,
  TRANSCRIBE_TIMEOUT_MS,
  type Transcriber,
} from "../src/core/voice/transcriber.js";
import { VOICE_MESSAGES, Voice } from "../src/core/voice/voice.js";
import { captureLogs, deferred, fakeServer, settled, tempDir } from "./helpers.js";

// Voice in the main process: the download (asked first), one recording at a time, and the speech
// helper, with a stand-in helper and a stand-in engine. The real engine is checked outside the
// tests (see the pull request); here only its settings are checked against the installed package.

const root = join(import.meta.dirname, "..");
const tunnel: FetchLike = (input, init) =>
  fetch(input.replace(/^https:\/\/127\.0\.0\.1:/, "http://127.0.0.1:"), init);

/** A stand-in for the helper process, controlled by the test. */
class FakeHelper implements HelperProcess {
  readonly sent: TranscribeRequest[] = [];
  killed = false;
  private message: ((message: unknown) => void) | undefined;
  private exit: (() => void) | undefined;
  send(message: TranscribeRequest) {
    this.sent.push(message);
  }
  onMessage(listener: (message: unknown) => void) {
    this.message = listener;
  }
  onExit(listener: () => void) {
    this.exit = listener;
  }
  kill() {
    this.killed = true;
    this.exit?.();
  }
  reply(message: unknown) {
    this.message?.(message);
  }
  crash() {
    this.exit?.();
  }
}

function helpers() {
  const made: FakeHelper[] = [];
  return {
    made,
    start: () => {
      const helper = new FakeHelper();
      made.push(helper);
      return helper;
    },
  };
}

const samples = (n = 1_600) => new Float32Array(n).fill(0.25);

test("the helper manager: one job at a time, the result, and the helper is reused", async () => {
  const { made, start } = helpers();
  const transcriber = new HelperTranscriber(start);
  const first = transcriber.transcribe("/models/m", samples());
  assert.deepEqual(await transcriber.transcribe("/models/m", samples()), {
    ok: false,
    message: TRANSCRIBE_MESSAGES.busy,
  });
  const helper = made[0]!;
  assert.equal(made.length, 1);
  const request = helper.sent[0]!;
  assert.equal(request.type, "transcribe");
  assert.equal(request.modelDir, "/models/m");
  assert.equal(request.sampleRate, 16_000);
  // Replies for another job, or that don't match the format, are ignored.
  helper.reply({ type: "result", id: request.id + 1, text: "not this one" });
  helper.reply({ type: "result", id: request.id, text: 5 });
  helper.reply("rubbish");
  helper.reply({ type: "result", id: request.id, text: "hello", extra: true });
  helper.reply({ type: "result", id: request.id, text: "hello" });
  assert.deepEqual(await first, { ok: true, text: "hello" });

  const second = transcriber.transcribe("/models/m", samples());
  helper.reply({ type: "error", id: helper.sent[1]!.id });
  assert.deepEqual(await second, { ok: false, message: TRANSCRIBE_MESSAGES.failed });
  assert.equal(made.length, 1, "the same helper for every recording");
  transcriber.dispose();
  assert.equal(helper.killed, true);
});

test("a helper that crashes gives a plain message, and the next recording starts a fresh one", async () => {
  const { made, start } = helpers();
  const transcriber = new HelperTranscriber(start);
  const job = transcriber.transcribe("/m", samples());
  made[0]!.crash();
  assert.deepEqual(await job, { ok: false, message: TRANSCRIBE_MESSAGES.crashed });
  // A crash with nothing running is noted too.
  const next = transcriber.transcribe("/m", samples());
  assert.equal(made.length, 2);
  made[1]!.reply({ type: "result", id: made[1]!.sent[0]!.id, text: "ok" });
  assert.deepEqual(await next, { ok: true, text: "ok" });
  made[1]!.crash();
  // An old helper's late messages and exits change nothing.
  made[0]!.reply({ type: "result", id: 1, text: "late" });
  made[0]!.crash();
  const third = transcriber.transcribe("/m", samples());
  assert.equal(made.length, 3);
  made[2]!.reply({ type: "result", id: made[2]!.sent[0]!.id, text: "fresh" });
  assert.deepEqual(await third, { ok: true, text: "fresh" });
});

test("a helper that takes over 60 seconds is stopped, and the next recording starts a fresh one", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { made, start } = helpers();
  const transcriber = new HelperTranscriber(start);
  const job = transcriber.transcribe("/m", samples());
  t.mock.timers.tick(TRANSCRIBE_TIMEOUT_MS - 1);
  assert.equal(made[0]!.killed, false);
  t.mock.timers.tick(1);
  assert.deepEqual(await job, { ok: false, message: TRANSCRIBE_MESSAGES.timeout });
  assert.equal(made[0]!.killed, true);
  assert.equal(TRANSCRIBE_TIMEOUT_MS, 60_000);
  const next = transcriber.transcribe("/m", samples());
  assert.equal(made.length, 2);
  made[1]!.reply({ type: "result", id: made[1]!.sent[0]!.id, text: "ok" });
  assert.deepEqual(await next, { ok: true, text: "ok" });
});

test("a helper that can't be started or sent to gives the plain message", async () => {
  const failing = new HelperTranscriber(() => {
    throw new Error("no helper");
  });
  assert.deepEqual(await failing.transcribe("/m", samples()), {
    ok: false,
    message: TRANSCRIBE_MESSAGES.crashed,
  });
  const broken = new HelperTranscriber(() => {
    const helper = new FakeHelper();
    helper.send = () => {
      throw new Error("closed");
    };
    helper.kill = () => {
      throw new Error("already gone");
    };
    return helper;
  });
  assert.deepEqual(await broken.transcribe("/m", samples()), {
    ok: false,
    message: TRANSCRIBE_MESSAGES.crashed,
  });
  // Sage closing while a recording is worked out.
  const { start } = helpers();
  const closing = new HelperTranscriber(start);
  const job = closing.transcribe("/m", samples());
  closing.dispose();
  assert.deepEqual(await job, { ok: false, message: TRANSCRIBE_MESSAGES.crashed });
});

/** A stand-in for the speech engine. */
function engine(text = " hello there ") {
  const loads: string[] = [];
  const heard: { samples: number; rate: number }[] = [];
  const load = async (dir: string): Promise<SpeechEngine> => {
    loads.push(dir);
    return {
      transcribe: async (s, rate) => {
        heard.push({ samples: s.length, rate });
        return text;
      },
    };
  };
  return { loads, heard, load };
}

test("the helper's side loads the engine once and answers each request", async () => {
  const { loads, heard, load } = engine();
  const replies: HelperReply[] = [];
  const handle = createHelperHandler(load, (reply) => replies.push(reply));
  const request = (id: number, dir = "/models/a") => ({
    type: "transcribe",
    id,
    modelDir: dir,
    sampleRate: 16_000,
    samples: samples(),
  });
  await handle(request(1));
  await handle(request(2));
  assert.deepEqual(loads, ["/models/a"], "loaded once");
  assert.deepEqual(replies, [
    { type: "result", id: 1, text: "hello there" },
    { type: "result", id: 2, text: "hello there" },
  ]);
  assert.deepEqual(heard[0], { samples: 1_600, rate: 16_000 });

  // Malformed requests get an error reply and never reach the engine.
  replies.length = 0;
  for (const bad of [
    null,
    "transcribe",
    { ...request(3), samples: Array.from(samples()) },
    { ...request(4), samples: new Float32Array(0) },
    { ...request(5), samples: new Float32Array(MAX_SAMPLES + 1) },
    { ...request(6), sampleRate: 44_100 },
    { ...request(7), extra: 1 },
    { ...request(-1) },
  ]) {
    await handle(bad);
  }
  assert.deepEqual(
    replies.map((r) => [r.type, r.id]),
    [
      ["error", 0],
      ["error", 0],
      ["error", 3],
      ["error", 4],
      ["error", 5],
      ["error", 6],
      ["error", 7],
      ["error", 0],
    ],
  );
  assert.equal(heard.length, 2);
  await handle(request(8, "/models/b"));
  assert.deepEqual(loads, ["/models/a", "/models/b"]);
});

test("the helper's side reports an engine that fails to load, tries again, and caps the text", async () => {
  let attempts = 0;
  const replies: HelperReply[] = [];
  const handle = createHelperHandler(
    async () => {
      attempts++;
      if (attempts === 1) throw new Error("model files unreadable");
      return {
        transcribe: async (s) => {
          if (s.length === 1) throw new Error("engine failed");
          return "x".repeat(MAX_TRANSCRIPT_CHARS + 50);
        },
      };
    },
    (reply) => replies.push(reply),
  );
  const request = (id: number, n = 1_600) => ({
    type: "transcribe",
    id,
    modelDir: "/m",
    sampleRate: 16_000,
    samples: samples(n),
  });
  await handle(request(1));
  await handle(request(2));
  await handle(request(3, 1));
  assert.equal(attempts, 2, "a failed load isn't kept");
  assert.deepEqual(replies[0], { type: "error", id: 1 });
  assert.equal(replies[1]!.type, "result");
  assert.equal((replies[1] as { text: string }).text.length, MAX_TRANSCRIPT_CHARS);
  assert.deepEqual(replies[2], { type: "error", id: 3 });
});

test("the engine settings use the Moonshine field names the installed sherpa-onnx-node reads", async () => {
  const config = moonshineConfig("/models/m");
  assert.deepEqual(Object.keys(config.modelConfig.moonshine).sort(), ["encoder", "mergedDecoder"]);
  assert.equal(config.modelConfig.moonshine.encoder, join("/models/m", "encoder_model.ort"));
  assert.equal(config.modelConfig.moonshine.mergedDecoder, join("/models/m", "decoder_model_merged.ort"));
  assert.equal(config.modelConfig.tokens, join("/models/m", "tokens.txt"));
  assert.equal(config.featConfig.sampleRate, 16_000);
  // The package's own JavaScript lists "encoder"; its native part reads "mergedDecoder" (the
  // field for Moonshine's two-file models). Only the package for this PC is installed.
  const require = createRequire(join(root, "package.json"));
  const pkg = join(require.resolve("sherpa-onnx-node/package.json"), "..");
  assert.match(await readFile(join(pkg, "types.js"), "utf8"), /OfflineMoonshineModelConfig[\s\S]*?encoder/);
  const native = (await readdir(join(pkg, ".."))).filter((name) =>
    /^sherpa-onnx-(win|linux|darwin)-/.test(name),
  );
  assert.equal(native.length, 1, "exactly one platform package");
  const addon = await readFile(join(pkg, "..", native[0]!, "sherpa-onnx.node"));
  assert.ok(addon.includes("mergedDecoder"), "the native part reads mergedDecoder");
});

// --- The Voice service ---

async function voiceSetup(
  t: Parameters<typeof tempDir>[0],
  options: { confirm?: () => Promise<boolean>; transcriber?: Transcriber } = {},
) {
  const dataDir = await tempDir(t);
  const data = randomBytes(5_000);
  const gate = { hold: undefined as ReturnType<typeof deferred<void>> | undefined };
  const fake = await fakeServer(t, async (_req, res) => {
    await gate.hold?.promise;
    res.writeHead(200);
    res.write(data.subarray(0, 2_000));
    res.end(data.subarray(2_000));
  });
  const model: SpeechModel = {
    id: "m",
    files: [
      {
        name: "tokens.txt",
        url: `https://127.0.0.1:${fake.port}/tokens.txt`,
        size: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      },
    ],
  };
  const asked = { count: 0 };
  const { logger, lines } = captureLogs();
  const heard: { dir: string; samples: Float32Array }[] = [];
  const deps: ConstructorParameters<typeof Voice>[0] = {
    dataDir,
    model,
    fetch: tunnel,
    logger,
    confirmDownload: async () => {
      asked.count++;
      return options.confirm ? options.confirm() : true;
    },
    transcriber: options.transcriber ?? {
      transcribe: async (dir, s) => {
        heard.push({ dir, samples: s });
        return { ok: true, text: "hello" };
      },
      dispose() {},
    },
  };
  return { voice: new Voice(deps), deps, dataDir, model, asked, fake, gate, lines, heard };
}

test("nothing is downloaded unless the user chooses Download in the main process's box", async (t) => {
  for (const confirm of [
    async () => false,
    async () => {
      throw new Error("the box failed");
    },
  ]) {
    const { voice, asked, fake } = await voiceSetup(t, { confirm });
    assert.deepEqual(await voice.downloadModel(), { status: "declined" });
    assert.equal(asked.count, 1);
    assert.equal(fake.requests.length, 0, "no request at all");
    assert.equal((await voice.status()).model, "missing");
  }
});

test("after Download the file is fetched and checked; once ready it isn't asked or fetched again", async (t) => {
  const { voice, asked, fake, lines } = await voiceSetup(t);
  assert.deepEqual(await voice.status(), { model: "missing", received: 0, total: 5_000 });
  assert.deepEqual(await voice.downloadModel(), { status: "done" });
  assert.deepEqual(await voice.status(), { model: "ready", received: 0, total: 5_000 });
  assert.deepEqual(await voice.downloadModel(), { status: "done" });
  assert.equal(asked.count, 1);
  assert.equal(fake.requests.length, 1);
  assert.ok(lines.some((line) => line.includes("downloaded and checked")));
});

test("while downloading: progress, one download at a time, no recordings, and Cancel", async (t) => {
  const { voice, gate, dataDir } = await voiceSetup(t);
  gate.hold = deferred<void>();
  const running = voice.downloadModel();
  await settled();
  await settled();
  assert.equal((await voice.status()).model, "downloading");
  assert.deepEqual(await voice.downloadModel(), {
    status: "failed",
    message: VOICE_MESSAGES.alreadyDownloading,
  });
  assert.deepEqual(await voice.transcribe(new Int16Array(16_000)), {
    ok: false,
    message: VOICE_MESSAGES.needsDownload,
    needsDownload: true,
  });
  await voice.removeLeftovers();
  voice.cancelDownload();
  gate.hold.resolve();
  assert.deepEqual(await running, { status: "cancelled" });
  assert.equal((await voice.status()).model, "missing");
  assert.deepEqual(await readdir(join(dataDir, "models")), [], "half-finished files deleted");
});

test("a failed download gives the plain message, and Try again works", async (t) => {
  const { voice, deps, fake, model, lines } = await voiceSetup(t);
  const broken = { ...model.files[0]!, sha256: "0".repeat(64) };
  const failing = new Voice({ ...deps, model: { ...model, files: [broken] } });
  const result = await failing.downloadModel();
  assert.equal(result.status, "failed");
  assert.match((result as { message: string }).message, /wasn't the one Sage expected/);
  assert.ok(lines.some((line) => line.includes("download failed")));
  assert.deepEqual(await voice.downloadModel(), { status: "done" }, "trying again with the right file");
  assert.equal(fake.requests.length, 2);
});

test("an unexpected error during the download is logged and reported plainly", async (t) => {
  const { deps, lines, dataDir } = await voiceSetup(t);
  // Sage's data folder isn't a folder: the download can't even start.
  const notAFolder = join(dataDir, "settings.json");
  await writeFile(notAFolder, "{}");
  const voice = new Voice({ ...deps, dataDir: notAFolder });
  assert.deepEqual(await voice.downloadModel(), { status: "failed", message: DOWNLOAD_MESSAGES.disk });
  assert.ok(lines.some((line) => line.includes("error: The speech file download failed")));
  await voice.removeLeftovers();
});

test("a recording becomes text through the transcriber, once the model is there", async (t) => {
  const { voice, heard, dataDir, model } = await voiceSetup(t);
  const pcm = new Int16Array([0, 16_384, -32_768, 32_767]);
  assert.deepEqual(await voice.transcribe(pcm), {
    ok: false,
    message: VOICE_MESSAGES.needsDownload,
    needsDownload: true,
  });
  assert.equal(heard.length, 0, "nothing is sent without the speech file");
  await voice.downloadModel();
  assert.deepEqual(await voice.transcribe(pcm), { ok: true, text: "hello" });
  assert.equal(heard[0]!.dir, modelDir(dataDir, model));
  assert.deepEqual([...heard[0]!.samples], [0, 0.5, -1, 32_767 / 32_768]);
  for (const bad of [new Int16Array(0), new Int16Array(MAX_SAMPLES + 1)]) {
    assert.deepEqual(await voice.transcribe(bad), {
      ok: false,
      message: "Sage couldn't read that recording.",
    });
  }
});

test("one recording at a time in the main process too", async (t) => {
  const answer = deferred<{ ok: true; text: string }>();
  let disposed = 0;
  const { voice } = await voiceSetup(t, {
    transcriber: {
      transcribe: () => answer.promise,
      dispose: () => void disposed++,
    },
  });
  await voice.downloadModel();
  const first = voice.transcribe(new Int16Array(16_000));
  await settled();
  assert.deepEqual(await voice.transcribe(new Int16Array(16_000)), {
    ok: false,
    message: VOICE_MESSAGES.busy,
  });
  answer.resolve({ ok: true, text: "first" });
  assert.deepEqual(await first, { ok: true, text: "first" });
  voice.dispose();
  assert.equal(disposed, 1);
});

test("nothing about voice writes the sound or the words to a log", async (t) => {
  const { voice, lines } = await voiceSetup(t, {
    transcriber: {
      transcribe: async () => ({ ok: true, text: "my secret words" }),
      dispose() {},
    },
  });
  await voice.downloadModel();
  await voice.transcribe(new Int16Array(16_000).fill(1234));
  assert.ok(!lines.some((line) => line.includes("my secret words") || line.includes("1234")));
});
