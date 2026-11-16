import { copyFile, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

// Builds the app into dist/: the main process, the preload and the speech helper as CommonJS files
// for Electron, and the chat window as one plain script next to its HTML and CSS. Nothing is fetched
// at run time. The speech engine (sherpa-onnx-node, with its native files) isn't bundled: the helper
// loads it from node_modules, and the packaged app keeps its native files outside the archive.

const common = {
  bundle: true,
  sourcemap: true,
  logLevel: "warning" as const,
  legalComments: "none" as const,
};

await rm("dist", { recursive: true, force: true });
await mkdir("dist/renderer", { recursive: true });

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/main/main.ts"],
    outfile: "dist/main.cjs",
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron", "sherpa-onnx-node"],
  }),
  build({
    ...common,
    entryPoints: ["src/helper/voice-helper.ts"],
    outfile: "dist/voice-helper.cjs",
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron", "sherpa-onnx-node"],
  }),
  // A sandboxed preload can only require("electron"), so everything else is bundled in.
  build({
    ...common,
    entryPoints: ["src/preload/preload.ts"],
    outfile: "dist/preload.cjs",
    platform: "browser",
    format: "cjs",
    target: "chrome130",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: ["src/renderer/renderer.ts"],
    outfile: "dist/renderer/renderer.js",
    platform: "browser",
    format: "iife",
    target: "chrome130",
  }),
  copyFile("src/renderer/index.html", "dist/renderer/index.html"),
  copyFile("src/renderer/styles.css", "dist/renderer/styles.css"),
  // The window icon (the installed app's icon is built into Sage.exe from the same file).
  copyFile("build/icon.png", "dist/icon.png"),
]);

console.log("Built dist/");
