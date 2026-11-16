import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedEmail, isPrivateIpv4, looksBinary, scanText } from "../scripts/lib/public-scan.js";

// The examples are assembled at run time so this file doesn't trip the checker itself.
const ip = (...parts: number[]) => parts.join(".");
const at = (local: string, domain: string) => `${local}@${domain}`;
const kinds = (text: string) => scanText("f", text).map((f) => f.kind);

test("private IPv4 ranges are found; loopback, public and documentation addresses are fine", () => {
  for (const address of [
    ip(10, 1, 2, 3),
    ip(172, 16, 0, 1),
    ip(172, 31, 255, 255),
    ip(192, 168, 1, 20),
    ip(100, 64, 0, 1),
    ip(100, 127, 1, 1),
  ]) {
    assert.deepEqual(kinds(`host ${address} here`), ["private-ip"], address);
  }
  for (const address of [
    ip(127, 0, 0, 1),
    ip(8, 8, 8, 8),
    ip(172, 32, 0, 1),
    ip(100, 128, 0, 1),
    ip(192, 0, 2, 10),
    ip(203, 0, 113, 5),
  ]) {
    assert.deepEqual(kinds(`host ${address} here`), [], address);
  }
  assert.deepEqual(kinds(`version ${ip(1, 10, 0, 0, 1)}`), [], "part of a longer dotted number");
  assert.equal(isPrivateIpv4([10, 300, 0, 1]), false);
});

test("LAN host names are found, but file names with those words are not", () => {
  const host = (...labels: string[]) => labels.join(".");
  for (const name of [
    host("nas", "local"),
    host("printer", "lan"),
    host("db", "corp", "internal"),
    host("router", "home"),
  ]) {
    assert.deepEqual(kinds(`ssh ${name}`), ["lan-hostname"], name);
  }
  assert.deepEqual(kinds("see settings.local.json and app.homepage"), []);
  assert.deepEqual(kinds(`connect to ${host("nas", "local")}.`), ["lan-hostname"]);
});

test("home folders with a real user name are found; placeholders are fine", () => {
  assert.deepEqual(kinds(`cd ${"/ho" + "me/jdoe"}/code`), ["home-path"]);
  assert.deepEqual(kinds(`open ${"/Us" + "ers/jdoe"}/Documents`), ["home-path"]);
  assert.deepEqual(kinds(`C:\\${"Us" + "ers"}\\jdoe\\Documents`), ["home-path"]);
  assert.deepEqual(kinds(`"C:\\\\${"Us" + "ers"}\\\\jdoe\\\\x"`), ["home-path"]);
  assert.deepEqual(kinds(`C:/${"Us" + "ers"}/jdoe/x`), ["home-path"]);
  for (const placeholder of [
    "/home/<user>/x",
    "/home/you/x",
    "/Users/yourname/x",
    "C:\\Users\\<you>\\x",
    "C:\\Users\\YourName\\x",
    "C:\\Users\\%USERNAME%\\x",
    "/home/runner/work",
  ]) {
    assert.deepEqual(kinds(placeholder), [], placeholder);
  }
  assert.deepEqual(kinds("~/.local/bin/tool and $HOME/x"), []);
});

test("e-mail addresses are found unless they are no-reply or example ones", () => {
  assert.deepEqual(kinds(`mail ${at("jane.doe", "gmail.com")}`), ["email"]);
  for (const ok of [
    at("123+someone", "users.noreply.github.com"),
    at("noreply", "somewhere.org"),
    at("you", "example.com"),
    at("a", "mail.example.com"),
    at("x", "test.invalid"),
    at("git", "github.com"),
  ]) {
    assert.ok(isAllowedEmail(ok), ok);
    assert.deepEqual(kinds(ok), [], ok);
  }
  assert.deepEqual(kinds("npm i @electron/fuses@2.1.3 zod@4.6.7"), []);
});

test("package-lock.json deprecation notices may name the author's address; nothing else is skipped", () => {
  const notice = `      "deprecated": "Old versions are not supported. Contact ${at("author", "maintainer.org")}",`;
  assert.deepEqual(
    scanText("package-lock.json", notice).map((f) => f.kind),
    [],
  );
  assert.deepEqual(
    scanText("sub/package-lock.json", notice).map((f) => f.kind),
    [],
  );
  // The same line elsewhere, or another field in the lockfile, is still checked.
  assert.deepEqual(
    scanText("docs/notes.md", notice).map((f) => f.kind),
    ["email"],
  );
  assert.deepEqual(
    scanText("package-lock.json", `      "author": "${at("author", "maintainer.org")}",`).map((f) => f.kind),
    ["email"],
  );
  // A notice with an escaped quote in it is still one string property.
  assert.deepEqual(
    scanText(
      "package-lock.json",
      `      "deprecated": "Use \\"new-pkg\\". ${at("author", "maintainer.org")}"`,
    ).map((f) => f.kind),
    [],
  );
  // An address after the notice on the same line, in another property or as trailing text, is found.
  const address = at("someone", "maintainer.org");
  for (const line of [
    `      "deprecated": "Old versions are not supported.", "author": "${address}",`,
    `      "deprecated": "Old versions are not supported.", ${address}`,
    `      "deprecated": "Old versions are not supported." ${address}`,
  ]) {
    assert.deepEqual(
      scanText("package-lock.json", line).map((f) => f.match),
      [address],
      line,
    );
  }
  // Then the whole line is checked, the notice included.
  assert.deepEqual(
    scanText(
      "package-lock.json",
      `      "deprecated": "Contact ${at("author", "maintainer.org")}", "author": "${address}"`,
    ).map((f) => f.match),
    [at("author", "maintainer.org"), address],
  );
  // Addresses and host names in a deprecation notice are still found.
  assert.deepEqual(
    scanText("package-lock.json", `      "deprecated": "moved to ${ip(10, 0, 0, 5)}",`).map((f) => f.kind),
    ["private-ip"],
  );
});

test("findings carry the file and line, and binary files are recognised", () => {
  const findings = scanText("docs/x.md", `fine\nsee ${ip(192, 168, 0, 9)}`);
  assert.deepEqual(findings, [{ file: "docs/x.md", line: 2, kind: "private-ip", match: ip(192, 168, 0, 9) }]);
  assert.equal(looksBinary(new Uint8Array([1, 0, 2])), true);
  assert.equal(looksBinary(new TextEncoder().encode("text")), false);
});
