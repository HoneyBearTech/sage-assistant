import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  const source = await readFile(join(root, "src", "renderer", "renderer.ts"), "utf8");
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
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

test("the fuses switch off Node entry points and require the integrity-checked archive", () => {
  assert.deepEqual(SAGE_FUSES, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
});

test("nothing in the app sends telemetry or analytics", async () => {
  const { readdir } = await import("node:fs/promises");
  const sources: string[] = [];
  for (const entry of await readdir(join(root, "src"), { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) sources.push(await readFile(join(entry.parentPath, entry.name), "utf8"));
  }
  const all = sources.join("\n");
  assert.doesNotMatch(all, /telemetry|analytics|sentry|crashReporter|mixpanel|posthog|segment\.io/i);
  // The only network addresses in the app: the local runner, the search page, and the user's own service.
  const urls = [...all.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]);
  for (const url of urls) {
    assert.ok(
      /^https:\/\/html\.duckduckgo\.com\/html\/$|^http:\/\/\$\{LOCAL_HOST\}|^https:\/\/api\.example\.com|^https:\/\/duckduckgo\.com$/.test(
        url,
      ),
      `unexpected address in src/: ${url}`,
    );
  }
});
