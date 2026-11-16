import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

// The preview page (scripts/preview.ts and scripts/preview/) is for review only: it is built into
// out/ (not in git, not packed) and uses only local, relative files.

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFile(join(root, path), "utf8");

test("the preview is built into out/preview from the real window files, and never packed", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts.preview, "npm run build && tsx scripts/preview.ts");
  const script = await read("scripts/preview.ts");
  assert.match(script, /const out = "out\/preview";/);
  assert.match(script, /copyFile\(`dist\/renderer\/\$\{file\}`/);
  assert.match(await read(".gitignore"), /^\/out\/$/m);
  const builder = JSON.parse(await read("electron-builder.json"));
  assert.deepEqual(builder.files, ["dist/**/*", "!dist/**/*.map", "package.json"]);
});

test("the preview page loads only relative local files, with no inline script and no addresses", async () => {
  const script = await read("scripts/preview.ts");
  assert.match(
    script,
    /'<script src="preview\.js"><\/script>\\n {4}<script src="renderer\.js" defer><\/script>'/,
  );
  for (const file of ["scripts/preview/page.ts", "scripts/preview/page.css"]) {
    const text = await read(file);
    assert.doesNotMatch(text, /https?:|\/\/[a-z]|innerHTML|outerHTML|insertAdjacentHTML|eval\(|url\(/i, file);
  }
});
