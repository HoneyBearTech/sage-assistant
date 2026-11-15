import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { test } from "node:test";
import { hasStreamName, isAllowedFileName, isInside, resolveApprovedFile } from "../src/core/files.js";
import { tempDir } from "./helpers.js";

async function layout(t: Parameters<typeof tempDir>[0]) {
  const root = await tempDir(t);
  const approved = join(root, "approved");
  const outside = join(root, "outside");
  await mkdir(join(approved, "sub"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(approved, "report.txt"), "fine");
  await writeFile(join(approved, "sub", "deep.pdf"), "fine");
  await writeFile(join(approved, "setup.exe"), "MZ");
  await writeFile(join(outside, "secret.txt"), "secret");
  return { root, approved, outside };
}

test("opens files inside an approved folder, at any depth", async (t) => {
  const { approved } = await layout(t);
  assert.deepEqual(await resolveApprovedFile(join(approved, "report.txt"), [approved]), {
    ok: true,
    path: join(approved, "report.txt"),
  });
  const deep = await resolveApprovedFile(join(approved, "sub", "deep.pdf"), [approved]);
  assert.ok(deep.ok);
});

test("rejects ../ escapes out of an approved folder", async (t) => {
  const { approved } = await layout(t);
  const dotDot = `${approved}${sep}..${sep}outside${sep}secret.txt`;
  const result = await resolveApprovedFile(dotDot, [approved]);
  assert.equal(result.ok, false);
  const sneaky = await resolveApprovedFile(join(approved, "sub", "..", "..", "outside", "secret.txt"), [
    approved,
  ]);
  assert.equal(sneaky.ok, false);
});

test("rejects symlinks that point out of an approved folder", async (t) => {
  const { approved, outside } = await layout(t);
  await symlink(join(outside, "secret.txt"), join(approved, "innocent.txt"));
  await symlink(outside, join(approved, "linked-dir"), "dir");
  assert.equal((await resolveApprovedFile(join(approved, "innocent.txt"), [approved])).ok, false);
  assert.equal((await resolveApprovedFile(join(approved, "linked-dir", "secret.txt"), [approved])).ok, false);
});

test("an approved folder that is itself a symlink still works, by its real path", async (t) => {
  const { root, approved } = await layout(t);
  const alias = join(root, "alias");
  await symlink(approved, alias, "dir");
  const result = await resolveApprovedFile(join(alias, "report.txt"), [alias]);
  assert.deepEqual(result, { ok: true, path: join(approved, "report.txt") });
});

test("a folder whose name starts the same isn't inside it", async (t) => {
  const { root, approved } = await layout(t);
  const sibling = join(root, "approved-evil");
  await mkdir(sibling);
  await writeFile(join(sibling, "x.txt"), "x");
  assert.equal((await resolveApprovedFile(join(sibling, "x.txt"), [approved])).ok, false);
  assert.equal(isInside(approved, sibling), false);
  assert.equal(isInside(approved, join(approved, "a")), true);
});

test("rejects relative paths, missing files, folders, programs and bad input", async (t) => {
  const { approved } = await layout(t);
  assert.match(((await resolveApprovedFile("report.txt", [approved])) as any).message, /full path/);
  assert.match(
    ((await resolveApprovedFile(join(approved, "nope.txt"), [approved])) as any).message,
    /no file/,
  );
  await mkdir(join(approved, "folder.pdf"));
  assert.match(
    ((await resolveApprovedFile(join(approved, "folder.pdf"), [approved])) as any).message,
    /isn't a file/,
  );
  assert.match(
    ((await resolveApprovedFile(join(approved, "setup.exe"), [approved])) as any).message,
    /programs/,
  );
  assert.equal((await resolveApprovedFile(`${approved}/a\0b`, [approved])).ok, false);
});

test("only documents, pictures, sound and video open; everything else is refused", async (t) => {
  const { approved } = await layout(t);
  for (const name of ["a.pdf", "b.DOCX", "c.jpg", "d.mp3", "e.mp4", "f.csv", "g.odt", "h.md"]) {
    await writeFile(join(approved, name), "x");
    assert.equal((await resolveApprovedFile(join(approved, name), [approved])).ok, true, name);
  }
  for (const name of [
    "run.ps1",
    "link.lnk",
    "page.html",
    "macro.docm",
    "script.js",
    "noextension",
    "x.url",
  ]) {
    await writeFile(join(approved, name), "x");
    assert.equal((await resolveApprovedFile(join(approved, name), [approved])).ok, false, name);
  }
  assert.equal(isAllowedFileName("report.txt."), false, "a trailing dot");
  assert.equal(isAllowedFileName("report.txt "), false, "a trailing space");
  assert.equal(isAllowedFileName(".pdf"), false, "a hidden file with no extension");
  assert.equal(isAllowedFileName("report.txt"), true);
  assert.equal((await resolveApprovedFile(join(approved, "report.txt."), [approved])).ok, false);
});

test("on Windows a ':' after the drive (an alternate data stream) is refused", async (t) => {
  assert.equal(hasStreamName("C:\\Docs\\report.exe:notes.txt", "win32"), true);
  assert.equal(hasStreamName("C:\\Docs\\report.txt:hidden", "win32"), true);
  assert.equal(hasStreamName("C:\\Do:cs\\report.txt", "win32"), true, "in a folder name too");
  assert.equal(hasStreamName("C:\\Docs\\report.txt", "win32"), false, "the drive letter is fine");
  assert.equal(hasStreamName("\\\\server\\share\\report.txt", "win32"), false);
  assert.equal(hasStreamName("/docs/a:b.txt", "linux"), false, "only Windows has streams");
  const { approved } = await layout(t);
  // A real file with a colon in its name (legal on Linux) is refused when Sage runs on Windows.
  await writeFile(join(approved, "notes.exe:readme.txt"), "x");
  const onWindows = await resolveApprovedFile(join(approved, "notes.exe:readme.txt"), [approved], "win32");
  assert.deepEqual(onWindows, { ok: false, message: 'Sage doesn\'t open file names with ":" in them.' });
  assert.equal(
    (await resolveApprovedFile(join(approved, "notes.exe:readme.txt"), [approved], "linux")).ok,
    true,
  );
  // A link with a plain name whose real file has a colon is refused by the real name.
  await symlink(join(approved, "notes.exe:readme.txt"), join(approved, "plain.txt"));
  assert.equal((await resolveApprovedFile(join(approved, "plain.txt"), [approved], "win32")).ok, false);
});

test("a document-named symlink to a program is refused by the real file's type", async (t) => {
  const { approved } = await layout(t);
  await symlink(join(approved, "setup.exe"), join(approved, "looks-safe.pdf"));
  const result = await resolveApprovedFile(join(approved, "looks-safe.pdf"), [approved]);
  assert.equal(result.ok, false);
});

test("with no approved folders (or only missing ones) nothing can be opened", async (t) => {
  const { root, approved } = await layout(t);
  assert.equal((await resolveApprovedFile(join(approved, "report.txt"), [])).ok, false);
  assert.equal((await resolveApprovedFile(join(approved, "report.txt"), [join(root, "gone")])).ok, false);
});
