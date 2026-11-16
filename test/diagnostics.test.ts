import assert from "node:assert/strict";
import { test } from "node:test";
import { DIAGNOSTICS_MESSAGES, type SystemFacts, scrubValue, systemFacts } from "../src/core/diagnostics.js";
import { createSage, type DiagnosticsParts } from "../src/core/sage.js";
import { defaultSettings } from "../src/core/settings.js";
import { createIpcHandlers } from "../src/main/ipc.js";
import { CHANNELS, type DiagnosticsResult, type Result } from "../src/shared/api.js";
import { fakeServer, FakePresenter, json, memoryKeyStores, REFUSED_PORT, tempDir } from "./helpers.js";

// Copy diagnostics (src/core/diagnostics.ts and its two requests in src/main/ipc.ts): the text is
// built in the main process from a fixed list of fields, shown in full, and copied only on request,
// as built. Private values planted everywhere Sage keeps them never reach it.

const KEY = "fake-claude-key-for-diagnostics-tests";
const OTHER_KEY = "fake-value-for-tests-other-service";
const USER = "jordanplanted";
const HOME = `/home/${USER}`;
const EMAIL = "jordan.planted@example.org";
const NOTE_TEXT = "Planted note text: the spare key is under the mat";
const NOTE_TITLE = "Planted note title";
const REMINDER = "Planted reminder: call the bank";
const OTHER_ADDRESS = "https://private-service.example.net/v1";

/** The PC's facts, with a home path, user name, key and e-mail address planted in the values. */
const PLANTED_SYSTEM: SystemFacts = {
  os: "Windows",
  osVersion: `10.0.26100 ${HOME}/AppData ${EMAIL}`,
  arch: `x64 ${KEY} C:\\Users\\${USER}\\Documents`,
  home: HOME,
  user: USER,
};

async function sageWith(
  t: Parameters<typeof tempDir>[0],
  options: { port?: number; system?: SystemFacts; clipboard?: (text: string) => void } = {},
) {
  const dataDir = await tempDir(t);
  const copied: string[] = [];
  const diagnostics: DiagnosticsParts = {
    appVersion: `0.2.0 ${OTHER_ADDRESS}`,
    writeClipboard:
      options.clipboard ??
      ((text) => {
        copied.push(text);
      }),
    system: options.system ?? PLANTED_SYSTEM,
  };
  const sage = createSage({
    dataDir,
    keyStores: memoryKeyStores(),
    presenter: new FakePresenter(false),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    localPort: options.port ?? REFUSED_PORT,
    diagnostics,
  });
  const handlers = createIpcHandlers(sage, { chooseFolder: async () => null, chooseApp: async () => null });
  return { sage, handlers, copied };
}

/** A fake local model runner with these models and this version. */
async function runner(t: Parameters<typeof tempDir>[0], models: string[], version?: string) {
  return fakeServer(t, (req, res) => {
    if (req.url === "/api/tags") return json(res, 200, { models: models.map((name) => ({ name })) });
    if (req.url === "/api/version" && version) return json(res, 200, { version });
    json(res, 404, {});
  });
}

test("the text has each expected line, built from the real checks", async (t) => {
  const server = await runner(t, ["qwen3:4b"], "0.12.3");
  const { handlers, sage } = await sageWith(t, {
    port: server.port,
    system: { os: "Windows", osVersion: "10.0.26100", arch: "x64", home: HOME, user: USER },
  });
  await sage.settings.save({ ...defaultSettings(), theme: "light" });
  const result = (await handlers[CHANNELS.diagnostics]({
    step: "model",
    code: "SAGE-NET-02",
    reducedMotion: true,
  })) as DiagnosticsResult;
  assert.ok(result.ok);
  assert.equal(
    result.text,
    [
      "Sage diagnostics",
      "Built by Sage on this PC. Nothing in it was sent anywhere.",
      "",
      `Sage version: 0.2.0 [address]`,
      "System: Windows 10.0.26100",
      "CPU: x64",
      "Setup step: 03 Model",
      "Support code: SAGE-NET-02: The download made no progress for 2 minutes, so Sage stopped it.",
      "Brain: local",
      "Local model runner: answered",
      "Runner version: 0.12.3",
      "Chosen local model: qwen3:4b",
      "Chosen model downloaded: yes",
      "Voice: speech file not downloaded",
      "Theme: light",
      "Reduced motion: on",
    ].join("\n"),
  );
  assert.match(result.id, /^diag-\d+$/);
});

test("each answer of the runner, the model and the voice gets its own fixed words", async (t) => {
  // No runner at all.
  const none = await sageWith(t);
  const missing = (await none.handlers[CHANNELS.diagnostics]({
    step: "runner",
    code: "SAGE-RUN-01",
    reducedMotion: false,
  })) as DiagnosticsResult & { ok: true };
  assert.match(missing.text, /^Setup step: 02 Model runner$/m);
  assert.match(missing.text, /^Support code: SAGE-RUN-01: /m);
  assert.match(missing.text, /^Local model runner: didn't answer$/m);
  assert.match(missing.text, /^Runner version: not reported$/m);
  assert.match(missing.text, /^Chosen model downloaded: unknown \(the runner didn't say\)$/m);
  assert.match(missing.text, /^Reduced motion: off$/m);

  // A runner that answers with something Sage can't read.
  const odd = await fakeServer(t, (_req, res) => json(res, 500, {}));
  const unreadable = await sageWith(t, { port: odd.port });
  const text = (
    (await unreadable.sage.diagnostics.build({
      step: "runner",
      code: "SAGE-RUN-02",
      reducedMotion: false,
    })) as DiagnosticsResult & { ok: true }
  ).text;
  assert.match(text, /^Local model runner: answered with something Sage couldn't read$/m);

  // The runner, without the chosen model; a model of the user's own is never named.
  const server = await runner(t, ["qwen3:1.7b"]);
  const own = await sageWith(t, { port: server.port });
  await own.sage.settings.save({ ...defaultSettings(), local: { model: `${USER}/private-model` } });
  const ownText = (
    (await own.sage.diagnostics.build({
      step: "model",
      code: "SAGE-MOD-01",
      reducedMotion: false,
    })) as DiagnosticsResult & { ok: true }
  ).text;
  assert.match(ownText, /^Local model runner: answered$/m);
  assert.match(ownText, /^Chosen local model: not one of Sage's two \(name left out\)$/m);
  assert.match(ownText, /^Chosen model downloaded: no$/m);
  assert.ok(!ownText.includes("private-model"));

  // Facts that can't be read say so; the rest still show.
  own.sage.voice.status = async () => {
    throw new Error("no voice here");
  };
  own.sage.setup.status = async () => {
    throw new Error("no runner here");
  };
  own.sage.settings.load = async () => {
    throw new Error("no settings here");
  };
  const broken = (
    (await own.sage.diagnostics.build({
      step: "model",
      code: "SAGE-APP-01",
      reducedMotion: false,
    })) as DiagnosticsResult & { ok: true }
  ).text;
  assert.match(broken, /^Voice: couldn't be checked$/m);
  assert.match(broken, /^Local model runner: couldn't be checked$/m);
  assert.match(broken, /^Brain: unknown$/m);
  assert.match(broken, /^Chosen local model: unknown$/m);
  assert.match(broken, /^Theme: unknown$/m);
});

test("a planted key, home path, user name, e-mail, note, reminder and online address all stay out", async (t) => {
  const server = await runner(t, ["qwen3:4b"], "0.12.3");
  const { sage, handlers, copied } = await sageWith(t, { port: server.port });
  // Keys for a company and for another online service, the other service's address, a note and a
  // reminder: everything Sage keeps that must never be in the text.
  await sage.keyStore.setCompanyKey("claude", KEY);
  await sage.settings.save({
    ...defaultSettings(),
    brain: "other",
    online: { baseUrl: OTHER_ADDRESS, model: `model-of-${USER}` },
    apps: [{ name: "Planted app", path: `${HOME}/bin/app`, args: [EMAIL] }],
    folders: [`${HOME}/Documents`],
  });
  await sage.keyStore.setOtherKey(OTHER_KEY, "https://private-service.example.net");
  await sage.notes.add(NOTE_TITLE, NOTE_TEXT);
  await sage.reminders.add(REMINDER, new Date(Date.now() + 3_600_000));

  const result = (await handlers[CHANNELS.diagnostics]({
    step: "runner",
    code: "SAGE-RUN-02",
    reducedMotion: false,
  })) as DiagnosticsResult & { ok: true };
  assert.deepEqual((await handlers[CHANNELS.copyDiagnostics]({ id: result.id })) as Result, { ok: true });
  assert.deepEqual(copied, [result.text], "copied exactly as shown");
  for (const text of [result.text, copied[0]!]) {
    for (const secret of [
      KEY,
      OTHER_KEY,
      USER,
      HOME,
      EMAIL,
      "example.org",
      NOTE_TEXT,
      NOTE_TITLE,
      REMINDER,
      OTHER_ADDRESS,
      "private-service",
      "Planted",
    ]) {
      assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), `leaked: ${secret}`);
    }
  }
  // The kind of brain is there, and the planted values were scrubbed, not dropped silently.
  assert.match(result.text, /^Brain: other$/m);
  assert.match(result.text, /^System: Windows 10\.0\.26100 \[home\]AppData \[e-mail\]$/m);
  assert.match(result.text, /^CPU: x64 \[redacted\] CUsers\[user\]Documents$/m);
  assert.match(result.text, /^Sage version: 0\.2\.0 \[address\]$/m);
});

test("the scrubber: home folder in either slash, the user name as a word, e-mail and web addresses", () => {
  const system = { home: "C:\\Users\\Alice", user: "Alice" };
  const redact = (text: string) => text.replaceAll("secret-key-value", "[redacted]");
  assert.equal(
    scrubValue("C:\\Users\\Alice\\x and c:/users/alice/y", system, redact),
    "[home]\\x and [home]/y",
  );
  assert.equal(scrubValue("ALICE-pc aliceanne", system, redact), "[user]-pc aliceanne");
  assert.equal(scrubValue("mail a.b+c@mail.example.com now", system, redact), "mail [e-mail] now");
  assert.equal(
    scrubValue("http://127.0.0.1:11434/api https://elsewhere.example/x", system, redact),
    "http://127.0.0.1:11434/api [address]",
  );
  assert.equal(scrubValue("secret-key-value", system, redact), "[redacted]");
  // A home of "/" or a one-letter user name isn't scrubbed letter by letter.
  assert.equal(scrubValue("a / b", { home: "/", user: "a" }, redact), "a / b");
});

test("the PC's own facts come from the system", () => {
  const { os, osVersion, arch, home, user } = systemFacts();
  assert.ok(os.length > 0 && osVersion.length > 0 && arch.length > 0);
  assert.equal(typeof home, "string");
  assert.equal(typeof user, "string");
});

test("Copy copies only the text built last, by its id; the window can't supply text", async (t) => {
  const { handlers, copied } = await sageWith(t);
  const request = { step: "runner", code: "SAGE-RUN-01", reducedMotion: false };
  // Nothing built yet.
  assert.deepEqual(await handlers[CHANNELS.copyDiagnostics]({ id: "diag-1" }), {
    ok: false,
    message: DIAGNOSTICS_MESSAGES.stale,
  });
  const first = (await handlers[CHANNELS.diagnostics](request)) as DiagnosticsResult & { ok: true };
  const second = (await handlers[CHANNELS.diagnostics](request)) as DiagnosticsResult & { ok: true };
  assert.notEqual(first.id, second.id);
  // An older text can't be copied once a newer one was built.
  assert.deepEqual(await handlers[CHANNELS.copyDiagnostics]({ id: first.id }), {
    ok: false,
    message: DIAGNOSTICS_MESSAGES.stale,
  });
  for (const payload of [
    undefined,
    {},
    { id: second.id, text: "anything at all" },
    { text: "anything at all" },
    { id: "diag-x" },
    { id: `${second.id}0000000000` },
    { id: 1 },
  ]) {
    assert.deepEqual(await handlers[CHANNELS.copyDiagnostics](payload), {
      ok: false,
      message: "Sage couldn't read that choice.",
    });
  }
  assert.deepEqual(copied, [], "nothing copied by any of those");
  assert.deepEqual(await handlers[CHANNELS.copyDiagnostics]({ id: second.id }), { ok: true });
  assert.deepEqual(copied, [second.text]);
});

test("the diagnostics request takes only a known step, a known code and a yes or no", async (t) => {
  const { handlers } = await sageWith(t);
  for (const payload of [
    undefined,
    {},
    { step: "place", code: "SAGE-RUN-01", reducedMotion: false },
    { step: "runner", code: "SAGE-XYZ-01", reducedMotion: false },
    { step: "runner", code: "SAGE-RUN-01", reducedMotion: "yes" },
    { step: "runner", code: "SAGE-RUN-01", reducedMotion: false, text: "my own text" },
    { step: "runner", code: "SAGE-RUN-01" },
  ]) {
    assert.deepEqual(await handlers[CHANNELS.diagnostics](payload), {
      ok: false,
      message: "Sage couldn't read that choice.",
    });
  }
});

test("a clipboard that fails says so, in plain words", async (t) => {
  const { handlers } = await sageWith(t, {
    clipboard: () => {
      throw new Error("clipboard busy");
    },
  });
  const built = (await handlers[CHANNELS.diagnostics]({
    step: "model",
    code: "SAGE-MOD-02",
    reducedMotion: false,
  })) as DiagnosticsResult & { ok: true };
  assert.deepEqual(await handlers[CHANNELS.copyDiagnostics]({ id: built.id }), {
    ok: false,
    message: DIAGNOSTICS_MESSAGES.notCopied,
  });
});

test("without the main process's parts, nothing can be copied", async (t) => {
  const sage = createSage({
    dataDir: await tempDir(t),
    keyStores: memoryKeyStores(),
    presenter: new FakePresenter(false),
    notify: () => true,
    openPath: async () => "",
    launch: async () => {},
    logSink: () => {},
    localPort: REFUSED_PORT,
  });
  const built = (await sage.diagnostics.build({
    step: "runner",
    code: "SAGE-RUN-01",
    reducedMotion: false,
  })) as DiagnosticsResult & { ok: true };
  assert.match(built.text, /^Sage version: unknown$/m);
  assert.deepEqual(sage.diagnostics.copy(built.id), { ok: false, message: DIAGNOSTICS_MESSAGES.notCopied });
});

test("keys are redacted before anything else is scrubbed, so no part of a key survives", async (t) => {
  // A user name that is part of a key: scrubbing the name first would split the key, leaving parts.
  const key = "fake-secret-value";
  const redact = (text: string) => text.replaceAll(key, "[redacted]");
  assert.equal(
    scrubValue("0.12.3-fake-secret-value", { home: "/home/alice", user: "secret" }, redact),
    "0.12.3-[redacted]",
  );
  // A key that contains the home path: scrubbing the path first would split the key too.
  const pathKey = "fake-key-/home/alice/rest-of-key";
  const redactPath = (text: string) => text.replaceAll(pathKey, "[redacted]");
  assert.equal(
    scrubValue(`10.0 ${pathKey}`, { home: "/home/alice", user: "alice" }, redactPath),
    "10.0 [redacted]",
  );

  // The same through the real text: the key is saved, the user name is "secret", and the runner
  // reports a version that carries the key.
  const server = await runner(t, ["qwen3:4b"], "0.12.3-fake-secret-value");
  const { sage } = await sageWith(t, {
    port: server.port,
    system: { os: "Linux", osVersion: `6.8 ${pathKey}`, arch: "x64", home: "/home/alice", user: "secret" },
  });
  await sage.keyStore.setCompanyKey("claude", key);
  await sage.keyStore.setCompanyKey("openai", pathKey);
  const built = (await sage.diagnostics.build({
    step: "runner",
    code: "SAGE-RUN-02",
    reducedMotion: false,
  })) as DiagnosticsResult & { ok: true };
  assert.match(built.text, /^Runner version: 0\.12\.3-\[redacted\]$/m);
  assert.match(built.text, /^System: Linux 6\.8 \[redacted\]$/m);
  for (const part of ["fake", "value", "rest-of-key"]) assert.ok(!built.text.includes(part), part);
});
