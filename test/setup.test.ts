import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { PULL_MESSAGES, RunnerClient } from "../src/core/brain/runner.js";
import { createSage } from "../src/core/sage.js";
import { defaultSettings, SettingsStore } from "../src/core/settings.js";
import {
  GUIDE_DETAIL,
  GUIDE_QUESTION,
  INSTALL_GUIDE_URL,
  PULL_DETAIL,
  pullQuestion,
  SETUP_MESSAGES,
  Setup,
} from "../src/core/setup.js";
import { createIpcHandlers } from "../src/main/ipc.js";
import { CHANNELS, type ModelChoice, SAGE_MODELS } from "../src/shared/api.js";
import {
  captureLogs,
  deferred,
  FakePresenter,
  fakeServer,
  json,
  memoryKeyStores,
  type Recorded,
  REFUSED_PORT,
  settled,
  tempDir,
} from "./helpers.js";

// First-run setup in the main process (src/core/setup.ts), against a fake local model runner on
// 127.0.0.1 and a settings file in a temporary folder.

const RUNNER_TEXT = "secret-runner-wording-xyz";

interface FakeRunner {
  models: string[];
  capabilities?: string[];
  /** What GET /api/version answers; no answer (404) when not given. */
  version?: unknown;
  /** Answers a pull; by default progress, then success. */
  pull?: (req: Recorded, res: ServerResponse) => void;
}

async function setupWith(
  t: Parameters<typeof tempDir>[0],
  runner: FakeRunner | "none",
  options: {
    confirm?: (choice: ModelChoice) => Promise<boolean>;
    open?: (url: string) => Promise<void>;
  } = {},
) {
  const dataDir = await tempDir(t);
  const { logger, lines } = captureLogs();
  const settings = new SettingsStore(dataDir, logger);
  let port = REFUSED_PORT;
  let requests: Recorded[] = [];
  if (runner !== "none") {
    const server = await fakeServer(t, (req, res) => {
      if (req.url === "/api/tags") return json(res, 200, { models: runner.models.map((name) => ({ name })) });
      if (req.url === "/api/version" && runner.version !== undefined) {
        return json(res, 200, { version: runner.version });
      }
      if (req.url === "/api/show") {
        return json(res, 200, runner.capabilities ? { capabilities: runner.capabilities } : {});
      }
      if (req.url === "/api/pull") {
        if (runner.pull) return runner.pull(req, res);
        res.writeHead(200);
        res.write('{"status":"pulling a","digest":"a","total":100,"completed":100}\n');
        res.end('{"status":"success"}\n');
        runner.models.push(JSON.parse(req.body).model);
        return;
      }
      json(res, 404, {});
    });
    port = server.port;
    requests = server.requests;
  }
  const asked: { pull: ModelChoice[]; guide: number; opened: string[] } = { pull: [], guide: 0, opened: [] };
  const setup = new Setup({
    settings,
    runner: new RunnerClient({ port }),
    logger,
    confirmPull: async (choice) => {
      asked.pull.push(choice);
      return options.confirm ? options.confirm(choice) : true;
    },
    confirmOpenGuide: async () => {
      asked.guide++;
      return true;
    },
    openExternal: async (url) => {
      asked.opened.push(url);
      await options.open?.(url);
    },
  });
  const pulls = () => requests.filter((req) => req.url === "/api/pull");
  return { setup, settings, asked, lines, pulls, requests };
}

test("the runner's status for the saved local model, and which of Sage's models it has", async (t) => {
  const none = await setupWith(t, "none");
  assert.deepEqual(await none.setup.status(), {
    state: "unreachable",
    model: "qwen3:4b",
    downloaded: { standard: false, smaller: false },
    version: null,
  });
  const empty = await setupWith(t, { models: ["something-else:latest"] });
  assert.deepEqual(await empty.setup.status(), {
    state: "no-model",
    model: "qwen3:4b",
    downloaded: { standard: false, smaller: false },
    version: null,
  });
  const both = await setupWith(t, { models: ["qwen3:1.7b", "qwen3:4b"], version: "0.12.3" });
  assert.deepEqual(await both.setup.status(), {
    state: "ready",
    model: "qwen3:4b",
    downloaded: { standard: true, smaller: true },
    version: "0.12.3",
  });
  // A model of the user's own, saved without a tag, matches the runner's ":latest".
  const own = await setupWith(t, { models: ["mymodel:latest"] });
  await own.settings.save({ ...defaultSettings(), local: { model: "mymodel" } });
  assert.equal((await own.setup.status()).state, "ready");
  // A reply Sage can't read.
  const odd = await fakeServer(t, (_req, res) => json(res, 200, { models: RUNNER_TEXT }));
  assert.equal((await (await bareSetup(t, odd.port)).status()).state, "unreadable");
});

test("the runner's version is kept only when it is a plain version number", async (t) => {
  for (const [version, expected] of [
    ["0.12.3", "0.12.3"],
    ["0.13.0-rc1", "0.13.0-rc1"],
    ["1.2", "1.2"],
    [RUNNER_TEXT, null],
    ["0.12.3 /home/someone", null],
    ["https://elsewhere.example/1.0", null],
    ["9".repeat(50), null],
    [12, null],
    [{ major: 0 }, null],
  ] as const) {
    const { setup, requests } = await setupWith(t, { models: ["qwen3:4b"], version });
    assert.equal((await setup.status()).version, expected, JSON.stringify(version));
    assert.ok(requests.some((req) => req.url === "/api/version" && req.method === "GET"));
  }
  // A runner that doesn't answer for its models: its version isn't kept, whatever it says.
  const odd = await fakeServer(t, (req, res) =>
    req.url === "/api/version" ? json(res, 200, { version: "0.12.3" }) : json(res, 500, {}),
  );
  assert.equal((await (await bareSetup(t, odd.port)).status()).version, null);
});

/** A Setup on `port` that is never allowed to ask, download or open anything. */
async function bareSetup(
  t: Parameters<typeof tempDir>[0],
  port: number,
  parts: Partial<ConstructorParameters<typeof Setup>[0]> = {},
) {
  const { logger } = captureLogs();
  return new Setup({
    settings: new SettingsStore(await tempDir(t), logger),
    runner: new RunnerClient({ port }),
    logger,
    confirmPull: async () => true,
    confirmOpenGuide: async () => false,
    openExternal: async () => {},
    ...parts,
  });
}

test("nothing is downloaded unless the user chooses Download in the main process's box", async (t) => {
  for (const confirm of [
    async () => false,
    async () => {
      throw new Error("the box failed");
    },
  ]) {
    const { setup, settings, asked, pulls } = await setupWith(t, { models: [] }, { confirm });
    assert.deepEqual(await setup.pullModel("smaller"), { status: "declined" });
    assert.deepEqual(asked.pull, ["smaller"]);
    assert.equal(pulls().length, 0, "no download request at all");
    assert.deepEqual(await settings.load(), defaultSettings(), "nothing saved");
  }
  assert.equal(pullQuestion("standard"), "Download the Standard model (about 2.5 GB)?");
  assert.equal(pullQuestion("smaller"), "Download the Smaller model (about 1.4 GB)?");
  assert.match(PULL_DETAIL, /internet connection and free disk space/);
  assert.match(PULL_DETAIL, /local model runner downloads the model and checks its files/);
  // Someone on an online service learns before agreeing that Sage moves to the local brain.
  assert.match(
    PULL_DETAIL,
    /Sage will use it on this computer: the brain in Settings switches to On this computer/,
  );
});

test("after Download the runner downloads the model; only then is it saved as the local model", async (t) => {
  const { setup, settings, asked, pulls, lines } = await setupWith(t, {
    models: [],
    capabilities: ["completion", "tools"],
  });
  await settings.save({
    ...defaultSettings(),
    brain: "other",
    online: { baseUrl: "https://api.example.com", model: "m" },
    folders: ["/docs"],
    speakReplies: "never",
  });
  assert.deepEqual(await setup.pullModel("smaller"), { status: "done", skills: "yes" });
  assert.deepEqual(asked.pull, ["smaller"]);
  assert.deepEqual(JSON.parse(pulls()[0]!.body), { model: SAGE_MODELS.smaller.name, stream: true });
  // Only the model and the brain changed.
  assert.deepEqual(await settings.load(), {
    ...defaultSettings(),
    brain: "local",
    local: { model: "qwen3:1.7b" },
    online: { baseUrl: "https://api.example.com", model: "m" },
    folders: ["/docs"],
    speakReplies: "never",
  });
  assert.ok(lines.some((line) => line.includes("downloaded qwen3:1.7b")));
  assert.deepEqual(setup.pullStatus(), { downloading: false, completed: 0, total: 0 });
});

test("a model the runner already has needs no box and no download", async (t) => {
  const { setup, settings, asked, pulls } = await setupWith(t, { models: ["qwen3:4b"] });
  await settings.save({ ...defaultSettings(), local: { model: "other" }, setupDone: true });
  assert.deepEqual(await setup.pullModel("standard"), { status: "done", skills: "unknown" });
  assert.deepEqual(asked.pull, []);
  assert.equal(pulls().length, 0);
  assert.deepEqual(await settings.load(), { ...defaultSettings(), setupDone: true });
});

test("the skills check: a model the runner says can't use tools is reported", async (t) => {
  const { setup } = await setupWith(t, { models: [], capabilities: ["completion"] });
  assert.deepEqual(await setup.pullModel("standard"), { status: "done", skills: "no" });
});

test("while downloading: progress, one download at a time, and Cancel saves nothing", async (t) => {
  const reached = deferred<void>();
  const { setup, settings } = await setupWith(t, {
    models: [],
    pull: (_req, res) => {
      res.writeHead(200);
      res.write('{"status":"pulling a","digest":"a","total":2000,"completed":500}\n');
      reached.resolve();
    },
  });
  const running = setup.pullModel("standard");
  await reached.promise;
  // The progress line may still be on its way: wait for it event by event, never on a timer.
  for (let i = 0; i < 1_000 && setup.pullStatus().completed === 0; i++) await settled();
  assert.deepEqual(setup.pullStatus(), { downloading: true, completed: 500, total: 2000 });
  assert.deepEqual(await setup.pullModel("smaller"), {
    status: "failed",
    message: SETUP_MESSAGES.alreadyDownloading,
    code: "SAGE-MOD-04",
  });
  setup.cancelPull();
  assert.deepEqual(await running, { status: "cancelled" });
  assert.deepEqual(await settings.load(), defaultSettings());
  assert.deepEqual(setup.pullStatus(), { downloading: false, completed: 0, total: 0 });
});

test("Sage closing stops a download", async (t) => {
  const reached = deferred<void>();
  const { setup } = await setupWith(t, {
    models: [],
    pull: () => reached.resolve(),
  });
  const running = setup.pullModel("standard");
  await reached.promise;
  setup.dispose();
  assert.deepEqual(await running, { status: "cancelled" });
});

test("a failed download gives Sage's message, saves nothing, and Try again works", async (t) => {
  let fail = true;
  const runner: FakeRunner = {
    models: [],
    pull: (req, res) => {
      res.writeHead(200);
      if (fail) {
        res.end(`{"error":"no space left on device ${RUNNER_TEXT}"}\n`);
        return;
      }
      res.end('{"status":"success"}\n');
      runner.models.push(JSON.parse(req.body).model);
    },
  };
  const { setup, settings, lines } = await setupWith(t, runner);
  const failed = await setup.pullModel("smaller");
  assert.deepEqual(failed, { status: "failed", message: PULL_MESSAGES.disk, code: "SAGE-MOD-02" });
  assert.deepEqual(await settings.load(), defaultSettings());
  assert.ok(!lines.join("\n").includes(RUNNER_TEXT), "the runner's text isn't logged");
  fail = false;
  assert.deepEqual(await setup.pullModel("smaller"), { status: "done", skills: "unknown" });
  assert.equal((await settings.load()).local.model, "qwen3:1.7b");
});

test("with no runner, a download isn't offered: no box, and the plain message", async (t) => {
  const { setup, asked } = await setupWith(t, "none");
  assert.deepEqual(await setup.pullModel("standard"), {
    status: "failed",
    message: PULL_MESSAGES.unreachable,
    code: "SAGE-RUN-01",
  });
  assert.deepEqual(asked.pull, []);
  const odd = await fakeServer(t, (_req, res) => json(res, 500, {}));
  const unreadable = await bareSetup(t, odd.port);
  assert.deepEqual(await unreadable.pullModel("standard"), {
    status: "failed",
    message: PULL_MESSAGES.unreadable,
    code: "SAGE-RUN-02",
  });
});

test("the install guide opens only after asking, and only at its one fixed address", async (t) => {
  assert.equal(
    INSTALL_GUIDE_URL,
    "https://github.com/HoneyBearTech/sage-assistant/blob/main/docs/installing.md#local-model-runner",
  );
  assert.equal(GUIDE_QUESTION, "Open Sage's install guide in your web browser?");
  assert.ok(GUIDE_DETAIL.includes(INSTALL_GUIDE_URL));
  const { setup, asked } = await setupWith(t, "none");
  assert.deepEqual(await setup.openInstallGuide(), { status: "opened" });
  assert.deepEqual(asked.opened, [INSTALL_GUIDE_URL]);

  const opened: string[] = [];
  for (const confirmOpenGuide of [
    async () => false,
    async () => {
      throw new Error("the box failed");
    },
  ]) {
    const declined = await bareSetup(t, REFUSED_PORT, {
      confirmOpenGuide,
      openExternal: async (url) => void opened.push(url),
    });
    assert.deepEqual(await declined.openInstallGuide(), { status: "declined" });
  }
  assert.deepEqual(opened, [], "nothing opened without the box's Open");

  // No browser opened: the address is given to copy.
  const failing = await setupWith(t, "none", {
    open: async () => {
      throw new Error("no browser");
    },
  });
  assert.deepEqual(await failing.setup.openInstallGuide(), {
    status: "failed",
    message: SETUP_MESSAGES.guideFailed,
    address: INSTALL_GUIDE_URL,
  });
  assert.ok(SETUP_MESSAGES.guideFailed.includes(INSTALL_GUIDE_URL));
});

test("finishing or skipping saves only that setup is done", async (t) => {
  const { setup, settings } = await setupWith(t, "none");
  const saved = {
    ...defaultSettings(),
    brain: "other" as const,
    folders: ["/docs"],
    speakReplies: "always" as const,
  };
  await settings.save(saved);
  assert.deepEqual(await setup.finish(), { ok: true });
  assert.deepEqual(await settings.load(), { ...saved, setupDone: true });
  assert.deepEqual(await setup.finish(), { ok: true }, "again: no harm");
});

// --- Through the window's requests ---

async function ipcWith(t: Parameters<typeof tempDir>[0], models: string[] = []) {
  const server = await fakeServer(t, (req, res) => {
    if (req.url === "/api/tags") return json(res, 200, { models: models.map((name) => ({ name })) });
    if (req.url === "/api/show") return json(res, 200, {});
    res.writeHead(200);
    res.end('{"status":"success"}\n');
  });
  const asked: string[] = [];
  const opened: string[] = [];
  const sage = createSage({
    dataDir: await tempDir(t),
    keyStores: memoryKeyStores(),
    presenter: new FakePresenter(false),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    localPort: server.port,
    setup: {
      confirmPull: async (choice) => {
        asked.push(choice);
        return true;
      },
      confirmOpenGuide: async () => true,
      openExternal: async (url) => void opened.push(url),
    },
  });
  const handlers = createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null });
  return { sage, handlers, server, asked, opened };
}

test("the window can only pick one of Sage's two models, never send a model name", async (t) => {
  const { handlers, server, asked } = await ipcWith(t);
  const refused = { status: "failed", message: "Sage couldn't read that choice.", code: "SAGE-APP-01" };
  for (const payload of [
    undefined,
    { choice: "qwen3:4b" },
    { choice: "large" },
    { choice: "standard", model: "evil:latest" },
    { model: "evil:latest" },
    "standard",
  ]) {
    assert.deepEqual(await handlers[CHANNELS.pullModel](payload), refused, JSON.stringify(payload));
  }
  assert.deepEqual(asked, []);
  assert.equal(server.requests.length, 0, "nothing reached the runner");
  assert.deepEqual(await handlers[CHANNELS.pullModel]({ choice: "smaller" }), {
    status: "done",
    skills: "unknown",
  });
  assert.deepEqual(asked, ["smaller"]);
  const pull = server.requests.find((req) => req.url === "/api/pull")!;
  assert.deepEqual(JSON.parse(pull.body), { model: "qwen3:1.7b", stream: true });
  assert.deepEqual(await handlers[CHANNELS.pullStatus](undefined), {
    downloading: false,
    completed: 0,
    total: 0,
  });
  assert.equal(await handlers[CHANNELS.cancelPull](undefined), "idle", "nothing to cancel");
});

test("the runner's status, the install guide and finishing go through their own requests", async (t) => {
  const { handlers, opened, sage } = await ipcWith(t, ["qwen3:4b"]);
  assert.deepEqual(await handlers[CHANNELS.runnerStatus](undefined), {
    state: "ready",
    model: "qwen3:4b",
    downloaded: { standard: true, smaller: false },
    version: null,
  });
  // Whatever the window sends, only the fixed address is opened.
  assert.deepEqual(await handlers[CHANNELS.openInstallGuide]({ url: "https://elsewhere.example" }), {
    status: "opened",
  });
  assert.deepEqual(opened, [INSTALL_GUIDE_URL]);
  assert.equal(
    ((await handlers[CHANNELS.getSettings](undefined)) as { setupDone: boolean }).setupDone,
    false,
  );
  assert.deepEqual(await handlers[CHANNELS.finishSetup](undefined), { ok: true });
  assert.equal(((await handlers[CHANNELS.getSettings](undefined)) as { setupDone: boolean }).setupDone, true);
  assert.equal((await sage.settings.load()).setupDone, true);
});

test("saving the Settings screen keeps 'set up' as it is, whatever the window sends", async (t) => {
  const { handlers, sage } = await ipcWith(t);
  await handlers[CHANNELS.finishSetup](undefined);
  const shown = (await handlers[CHANNELS.getSettings](undefined)) as Record<string, unknown>;
  const { setupDone: _ignored, ...form } = shown;
  assert.deepEqual(await handlers[CHANNELS.saveSettings]({ ...form, folders: ["/docs"] }), { ok: true });
  assert.equal((await sage.settings.load()).setupDone, true, "a Settings save doesn't reset it");
  assert.deepEqual((await sage.settings.load()).folders, ["/docs"]);
  // A window that tries to change it can't.
  assert.deepEqual(await handlers[CHANNELS.saveSettings]({ ...form, setupDone: false }), { ok: true });
  assert.equal((await sage.settings.load()).setupDone, true);

  // And before setup is done, a save doesn't mark it done either.
  const fresh = await ipcWith(t);
  assert.deepEqual(await fresh.handlers[CHANNELS.saveSettings]({ ...form, setupDone: true }), { ok: true });
  assert.equal((await fresh.sage.settings.load()).setupDone, false);
});

test("without the main process's parts, nothing is asked, downloaded or opened", async (t) => {
  const sage = createSage({
    dataDir: await tempDir(t),
    keyStores: memoryKeyStores(),
    presenter: new FakePresenter(false),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    localPort: (await fakeServer(t, (_req, res) => json(res, 200, { models: [] }))).port,
  });
  assert.deepEqual(await sage.setup.pullModel("standard"), { status: "declined" });
  assert.deepEqual(await sage.setup.openInstallGuide(), { status: "declined" });
});

// --- Cancelling the whole request (Skip, Cancel, quitting) ---

/** A settings store whose `update` waits for `gate` first, as if another save held the lock. */
class HeldSettings extends SettingsStore {
  gate: ReturnType<typeof deferred<void>> | undefined;
  readonly waiting = deferred<void>();
  override async update(...args: Parameters<SettingsStore["update"]>) {
    if (this.gate) {
      this.waiting.resolve();
      await this.gate.promise;
    }
    return super.update(...args);
  }
}

async function cancellable(
  t: Parameters<typeof tempDir>[0],
  options: { tags?: (res: ServerResponse) => void; confirm?: () => Promise<boolean> } = {},
) {
  const tagsReached = deferred<void>();
  const server = await fakeServer(t, (req, res) => {
    if (req.url === "/api/tags") {
      tagsReached.resolve();
      return options.tags ? options.tags(res) : json(res, 200, { models: [] });
    }
    if (req.url === "/api/show") return json(res, 200, {});
    res.writeHead(200);
    res.end('{"status":"success"}\n');
  });
  const { logger, lines } = captureLogs();
  const settings = new HeldSettings(await tempDir(t), logger);
  const asked: ModelChoice[] = [];
  let brainChanged = 0;
  const setup = new Setup({
    settings,
    runner: new RunnerClient({ port: server.port }),
    logger,
    confirmPull: async (choice) => {
      asked.push(choice);
      return options.confirm ? options.confirm() : true;
    },
    confirmOpenGuide: async () => false,
    openExternal: async () => {},
    brainChanged: () => brainChanged++,
  });
  const pulls = () => server.requests.filter((req) => req.url === "/api/pull");
  return { setup, settings, asked, pulls, tagsReached, lines, brainChanged: () => brainChanged };
}

test("Skip while Sage is still asking the runner for its models: no box, nothing saved", async (t) => {
  // The runner takes the request and doesn't answer yet.
  const { setup, settings, asked, pulls, tagsReached } = await cancellable(t, { tags: () => {} });
  const running = setup.pullModel("standard");
  await tagsReached.promise;
  assert.deepEqual(await setup.finish(), { ok: true });
  assert.deepEqual(await running, { status: "cancelled" });
  assert.deepEqual(asked, [], "the download box never opens");
  assert.equal(pulls().length, 0);
  assert.deepEqual(await settings.load(), { ...defaultSettings(), setupDone: true });
});

test("Skip while the download box is open: Download afterwards starts nothing", async (t) => {
  const answer = deferred<boolean>();
  const boxOpen = deferred<void>();
  const { setup, settings, pulls } = await cancellable(t, {
    confirm: () => {
      boxOpen.resolve();
      return answer.promise;
    },
  });
  const running = setup.pullModel("smaller");
  await boxOpen.promise;
  assert.deepEqual(setup.pullStatus(), { downloading: false, completed: 0, total: 0 }, "not downloading yet");
  await setup.finish();
  answer.resolve(true);
  assert.deepEqual(await running, { status: "cancelled" });
  assert.equal(pulls().length, 0);
  assert.deepEqual(await settings.load(), { ...defaultSettings(), setupDone: true });
});

test("before the save starts, Cancel saves nothing; once it has started, Cancel is too late", async (t) => {
  const answer = deferred<boolean>();
  const boxOpen = deferred<void>();
  const { setup, settings, brainChanged } = await cancellable(t, {
    confirm: () => {
      boxOpen.resolve();
      return answer.promise;
    },
  });
  const online = {
    ...defaultSettings(),
    brain: "other" as const,
    online: { baseUrl: "https://api.example.com", model: "m" },
  };
  await settings.save(online);
  assert.equal(setup.cancelPull(), "idle", "nothing running");

  // Before the commit point: cancelled, and nothing is saved even after Download is chosen.
  const early = setup.pullModel("smaller");
  await boxOpen.promise;
  assert.equal(setup.cancelPull(), "cancelled");
  answer.resolve(true);
  assert.deepEqual(await early, { status: "cancelled" });
  assert.deepEqual(await settings.load(), online);
  assert.equal(brainChanged(), 0);
});

test("once the save has started it finishes; Skip waits for it, then marks setup done", async (t) => {
  const { setup, settings, brainChanged } = await cancellable(t, {
    tags: (res) => json(res, 200, { models: [{ name: "qwen3:1.7b" }] }),
  });
  const online = {
    ...defaultSettings(),
    brain: "other" as const,
    online: { baseUrl: "https://api.example.com", model: "m" },
  };
  await settings.save(online);
  // The save is waiting for the settings lock (another save holds it).
  settings.gate = deferred<void>();
  const running = setup.pullModel("smaller");
  await settings.waiting.promise;
  assert.equal(setup.cancelPull(), "too-late", "the model stays chosen");
  let finished = false;
  const skipping = setup.finish().then((result) => {
    finished = true;
    return result;
  });
  await settled();
  assert.equal(finished, false, "Skip waits for the save in progress");
  settings.gate.resolve();
  assert.deepEqual(await running, { status: "done", skills: "unknown" });
  assert.deepEqual(await skipping, { ok: true });
  assert.deepEqual(await settings.load(), {
    ...online,
    brain: "local",
    local: { model: "qwen3:1.7b" },
    setupDone: true,
  });
  assert.equal(brainChanged(), 1);
  assert.equal(setup.cancelPull(), "idle");
});

test("an unexpected error is logged as a fixed line, never with its text", async (t) => {
  const { logger, lines } = captureLogs();
  const runner = {
    models: async () => ({ ok: true as const, names: [] }),
    pull: async () => {
      throw new TypeError(`broken ${RUNNER_TEXT}`);
    },
    toolSupport: async () => "unknown" as const,
  } as unknown as RunnerClient;
  const setup = new Setup({
    settings: new SettingsStore(await tempDir(t), logger),
    runner,
    logger,
    confirmPull: async () => true,
    confirmOpenGuide: async () => false,
    openExternal: async () => {},
  });
  assert.deepEqual(await setup.pullModel("standard"), {
    status: "failed",
    message: PULL_MESSAGES.other,
    code: "SAGE-MOD-01",
  });
  assert.ok(!lines.join("\n").includes(RUNNER_TEXT));
  assert.ok(lines.some((line) => line.includes("A model download failed unexpectedly (TypeError).")));
});

test("the model list and the version are asked at once, so a runner that hangs on one costs one wait", async (t) => {
  const asked: string[] = [];
  const tags = deferred<Response>();
  const listAsked = deferred<void>();
  // The version request never answers; only its own time limit ends it.
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    asked.push(new URL(url).pathname);
    if (url.endsWith("/api/tags")) {
      listAsked.resolve();
      return tags.promise;
    }
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  };
  // A short time limit is fine here: the outcome is the same however slow the machine is.
  const setup = await bareSetup(t, REFUSED_PORT, {
    runner: new RunnerClient({ fetch, statusTimeoutMs: 30 }),
  });
  const status = setup.status();
  await listAsked.promise;
  await settled();
  assert.deepEqual(asked.sort(), ["/api/tags", "/api/version"], "both in flight before the list answers");
  tags.resolve(json200({ models: [{ name: "qwen3:4b" }] }));
  const answer = await status;
  assert.equal(answer.state, "ready");
  assert.equal(answer.version, null, "the hanging version request ends at its time limit");

  // A runner that doesn't answer for its models: whatever the version says, it isn't kept.
  const lone = await bareSetup(t, REFUSED_PORT, {
    runner: new RunnerClient({
      fetch: async (url) => {
        if (url.endsWith("/api/tags")) throw new TypeError("fetch failed");
        return json200({ version: "0.12.3" });
      },
    }),
  });
  assert.deepEqual(await lone.status(), {
    state: "unreachable",
    model: "qwen3:4b",
    downloaded: { standard: false, smaller: false },
    version: null,
  });
});

function json200(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
