import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { EncryptedFileKeyStore, osEncryptionUsable, validateKey } from "../src/core/keystore.js";
import { DEFAULT_LOCAL_MODEL, defaultSettings, SettingsStore } from "../src/core/settings.js";
import { captureLogs, fakeEncryptor, tempDir } from "./helpers.js";

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

test("the key file holds only the encrypted key", async (t) => {
  const dir = await tempDir(t);
  const path = join(dir, "online-key.bin");
  const store = new EncryptedFileKeyStore(path, fakeEncryptor());
  assert.equal(await store.has(), false);
  await store.set("  my-secret-key-123  ");
  assert.equal(await store.get(), "my-secret-key-123");
  assert.equal(await store.has(), true);
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
  await assert.rejects(store.set("my-secret-key-123"), /won't store the key/);
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
