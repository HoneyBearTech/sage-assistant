import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserWindowConstructorOptions } from "electron";

/**
 * The window's security settings, kept here as plain data and pure functions so the tests can
 * check every one of them without starting Electron.
 */

/** Also in src/renderer/index.html, as a meta tag; a test keeps the two the same. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function windowOptions(
  preloadPath: string,
  devTools: boolean,
  iconPath: string,
): BrowserWindowConstructorOptions {
  return {
    width: 900,
    height: 700,
    minWidth: 480,
    minHeight: 400,
    show: false,
    title: "Sage",
    icon: iconPath,
    backgroundColor: "#050f0c",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
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
      devTools,
    },
  };
}

/** True when `url` is the app's own page (ignoring any #fragment). */
export function isAppPage(url: string | undefined, appUrl: string): boolean {
  if (!url) return false;
  try {
    const actual = new URL(url);
    const expected = new URL(appUrl);
    return actual.protocol === "file:" && actual.pathname === expected.pathname && actual.search === "";
  } catch {
    return false;
  }
}

/**
 * Every request the window makes must be one of the app's own files (or the developer tools).
 * Anything else, including every http and https address, is cancelled.
 */
export function isAllowedRequest(url: string, rendererDir: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "devtools:") return true;
  if (parsed.protocol !== "file:") return false;
  let path: string;
  try {
    path = fileURLToPath(parsed);
  } catch {
    return false;
  }
  const rel = relative(rendererDir, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Only the microphone may be granted (the voice job needs it), and only to the app's own page.
 * Camera, screen, location, notifications from the page, and everything else are refused.
 */
export function isPermissionAllowed(
  permission: string,
  details: { mediaTypes?: readonly string[] | undefined; requestingUrl?: string | undefined },
  appUrl: string,
): boolean {
  if (permission !== "media") return false;
  if (!isAppPage(details.requestingUrl, appUrl)) return false;
  const types = details.mediaTypes ?? [];
  return types.length > 0 && types.every((type) => type === "audio");
}

/** The same rule for Electron's synchronous permission checks. */
export function isPermissionCheckAllowed(
  permission: string,
  details: { mediaType?: string | undefined; requestingUrl?: string | undefined },
  appUrl: string,
): boolean {
  return permission === "media" && details.mediaType === "audio" && isAppPage(details.requestingUrl, appUrl);
}
