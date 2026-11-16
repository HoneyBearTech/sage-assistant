import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  decodeSavedKey,
  EncryptedFileKeyStore,
  osEncryptionUsable,
  ServiceKeys,
  validateKey,
} from "../src/core/keystore.js";
import { DEFAULT_LOCAL_MODEL, defaultSettings, SettingsStore } from "../src/core/settings.js";
import { captureLogs, fakeEncryptor, MemoryKeyStore, tempDir } from "./helpers.js";

test("first run gives the local brain and empty lists", async (t) => {
  const dir = await tempDir(t);
  const settings = await new SettingsStore(dir, captureLogs().logger).load();
  assert.deepEqual(settings, defaultSettings());
  assert.equal(settings.brain, "local");
  assert.equal(settings.local.model, DEFAULT_LOCAL_MODEL);
  assert.deepEqual(settings.apps, []);
  assert.deepEqual(settings.folders, []);
});

test("saving validates, and drops anything that isn't a setting, such as a key", async (t) => {
  const dir = await tempDir(t);
  const store = new SettingsStore(dir, captureLogs().logger);
  const result = await store.save({
    ...defaultSettings(),
    brain: "online",
    apiKey: "should-not-be-saved",
    online: { baseUrl: "https://api.example.com", model: "m", key: "also-not-saved" },
  });
  assert.ok(result.ok);
  const text = await readFile(join(dir, "settings.json"), "utf8");
  assert.ok(!text.includes("should-not-be-saved"));
  assert.ok(!text.includes("also-not-saved"));
  assert.equal((await store.load()).brain, "online");
});

test("a settings file saved before voice loads unchanged, with Read replies aloud at its default", async (t) => {
  const dir = await tempDir(t);
  // Exactly what Sage wrote before this setting existed.
  const before = {
    version: 1,
    brain: "online",
    local: { model: "small-model" },
    online: { baseUrl: "https://api.example.com/v1", model: "m" },
    apps: [{ name: "Editor", path: "/usr/bin/editor", args: ["--new-window"] }],
    folders: ["/docs"],
  };
  const text = `${JSON.stringify(before, null, 2)}\n`;
  await writeFile(join(dir, "settings.json"), text);
  const { logger, lines } = captureLogs();
  const loaded = await new SettingsStore(dir, logger).load();
  assert.deepEqual(loaded, { ...before, speakReplies: "voice", setupDone: false });
  assert.deepEqual(lines, [], "not treated as unreadable");
  assert.equal(await readFile(join(dir, "settings.json"), "utf8"), text, "the file isn't touched by loading");
  assert.equal(defaultSettings().speakReplies, "voice");
  assert.equal(defaultSettings().version, 1);
});

test("a settings file saved before first-run setup loads unchanged, and shows the Welcome screen once", async (t) => {
  const dir = await tempDir(t);
  // Exactly what Sage wrote before "set up" existed (with voice's setting).
  const before = {
    version: 1,
    brain: "local",
    local: { model: "qwen3:1.7b" },
    online: { baseUrl: "https://api.example.com/v1", model: "m" },
    apps: [{ name: "Editor", path: "/usr/bin/editor", args: [] }],
    folders: ["/docs"],
    speakReplies: "always",
  };
  const text = `${JSON.stringify(before, null, 2)}\n`;
  await writeFile(join(dir, "settings.json"), text);
  const { logger, lines } = captureLogs();
  const store = new SettingsStore(dir, logger);
  assert.deepEqual(await store.load(), { ...before, setupDone: false });
  assert.deepEqual(lines, [], "not treated as unreadable");
  assert.equal(await readFile(join(dir, "settings.json"), "utf8"), text, "the file isn't touched by loading");
  assert.equal(defaultSettings().setupDone, false);
  for (const bad of ["yes", 1, null]) {
    assert.equal((await store.save({ ...before, setupDone: bad })).ok, false, String(bad));
  }
});

test("update changes only what it is given, under the settings lock, and validates the result", async (t) => {
  const store = new SettingsStore(await tempDir(t), captureLogs().logger);
  assert.ok((await store.save({ ...defaultSettings(), folders: ["/docs"], speakReplies: "never" })).ok);
  // Two changes at once: neither overwrites the other.
  const [first, second] = await Promise.all([
    store.update((current) => ({ ...current, setupDone: true })),
    store.update((current) => ({ ...current, local: { model: "qwen3:1.7b" } })),
  ]);
  assert.ok(first.ok && second.ok);
  assert.equal(first.previous.setupDone, false);
  assert.equal(second.previous.setupDone, true, "the second change sees the first");
  assert.deepEqual(await store.load(), {
    ...defaultSettings(),
    folders: ["/docs"],
    speakReplies: "never",
    setupDone: true,
    local: { model: "qwen3:1.7b" },
  });
  const refused = await store.update((current) => ({ ...current, brain: "elsewhere" }));
  assert.equal(refused.ok, false);
  assert.equal((await store.load()).brain, "local", "a refused change saves nothing");
});

test("Read replies aloud is saved, and only its three choices are accepted", async (t) => {
  const store = new SettingsStore(await tempDir(t), captureLogs().logger);
  for (const choice of ["always", "never", "voice"] as const) {
    assert.ok((await store.save({ ...defaultSettings(), speakReplies: choice })).ok);
    assert.equal((await store.load()).speakReplies, choice);
  }
  for (const bad of ["sometimes", "", 1, null]) {
    assert.equal((await store.save({ ...defaultSettings(), speakReplies: bad })).ok, false, String(bad));
  }
});

test("bad settings are refused with a reason", async (t) => {
  const store = new SettingsStore(await tempDir(t), captureLogs().logger);
  assert.equal((await store.save({ brain: "telepathy" })).ok, false);
  const dupes = await store.save({
    apps: [
      { name: "Paint", path: "/a" },
      { name: "paint", path: "/b" },
    ],
  });
  assert.ok(!dupes.ok && /different name/.test(dupes.message));
});

test("a broken settings file falls back to defaults and is kept aside", async (t) => {
  const dir = await tempDir(t);
  const { logger, lines } = captureLogs();
  await writeFile(join(dir, "settings.json"), "{");
  assert.deepEqual(await new SettingsStore(dir, logger).load(), defaultSettings());
  assert.ok(lines.some((line) => line.includes("settings.json couldn't be read")));
});

test("the key file holds only the encrypted key and the service it belongs to", async (t) => {
  const dir = await tempDir(t);
  const path = join(dir, "online-key.bin");
  const store = new EncryptedFileKeyStore(path, fakeEncryptor());
  assert.equal(await store.has(), false);
  await store.set("  my-secret-key-123  ", "https://service.example");
  assert.deepEqual(await store.get(), { key: "my-secret-key-123", origin: "https://service.example" });
  assert.equal(await store.has(), true);
  await store.set("my-secret-key-123", null);
  assert.deepEqual(await store.get(), { key: "my-secret-key-123", origin: null });
  const raw = await readFile(path);
  assert.ok(!raw.toString("utf8").includes("my-secret-key-123"));
  assert.ok(!raw.toString("latin1").includes(Buffer.from("my-secret-key-123").toString("base64")));
  await store.clear();
  assert.equal(await store.get(), null);
  await store.clear();
});

test("without system encryption the key is refused, never stored in the clear", async (t) => {
  const dir = await tempDir(t);
  const path = join(dir, "online-key.bin");
  const store = new EncryptedFileKeyStore(path, fakeEncryptor(false));
  await assert.rejects(store.set("my-secret-key-123", null), /won't store the key/);
  await assert.rejects(readFile(path), { code: "ENOENT" });
  await writeFile(path, "FAKE-OS-ENC:whatever");
  assert.equal(await store.get(), null, "can't decrypt without the system");
  const other = new EncryptedFileKeyStore(path, {
    ...fakeEncryptor(),
    decrypt: () => {
      throw new Error("wrong user");
    },
  });
  assert.equal(await other.get(), null);
  // A file that decrypts but isn't a key with its service (an older format) counts as no key.
  const plain = new EncryptedFileKeyStore(path, { ...fakeEncryptor(), decrypt: () => "just-a-bare-key-123" });
  assert.equal(await plain.get(), null);
  assert.equal(decodeSavedKey('{"version":1,"key":"","origin":null}'), null);
  assert.equal(decodeSavedKey('{"version":2,"key":"k","origin":null}'), null);
});

test("a key is handed out only for the service it belongs to", async () => {
  const seen: string[] = [];
  const keys = new ServiceKeys(new MemoryKeyStore(), (key) => seen.push(key));
  assert.equal(await keys.afterAddressSaved("https://a.example"), "none");
  await keys.set("key-for-service-a", "https://a.example");
  assert.equal(await keys.keyFor("https://a.example"), "key-for-service-a");
  assert.equal(await keys.keyFor("https://b.example"), null);
  assert.equal(await keys.keyFor("https://a.example:8443"), null);
  assert.equal(await keys.afterAddressSaved("https://a.example"), "kept");
  assert.equal(await keys.afterAddressSaved("https://b.example"), "removed");
  assert.equal(await keys.has(), false);
  // A key saved before any address belongs to the first address saved, and to nothing before that.
  await keys.set("key-saved-first", null);
  assert.equal(await keys.keyFor("https://a.example"), null);
  assert.equal(await keys.afterAddressSaved(null), "kept");
  assert.equal(await keys.afterAddressSaved("https://b.example"), "bound");
  assert.equal(await keys.keyFor("https://b.example"), "key-saved-first");
  assert.ok(
    seen.includes("key-for-service-a") && seen.includes("key-saved-first"),
    "the redactor knows both",
  );
  await assert.rejects(keys.set("short", null), /8 to 500/);
  assert.ok(!seen.includes("short"), "a refused key isn't registered");
  await keys.clear();
  assert.equal(await keys.keyFor("https://b.example"), null);
});

test("keys are checked, and Linux's plain-text fallback doesn't count as protection", () => {
  assert.throws(() => validateKey("short"), /8 to 500/);
  assert.throws(() => validateKey("has space inside"), /spaces/);
  assert.equal(validateKey(" abcdefgh12 "), "abcdefgh12");
  assert.equal(osEncryptionUsable("win32", true, "os"), true);
  assert.equal(osEncryptionUsable("win32", false, "os"), false);
  assert.equal(osEncryptionUsable("linux", true, "basic_text"), false);
  assert.equal(osEncryptionUsable("linux", true, "unknown"), false);
  assert.equal(osEncryptionUsable("linux", true, "gnome_libsecret"), true);
});
