import { readFile } from "node:fs/promises";
import type { TestContext } from "node:test";
import type { AskingEvent, HomeSummary, PublicSettings, SageApi } from "../src/shared/api.js";
import { installFakeDom, removeFakeDom } from "./fake-dom.js";
import { type FakeMedia, installFakeMedia, removeFakeMedia } from "./fake-media.js";
import { settled } from "./helpers.js";

// The window script is loaded once. It does nothing until startChatWindow() is called. (Loaded by a
// computed path: the window has its own TypeScript config with the DOM, which these tests do not have.)
const rendererFile = new URL("../src/renderer/renderer.ts", import.meta.url);
const { startChatWindow } = (await import(rendererFile.href)) as { startChatWindow: () => void };
const source = await readFile(rendererFile, "utf8");

// The real window script, run against a small fake DOM (test/fake-dom.ts) and a fake window.sage.
const ids = [...source.matchAll(/byId<\w+>\("([\w-]+)"\)/g)].map((match) => match[1]!);

/** Sample models for the ready-made services, and no keys: for tests that build their own settings. */
export const SAMPLE_SERVICES: PublicSettings["services"] = {
  claude: { model: "claude-model" },
  openai: { model: "openai-model" },
  gemini: { model: "gemini-model" },
};
export const NO_KEYS: PublicSettings["keys"] = { claude: false, openai: false, gemini: false, other: false };

/** Home's summary with nothing in it. */
export const EMPTY_HOME: HomeSummary = {
  reminders: [],
  next: null,
  notes: [],
  status: { brain: "local", voiceReady: false, sound: false },
};

export interface WindowOptions {
  /** Home's summary, for the default `homeSummary` request. */
  summary?: HomeSummary;
  /** Settings the window loads at start-up, over the defaults. */
  settings?: Partial<PublicSettings>;
  /** Runs before the window script loads, to set up the microphone or the voices. */
  before?: (media: FakeMedia) => void;
}

export async function startWindow(
  t: TestContext,
  send: (text: string) => Promise<string>,
  overrides: Partial<SageApi> = {},
  options: WindowOptions = {},
) {
  // The window's timers (the notice poll, the voice timers) and the clock are mocked, so nothing
  // fires by itself and nothing is left running.
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
  const calls = {
    send: [] as string[],
    getSettings: 0,
    reset: 0,
    saved: [] as unknown[],
    finishSetup: 0,
    pulls: [] as string[],
    cancelPull: 0,
    openGuide: 0,
    sound: [] as boolean[],
    keys: [] as [string, string][],
    cleared: [] as string[],
    listModels: [] as string[],
    testKey: [] as string[],
    keyPages: [] as string[],
    homeSummary: 0,
    claims: 0,
  };
  const settings: PublicSettings = {
    brain: "local",
    local: { model: "small-model" },
    online: { baseUrl: "", model: "" },
    services: structuredClone(SAMPLE_SERVICES),
    keys: { ...NO_KEYS },
    apps: [],
    folders: [],
    speakReplies: "voice",
    // Existing window tests start as "already set up"; the Welcome screen's tests say otherwise.
    setupDone: true,
    theme: "dark",
    sound: false,
    morningBrief: false,
    ...options.settings,
  };
  const askingListeners: ((event: AskingEvent) => void)[] = [];
  const api: SageApi = {
    send: (text) => {
      calls.send.push(text);
      return send(text);
    },
    resetChat: async () => {
      calls.reset++;
    },
    getSettings: async () => {
      calls.getSettings++;
      return structuredClone(settings);
    },
    saveSettings: async (input) => {
      calls.saved.push(structuredClone(input));
      return { ok: true };
    },
    setKey: async (brain, key) => {
      calls.keys.push([brain, key]);
      settings.keys[brain] = true;
      return { ok: true };
    },
    clearKey: async (brain) => {
      calls.cleared.push(brain);
      settings.keys[brain] = false;
      return { ok: true };
    },
    listModels: async (company) => {
      calls.listModels.push(company);
      return { ok: true, models: [`${company}-a`, `${company}-b`] };
    },
    testKey: async (company) => {
      calls.testKey.push(company);
      return { ok: true, message: "The key works." };
    },
    openKeyPage: async (company) => {
      calls.keyPages.push(company);
      return { status: "opened" };
    },
    chooseFolder: async () => null,
    chooseApp: async () => null,
    takeNotices: async () => [],
    ackNotices: async () => {},
    voiceStatus: async () => ({ model: "ready", received: 0, total: 44_243_206 }),
    downloadVoice: async () => ({ status: "done" }),
    cancelVoiceDownload: async () => {},
    transcribe: async () => ({ ok: true, text: "" }),
    runnerStatus: async () => ({
      state: "ready",
      model: settings.local.model,
      downloaded: { standard: false, smaller: false },
    }),
    pullModel: async (choice) => {
      calls.pulls.push(choice);
      return { status: "done", skills: "yes" };
    },
    pullStatus: async () => ({ downloading: false, completed: 0, total: 0 }),
    cancelPull: async () => {
      calls.cancelPull++;
      return "cancelled";
    },
    openInstallGuide: async () => {
      calls.openGuide++;
      return { status: "opened" };
    },
    finishSetup: async () => {
      calls.finishSetup++;
      settings.setupDone = true;
      return { ok: true };
    },
    onAsking: (listener) => {
      askingListeners.push(listener);
    },
    setSound: async (on) => {
      calls.sound.push(on);
      settings.sound = on;
      return { ok: true };
    },
    homeSummary: async () => {
      calls.homeSummary++;
      return structuredClone(options.summary ?? EMPTY_HOME);
    },
    claimMorningBrief: async () => {
      calls.claims++;
      return false;
    },
    ...overrides,
  };
  const elements = installFakeDom(ids, api);
  const media = installFakeMedia();
  options.before?.(media);
  t.after(() => {
    removeFakeDom();
    removeFakeMedia();
  });
  // The script is loaded once; each test starts a fresh window on its own fake DOM.
  startChatWindow();
  await settled();
  const el = (id: string) => elements.get(id)!;
  const texts = () => el("messages").children.map((item) => item.textContent);
  /** The main process's news about its asking box, as the preload hands it to the window. */
  const emitAsking = (event: AskingEvent) => {
    for (const listener of askingListeners) listener(event);
  };
  return { el, texts, calls, media, emitAsking };
}
