import { spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  safeStorage,
  session,
  shell,
  utilityProcess,
} from "electron";
import type { Launcher } from "../core/apps.js";
import { EncryptedFileKeyStore, type Encryptor, osEncryptionUsable } from "../core/keystore.js";
import { consoleSink } from "../core/log.js";
import { createSage } from "../core/sage.js";
import { GUIDE_DETAIL, GUIDE_QUESTION, PULL_DETAIL, pullQuestion } from "../core/setup.js";
import type { ConfirmPresenter } from "../core/skills/gate.js";
import { DOWNLOAD_DETAIL, DOWNLOAD_QUESTION } from "../core/voice/model.js";
import type { HelperProcess } from "../core/voice/transcriber.js";
import { CHANNELS, type ModelChoice } from "../shared/api.js";
import { createIpcHandlers } from "./ipc.js";
import { createNotifier } from "./notify.js";
import {
  isAllowedRequest,
  isAppPage,
  isPermissionAllowed,
  isPermissionCheckAllowed,
  windowOptions,
} from "./security.js";

// The Electron entry point. Everything with logic in it lives in src/core and the pure modules
// next to this file, where the tests can reach it; this file only connects them to Electron.

app.enableSandbox();

const rendererDir = join(__dirname, "renderer");
const indexPath = join(rendererDir, "index.html");
const appUrl = pathToFileURL(indexPath).href;
let mainWindow: BrowserWindow | null = null;

const encryptor: Encryptor = {
  isAvailable: () =>
    osEncryptionUsable(
      process.platform,
      safeStorage.isEncryptionAvailable(),
      process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : "os",
    ),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (data) => safeStorage.decryptString(data),
};

const presenter: ConfirmPresenter = {
  async ask({ summary }) {
    const options = {
      type: "question" as const,
      title: "Sage is asking first",
      message: summary,
      detail: "Sage will do this only if you choose Allow.",
      buttons: ["Don't allow", "Allow"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const answer = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    return answer.response === 1;
  },
};

const launch: Launcher = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { shell: false, detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

// Voice's one-time download is asked here, in the main process's own box; the window can only
// ask for it.
async function confirmVoiceDownload(): Promise<boolean> {
  const options = {
    type: "question" as const,
    title: "Sage voice",
    message: DOWNLOAD_QUESTION,
    detail: DOWNLOAD_DETAIL,
    buttons: ["Not now", "Download"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const answer = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return answer.response === 1;
}

// The Welcome screen's two questions, asked here in the main process's own box; Not now is the
// default. The window can only ask for them.
async function askFirst(message: string, detail: string, yes: string): Promise<boolean> {
  const options = {
    type: "question" as const,
    title: "Sage setup",
    message,
    detail,
    buttons: ["Not now", yes],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const answer = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return answer.response === 1;
}

const setupParts = {
  confirmPull: (choice: ModelChoice) => askFirst(pullQuestion(choice), PULL_DETAIL, "Download"),
  confirmOpenGuide: () => askFirst(GUIDE_QUESTION, GUIDE_DETAIL, "Open"),
  // Only ever called with the install guide's fixed address (src/core/setup.ts).
  openExternal: (url: string) => shell.openExternal(url),
};

// The speech helper: a separate process, so a slow or crashing recognition can't freeze or close
// the window. Its output is dropped; it never sees the network.
function startVoiceHelper(): HelperProcess {
  const child = utilityProcess.fork(join(__dirname, "voice-helper.cjs"), [], {
    serviceName: "Sage speech",
    stdio: "ignore",
  });
  return {
    send: (message) => child.postMessage(message),
    onMessage: (listener) => child.on("message", listener),
    onExit: (listener) => child.once("exit", () => listener()),
    kill: () => void child.kill(),
  };
}

function lockDownSessionAndContents(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(
      isPermissionAllowed(
        permission,
        {
          mediaTypes: "mediaTypes" in details ? details.mediaTypes : undefined,
          requestingUrl: details.requestingUrl,
        },
        appUrl,
      ),
    );
  });
  ses.setPermissionCheckHandler((_contents, permission, _origin, details) =>
    isPermissionCheckAllowed(
      permission,
      { mediaType: details.mediaType, requestingUrl: details.requestingUrl },
      appUrl,
    ),
  );
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, rendererDir) });
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("will-redirect", (event) => event.preventDefault());
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
}

async function start(): Promise<void> {
  lockDownSessionAndContents();
  Menu.setApplicationMenu(null);

  const dataDir = app.getPath("userData");
  // A reminder that isn't confirmed here goes to the window's notice board; it counts as shown
  // only once the window has collected it.
  const notify = createNotifier({
    isSupported: () => Notification.isSupported(),
    create: (title, body) => new Notification({ title, body }),
  });
  const sage = createSage({
    dataDir,
    keyStore: new EncryptedFileKeyStore(join(dataDir, "online-key.bin"), encryptor),
    presenter,
    notify,
    openPath: (path) => shell.openPath(path),
    launch,
    logSink: consoleSink,
    voice: { confirmDownload: confirmVoiceDownload, startHelper: startVoiceHelper },
    setup: setupParts,
  });
  await sage.voice.removeLeftovers();
  app.on("will-quit", () => {
    sage.voice.dispose();
    sage.setup.dispose();
  });

  const handlers = createIpcHandlers(sage, {
    chooseFolder: async () => {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    chooseApp: async () => {
      if (!mainWindow) return null;
      const filters = process.platform === "win32" ? [{ name: "Programs", extensions: ["exe"] }] : [];
      const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  });
  for (const channel of Object.values(CHANNELS)) {
    ipcMain.handle(channel, (event, payload) => {
      // Only the app's own page, in Sage's own window, may call the main process.
      if (
        !mainWindow ||
        event.sender !== mainWindow.webContents ||
        !isAppPage(event.senderFrame?.url, appUrl)
      ) {
        throw new Error("Refused: this request didn't come from Sage's window.");
      }
      return handlers[channel](payload);
    });
  }

  createWindow();
  sage.scheduler.start();
}

function createWindow(): void {
  mainWindow = new BrowserWindow(
    windowOptions(join(__dirname, "preload.cjs"), !app.isPackaged, join(__dirname, "icon.png")),
  );
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadFile(indexPath);
}

if (!app.requestSingleInstanceLock()) {
  // Sage is already open; the running copy brings its window forward.
  app.quit();
} else {
  // Windows shows notifications only for an app with an id; in development that is Electron itself.
  if (process.platform === "win32") {
    app.setAppUserModelId(app.isPackaged ? "com.honeybeartech.sage" : process.execPath);
  }
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(start, (error: unknown) => {
    console.error("[sage] error: Sage couldn't start", error);
    app.quit();
  });
}
