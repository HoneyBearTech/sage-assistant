import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { SAGE_FUSES } from "../src/main/fuses-config.js";
import {
  CONTENT_SECURITY_POLICY,
  isAllowedRequest,
  isAppPage,
  isPermissionAllowed,
  isPermissionCheckAllowed,
  windowOptions,
} from "../src/main/security.js";
import { CHANNELS } from "../src/shared/api.js";

const root = join(import.meta.dirname, "..");
const rendererDir = join(root, "dist", "renderer");
const appUrl = pathToFileURL(join(rendererDir, "index.html")).href;

test("the window is sandboxed, isolated and has no Node access", () => {
  const options = windowOptions("/app/preload.cjs", false);
  assert.deepEqual(options.webPreferences, {
    preload: "/app/preload.cjs",
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    safeDialogs: true,
    spellcheck: false,
    devTools: false,
  });
  assert.equal(options.show, false);
  assert.equal(windowOptions("/p", true).webPreferences?.devTools, true);
});

test("the page's CSP is strict and matches the one in the code", async () => {
  const html = await readFile(join(root, "src", "renderer", "index.html"), "utf8");
  const meta = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  assert.equal(meta?.[1], CONTENT_SECURITY_POLICY);
  assert.match(CONTENT_SECURITY_POLICY, /^default-src 'self'/);
  assert.match(CONTENT_SECURITY_POLICY, /connect-src 'self'/);
  assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-inline|unsafe-eval|https?:|\*/);
  // No inline script, no inline event handlers, nothing loaded from elsewhere.
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(script[1]!, /src="renderer\.js"/);
    assert.equal(script[2]!.trim(), "");
  }
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//);
});

test("the renderer never inserts text as HTML", async () => {
  for (const file of ["renderer.ts"]) {
    const source = await readFile(join(root, "src", "renderer", file), "utf8");
    assert.doesNotMatch(
      source,
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/,
      file,
    );
  }
});

test("the preload exposes only the named methods, never ipcRenderer itself", async () => {
  const source = await readFile(join(root, "src", "preload", "preload.ts"), "utf8");
  assert.equal(source.match(/exposeInMainWorld/g)?.length, 1);
  assert.match(source, /exposeInMainWorld\("sage", api\)/);
  const invoked = [...source.matchAll(/invoke\(CHANNELS\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(invoked, Object.keys(CHANNELS).sort());
  assert.doesNotMatch(source, /ipcRenderer\.(on|send|sendSync|postMessage)\b/);
});

test("only the app's own page counts as the sender", () => {
  assert.equal(isAppPage(appUrl, appUrl), true);
  assert.equal(isAppPage(`${appUrl}#settings`, appUrl), true);
  assert.equal(isAppPage(`${appUrl}?x=1`, appUrl), false);
  assert.equal(isAppPage("https://example.com/index.html", appUrl), false);
  assert.equal(isAppPage(pathToFileURL(join(rendererDir, "other.html")).href, appUrl), false);
  assert.equal(isAppPage(undefined, appUrl), false);
  assert.equal(isAppPage("::not a url", appUrl), false);
});

test("the window may load only its own files", () => {
  assert.equal(isAllowedRequest(pathToFileURL(join(rendererDir, "renderer.js")).href, rendererDir), true);
  assert.equal(isAllowedRequest("devtools://devtools/bundled/x.html", rendererDir), true);
  assert.equal(isAllowedRequest(pathToFileURL(join(root, "package.json")).href, rendererDir), false);
  assert.equal(isAllowedRequest(pathToFileURL(rendererDir).href, rendererDir), false);
  assert.equal(isAllowedRequest("https://example.com/x.js", rendererDir), false);
  assert.equal(isAllowedRequest("http://127.0.0.1:11434/api/chat", rendererDir), false);
  assert.equal(isAllowedRequest("data:text/html,hi", rendererDir), false);
  assert.equal(isAllowedRequest("file://remote-host/share/x", rendererDir), false);
  assert.equal(isAllowedRequest("nonsense", rendererDir), false);
});

test("the microphone is the only permission the page can get", () => {
  const mic = { mediaTypes: ["audio"], requestingUrl: appUrl };
  assert.equal(isPermissionAllowed("media", mic, appUrl), true);
  assert.equal(
    isPermissionAllowed("media", { mediaTypes: ["audio", "video"], requestingUrl: appUrl }, appUrl),
    false,
  );
  assert.equal(isPermissionAllowed("media", { mediaTypes: ["video"], requestingUrl: appUrl }, appUrl), false);
  assert.equal(isPermissionAllowed("media", { mediaTypes: [], requestingUrl: appUrl }, appUrl), false);
  assert.equal(
    isPermissionAllowed("media", { mediaTypes: ["audio"], requestingUrl: "https://example.com" }, appUrl),
    false,
  );
  for (const permission of [
    "geolocation",
    "notifications",
    "display-capture",
    "clipboard-read",
    "openExternal",
    "fullscreen",
  ]) {
    assert.equal(isPermissionAllowed(permission, mic, appUrl), false, permission);
  }
  assert.equal(
    isPermissionCheckAllowed("media", { mediaType: "audio", requestingUrl: appUrl }, appUrl),
    true,
  );
  assert.equal(
    isPermissionCheckAllowed("media", { mediaType: "video", requestingUrl: appUrl }, appUrl),
    false,
  );
  assert.equal(isPermissionCheckAllowed("geolocation", { requestingUrl: appUrl }, appUrl), false);
});

test("the fuses switch off Node entry points and file:// extras, and require the integrity-checked archive", () => {
  assert.deepEqual(SAGE_FUSES, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
});

test("the installer settings set exactly the fuses in fuses-config.ts, and the app id Sage uses", async () => {
  const builder = JSON.parse(await readFile(join(root, "electron-builder.json"), "utf8"));
  // electron-builder names each fuse in camelCase: FuseV1Options.RunAsNode is "runAsNode".
  const expected: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(SAGE_FUSES)) {
    if (key === "version") continue;
    const name = FuseV1Options[Number(key)];
    assert.ok(name, `fuse ${key} has a name`);
    expected[name.charAt(0).toLowerCase() + name.slice(1)] = value as boolean;
  }
  assert.deepEqual(builder.electronFuses, expected);

  const main = await readFile(join(root, "src", "main", "main.ts"), "utf8");
  const ids = [...main.matchAll(/setAppUserModelId\(app\.isPackaged \? "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, [builder.appId]);
  // The data folder comes from package.json's name, so the product name lives only in the builder file.
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(pkg.name, "sage-assistant");
  assert.equal(pkg.productName, undefined);
  assert.equal(builder.extraMetadata, undefined);
});

test("nothing in the app sends telemetry or analytics", async () => {
  const sources: string[] = [];
  for (const entry of await readdir(join(root, "src"), { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) sources.push(await readFile(join(entry.parentPath, entry.name), "utf8"));
  }
  const all = sources.join("\n");
  assert.doesNotMatch(all, /telemetry|analytics|sentry|crashReporter|mixpanel|posthog|segment\.io/i);
  // The only network addresses in the app: the local runner, the search page, the user's own
  // service, the three files of the speech model, pinned to one commit on Hugging Face, and the
  // install guide's one fixed address.
  const speechModel =
    "https://huggingface.co/csukuangfj2/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27/resolve/d1e6c30921780b8508d04b492dfb3ce8a51605d4/";
  const allowed = new Set([
    ...["encoder_model.ort", "decoder_model_merged.ort", "tokens.txt"].map((name) => `${speechModel}${name}`),
    // The one page Sage can open in the web browser, after asking: its own install guide.
    "https://github.com/HoneyBearTech/sage-assistant/blob/main/docs/installing.md#local-model-runner",
  ]);
  const urls = [...all.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]);
  for (const url of urls) {
    assert.ok(
      allowed.has(url) ||
        /^https:\/\/html\.duckduckgo\.com\/html\/$|^http:\/\/\$\{LOCAL_HOST\}|^https:\/\/api\.example\.com|^https:\/\/duckduckgo\.com$/.test(
          url,
        ),
      `unexpected address in src/: ${url}`,
    );
  }
  for (const url of allowed) assert.ok(urls.includes(url), `${url} is the one in the code`);
});

test("the speech engine is the one run-time dependency, kept out of the bundles, its native files unpacked", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.deepEqual(pkg.dependencies, { "sherpa-onnx-node": "2.0.1" }, "one dependency, exact version");
  const build = await readFile(join(root, "scripts", "build.ts"), "utf8");
  assert.match(
    build,
    /entryPoints: \["src\/helper\/voice-helper\.ts"\],\s+outfile: "dist\/voice-helper\.cjs"/,
  );
  assert.equal(build.match(/external: \["electron", "sherpa-onnx-node"\]/g)?.length, 2, "main and helper");
  const builder = JSON.parse(await readFile(join(root, "electron-builder.json"), "utf8"));
  assert.deepEqual(builder.asarUnpack, ["node_modules/sherpa-onnx-*-*/*.{node,dll,so,dylib}"]);
  assert.deepEqual(builder.files, ["dist/**/*", "!dist/**/*.map", "package.json"]);
  // Only the speech helper loads the engine; the main process and the window never do.
  const users: string[] = [];
  for (const entry of await readdir(join(root, "src"), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
    const text = await readFile(join(entry.parentPath, entry.name), "utf8");
    if (/from "sherpa-onnx-node"|require\("sherpa-onnx-node"\)/.test(text)) users.push(entry.name);
  }
  assert.deepEqual(users, ["voice-helper.ts"]);
});

test("the speech helper never logs, writes files or opens a connection", async () => {
  for (const file of [
    join("src", "helper", "voice-helper.ts"),
    join("src", "core", "voice", "helper-protocol.ts"),
    join("src", "core", "voice", "transcriber.ts"),
  ]) {
    const text = await readFile(join(root, file), "utf8");
    assert.doesNotMatch(text, /console\.|node:fs|fetch\(|node:net|node:http|writeFile/, file);
  }
});

test("Sage opens one web address, its install guide, and only after asking", async () => {
  const calls: string[] = [];
  for (const entry of await readdir(join(root, "src"), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const text = await readFile(join(entry.parentPath, entry.name), "utf8");
    for (const match of text.matchAll(/openExternal\(([^)]*)\)/g)) calls.push(`${entry.name}: ${match[1]}`);
  }
  // main.ts hands Electron's openExternal to Setup, which calls it with the fixed address only.
  assert.deepEqual(calls.sort(), ["main.ts: url", "setup.ts: INSTALL_GUIDE_URL"]);
  const setup = await readFile(join(root, "src", "core", "setup.ts"), "utf8");
  const opening = setup.slice(setup.indexOf("async openInstallGuide("), setup.indexOf("async finish("));
  assert.ok(
    opening.indexOf("confirmOpenGuide()") < opening.indexOf("openExternal(INSTALL_GUIDE_URL)"),
    "asked before opening",
  );
  // The window's request carries nothing that could become an address.
  const preload = await readFile(join(root, "src", "preload", "preload.ts"), "utf8");
  assert.match(preload, /openInstallGuide: \(\) => ipcRenderer\.invoke\(CHANNELS\.openInstallGuide\),/);
});
