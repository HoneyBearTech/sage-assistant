import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

// Builds a preview page of Sage's window into out/preview/, for review only: it is never part of
// Sage (electron-builder packs only dist/, and out/ isn't in git). It uses the real built window
// (dist/renderer: run `npm run build` first; `npm run preview` does) plus a small script of its own
// that stands in for the main process with sample data and adds a control strip. Every path is
// relative, nothing is fetched, and there are no inline scripts or styles, so the page works opened
// from disk and served as plain files, under the window's own content rule.

const out = "out/preview";
const source = await readFile("src/renderer/index.html", "utf8");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const file of ["styles.css", "renderer.js", "renderer.js.map"]) {
  await copyFile(`dist/renderer/${file}`, `${out}/${file}`);
}
await copyFile("scripts/preview/page.css", `${out}/preview.css`);
await build({
  entryPoints: ["scripts/preview/page.ts"],
  outfile: `${out}/preview.js`,
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome130",
  logLevel: "warning",
  legalComments: "none",
});

// The same page, with the preview's script loaded first (it supplies window.sage) and its stylesheet.
const replacements: [string, string][] = [
  ["<title>Sage</title>", "<title>Sage preview</title>"],
  [
    '<link rel="stylesheet" href="styles.css" />',
    '<link rel="stylesheet" href="styles.css" />\n    <link rel="stylesheet" href="preview.css" />',
  ],
  [
    '<script src="renderer.js" defer></script>',
    '<script src="preview.js"></script>\n    <script src="renderer.js" defer></script>',
  ],
];
let page = source;
for (const [from, to] of replacements) {
  if (!page.includes(from)) throw new Error(`index.html no longer has ${from}`);
  page = page.replace(from, to);
}
await writeFile(`${out}/index.html`, page);

console.log(`Preview built: ${resolve(out, "index.html")}`);
