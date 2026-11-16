import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import type { FetchLike } from "../src/core/brain/brain.js";
import {
  DOWNLOAD_MESSAGES,
  DownloadError,
  downloadModel,
  MAX_FORWARDS,
  removeLeftovers,
} from "../src/core/voice/download.js";
import {
  DOWNLOAD_QUESTION,
  isModelReady,
  MOONSHINE_TINY_EN,
  modelDir,
  partialDir,
  type SpeechModel,
  totalSize,
} from "../src/core/voice/model.js";
import { deferred, fakeServer, REFUSED_PORT, type Recorded, tempDir } from "./helpers.js";

// The speech file download, against a fake server on 127.0.0.1. The download code only accepts
// https addresses, so the tests give it https addresses for the fake server and a fetch that
// carries them over plain http to 127.0.0.1: the https-only rule is the real one, unchanged.

const tunnel: FetchLike = (input, init) =>
  fetch(input.replace(/^https:\/\/127\.0\.0\.1:/, "http://127.0.0.1:"), init);

function file(name: string, size: number) {
  const data = randomBytes(size);
  return { name, data, sha256: createHash("sha256").update(data).digest("hex") };
}

const encoder = file("encoder_model.ort", 70_000);
const tokens = file("tokens.txt", 300);

type Route = (request: Recorded, res: ServerResponse) => void;

/** A fake download server; `routes` overrides what a path answers. */
async function server(t: Parameters<typeof tempDir>[0], routes: Record<string, Route> = {}) {
  const served = new Map([
    [`/files/${encoder.name}`, encoder.data],
    [`/files/${tokens.name}`, tokens.data],
  ]);
  const fake = await fakeServer(t, (request, res) => {
    const route = routes[request.url];
    if (route) return route(request, res);
    const data = served.get(request.url);
    if (!data) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-length": String(data.length) });
    res.end(data);
  });
  const base = `https://127.0.0.1:${fake.port}`;
  const model: SpeechModel = {
    id: "test-model",
    files: [encoder, tokens].map((f) => ({
      name: f.name,
      url: `${base}/files/${f.name}`,
      size: f.data.length,
      sha256: f.sha256,
    })),
  };
  return { ...fake, base, model };
}

async function attempt(dataDir: string, model: SpeechModel, signal = new AbortController().signal) {
  try {
    await downloadModel({ dataDir, model, fetch: tunnel, signal });
    return "done";
  } catch (error) {
    return error instanceof DownloadError ? error.message : error;
  }
}

/** Everything left in `<userData>/models`. */
async function leftovers(dataDir: string): Promise<string[]> {
  try {
    return (await readdir(join(dataDir, "models"), { recursive: true })).sort();
  } catch {
    return [];
  }
}

test("the real speech file: three pinned https addresses on Hugging Face, with sizes and fingerprints", () => {
  const commit = "d1e6c30921780b8508d04b492dfb3ce8a51605d4";
  const repo = "csukuangfj2/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27";
  assert.deepEqual(
    MOONSHINE_TINY_EN.files.map((f) => f.name),
    ["encoder_model.ort", "decoder_model_merged.ort", "tokens.txt"],
  );
  for (const f of MOONSHINE_TINY_EN.files) {
    assert.equal(f.url, `https://huggingface.co/${repo}/resolve/${commit}/${f.name}`);
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(f.size) && f.size > 0);
  }
  assert.equal(totalSize(MOONSHINE_TINY_EN), 44_243_206);
  assert.equal(Math.round(totalSize(MOONSHINE_TINY_EN) / 1e6), 44, "the box says 44 MB");
  assert.equal(DOWNLOAD_QUESTION, "Voice needs a 44 MB speech file from Hugging Face. Download it now?");
});

test("a correct download is checked and moved into the model folder, with progress", async (t) => {
  const dataDir = await tempDir(t);
  const { model, requests } = await server(t);
  const progress: number[] = [];
  assert.equal(await isModelReady(dataDir, model), false);
  await downloadModel({
    dataDir,
    model,
    fetch: tunnel,
    signal: new AbortController().signal,
    onProgress: (p) => {
      assert.equal(p.total, totalSize(model));
      progress.push(p.received);
    },
  });
  assert.equal(await isModelReady(dataDir, model), true);
  assert.deepEqual(await readFile(join(modelDir(dataDir, model), encoder.name)), encoder.data);
  assert.deepEqual(await readFile(join(modelDir(dataDir, model), tokens.name)), tokens.data);
  assert.deepEqual(await leftovers(dataDir), [
    "test-model",
    "test-model/encoder_model.ort",
    "test-model/tokens.txt",
  ]);
  assert.equal(progress.at(-1), totalSize(model));
  assert.ok(
    progress.every((n, i) => i === 0 || n >= progress[i - 1]!),
    "progress only goes up",
  );
  // Plain GETs: nothing is sent, no cookies, no body.
  for (const request of requests) {
    assert.equal(request.method, "GET");
    assert.equal(request.body, "");
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers.authorization, undefined);
  }
});

test("forwards are followed: relative and absolute, 302 and 307, up to five", async (t) => {
  const dataDir = await tempDir(t);
  const forward =
    (to: string, status = 302): Route =>
    (_req, res) => {
      res.writeHead(status, { location: to });
      res.end();
    };
  const fake = await server(t, {
    // Like Hugging Face: a relative address first, then the download server's full address.
    "/files/encoder_model.ort": forward("/cache/encoder?x=1", 307),
    "/cache/encoder?x=1": (_req, res) => forward(`https://127.0.0.1:${fake.port}/cdn/encoder`)(_req, res),
    "/cdn/encoder": (_req, res) => {
      res.writeHead(200);
      res.end(encoder.data);
    },
  });
  assert.equal(await attempt(dataDir, fake.model), "done");
  assert.deepEqual(
    fake.requests.map((r) => r.url),
    ["/files/encoder_model.ort", "/cache/encoder?x=1", "/cdn/encoder", "/files/tokens.txt"],
  );
  assert.equal(await isModelReady(dataDir, fake.model), true);
});

test("more than five forwards is refused", async (t) => {
  const dataDir = await tempDir(t);
  const routes: Record<string, Route> = {};
  for (let i = 0; i <= MAX_FORWARDS + 1; i++) {
    routes[`/loop/${i}`] = (_req, res) => {
      res.writeHead(302, { location: `/loop/${i + 1}` });
      res.end();
    };
  }
  routes["/files/encoder_model.ort"] = routes["/loop/0"]!;
  const fake = await server(t, routes);
  assert.equal(await attempt(dataDir, fake.model), DOWNLOAD_MESSAGES.untrusted);
  assert.equal(fake.requests.length, MAX_FORWARDS + 1, "the sixth forward isn't followed");
  assert.deepEqual(await leftovers(dataDir), []);
});

test("a forward to plain http, to an address with a password, or without an address is refused", async (t) => {
  for (const location of [
    "http://127.0.0.1:1/encoder", // the port doesn't matter: it is never fetched
    "https://user:secret@127.0.0.1/encoder",
    "ftp://127.0.0.1/encoder",
    "https://[bad",
    "",
  ]) {
    const dataDir = await tempDir(t);
    const fake = await server(t, {
      "/files/encoder_model.ort": (_req, res) => {
        res.writeHead(302, location ? { location } : {});
        res.end();
      },
    });
    assert.equal(await attempt(dataDir, fake.model), DOWNLOAD_MESSAGES.untrusted, location);
    assert.equal(fake.requests.length, 1, `${location}: not followed`);
    assert.deepEqual(await leftovers(dataDir), []);
  }
  // A plain http starting address is refused before anything is fetched.
  const dataDir = await tempDir(t);
  const fake = await server(t);
  const model = {
    ...fake.model,
    files: [{ ...fake.model.files[0]!, url: fake.model.files[0]!.url.replace("https:", "http:") }],
  };
  assert.equal(await attempt(dataDir, model), DOWNLOAD_MESSAGES.untrusted);
  assert.equal(fake.requests.length, 0);
});

test("a wrong fingerprint is refused, and nothing is moved into place", async (t) => {
  const dataDir = await tempDir(t);
  const fake = await server(t, {
    "/files/tokens.txt": (_req, res) => {
      const changed = Buffer.from(tokens.data);
      changed[0] = changed[0]! ^ 0xff;
      res.writeHead(200);
      res.end(changed);
    },
  });
  assert.equal(await attempt(dataDir, fake.model), DOWNLOAD_MESSAGES.mismatch);
  assert.equal(await isModelReady(dataDir, fake.model), false);
  assert.deepEqual(await leftovers(dataDir), [], "the good first file isn't kept either");
});

test("a file too big (declared or not), too small, or an error status is refused", async (t) => {
  const answers: Record<string, Route> = {
    "declared too big": (_req, res) => {
      res.writeHead(200, { "content-length": String(tokens.data.length + 1) });
      res.end(Buffer.concat([tokens.data, Buffer.from("x")]));
    },
    "undeclared, too big": (_req, res) => {
      res.writeHead(200);
      res.write(tokens.data);
      res.end(randomBytes(10_000));
    },
    "too small": (_req, res) => {
      res.writeHead(200);
      res.end(tokens.data.subarray(1));
    },
    "not found": (_req, res) => {
      res.writeHead(404);
      res.end("gone");
    },
  };
  for (const [name, route] of Object.entries(answers)) {
    const dataDir = await tempDir(t);
    const fake = await server(t, { "/files/tokens.txt": route });
    const expected = name === "not found" ? DOWNLOAD_MESSAGES.refused : DOWNLOAD_MESSAGES.mismatch;
    assert.equal(await attempt(dataDir, fake.model), expected, name);
    assert.deepEqual(await leftovers(dataDir), [], name);
  }
});

test("a server that isn't there, or a connection that drops, gives the offline message", async (t) => {
  const dataDir = await tempDir(t);
  const fake = await server(t, {
    "/files/tokens.txt": (_req, res) => {
      res.writeHead(200, { "content-length": String(tokens.data.length) });
      res.write(tokens.data.subarray(0, 10));
      res.destroy();
    },
  });
  assert.equal(await attempt(dataDir, fake.model), DOWNLOAD_MESSAGES.offline);
  assert.deepEqual(await leftovers(dataDir), []);
  const nowhere = {
    ...fake.model,
    files: fake.model.files.map((f) => ({ ...f, url: `https://127.0.0.1:${REFUSED_PORT}/files/${f.name}` })),
  };
  assert.equal(await attempt(dataDir, nowhere), DOWNLOAD_MESSAGES.offline);
  assert.deepEqual(await leftovers(dataDir), []);
});

test("a cancel stops the download and deletes the half-finished files", async (t) => {
  const dataDir = await tempDir(t);
  const fake = await server(t, {
    // Sends part of the file, then nothing more until the test ends.
    "/files/encoder_model.ort": (_req, res) => {
      res.writeHead(200, { "content-length": String(encoder.data.length) });
      res.write(encoder.data.subarray(0, 1_000));
    },
  });
  const controller = new AbortController();
  const started = deferred<void>();
  const result = downloadModel({
    dataDir,
    model: fake.model,
    fetch: tunnel,
    signal: controller.signal,
    onProgress: () => started.resolve(),
  });
  await started.promise;
  assert.ok((await leftovers(dataDir)).includes(".partial/encoder_model.ort"), "written as it arrives");
  controller.abort(new Error("cancelled"));
  await assert.rejects(result, /cancelled/);
  assert.deepEqual(await leftovers(dataDir), []);
});

test("a failed download leaves an existing model folder as it was", async (t) => {
  const dataDir = await tempDir(t);
  const fake = await server(t);
  assert.equal(await attempt(dataDir, fake.model), "done");
  const broken = await server(t, {
    "/files/encoder_model.ort": (_req, res) => {
      res.writeHead(500);
      res.end();
    },
  });
  assert.equal(await attempt(dataDir, { ...broken.model, id: fake.model.id }), DOWNLOAD_MESSAGES.refused);
  assert.equal(await isModelReady(dataDir, fake.model), true);
});

test("leftovers from a download cut off by a crash are deleted; the model folder is kept", async (t) => {
  const dataDir = await tempDir(t);
  const fake = await server(t);
  assert.equal(await attempt(dataDir, fake.model), "done");
  await mkdir(partialDir(dataDir), { recursive: true });
  await writeFile(join(partialDir(dataDir), "encoder_model.ort"), "half");
  await removeLeftovers(dataDir);
  assert.deepEqual(await leftovers(dataDir), [
    "test-model",
    "test-model/encoder_model.ort",
    "test-model/tokens.txt",
  ]);
  await removeLeftovers(await tempDir(t));
});

test("a model folder with a missing or wrong-sized file doesn't count as ready", async (t) => {
  const dataDir = await tempDir(t);
  const fake = await server(t);
  assert.equal(await attempt(dataDir, fake.model), "done");
  await writeFile(join(modelDir(dataDir, fake.model), tokens.name), "short");
  assert.equal(await isModelReady(dataDir, fake.model), false);
  await mkdir(join(modelDir(dataDir, fake.model), "x"));
  assert.equal(
    await isModelReady(dataDir, { ...fake.model, files: [{ ...fake.model.files[0]!, name: "x" }] }),
    false,
    "a folder isn't a file",
  );
});
