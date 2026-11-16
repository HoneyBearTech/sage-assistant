import { readFile } from "node:fs/promises";
import type { TestContext } from "node:test";
import type { PublicSettings, SageApi } from "../src/shared/api.js";
import { installFakeDom, removeFakeDom } from "./fake-dom.js";
import { type FakeMedia, installFakeMedia, removeFakeMedia } from "./fake-media.js";
import { settled } from "./helpers.js";

const source = await readFile(new URL("../src/renderer/renderer.ts", import.meta.url), "utf8");

// The real window script, run against a small fake DOM (test/fake-dom.ts) and a fake window.sage.
const ids = [...source.matchAll(/byId<\w+>\("([\w-]+)"\)/g)].map((match) => match[1]!);
let loads = 0;

export interface WindowOptions {
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
  };
  const settings: PublicSettings = {
    brain: "local",
    local: { model: "small-model" },
    online: { baseUrl: "", model: "", hasKey: false },
    apps: [],
    folders: [],
    speakReplies: "voice",
    // Existing window tests start as "already set up"; the Welcome screen's tests say otherwise.
    setupDone: true,
    ...options.settings,
  };
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
    setKey: async () => {
      settings.online.hasKey = true;
      return { ok: true };
    },
    clearKey: async () => ({ ok: true }),
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
    ...overrides,
  };
  const elements = installFakeDom(ids, api);
  const media = installFakeMedia();
  options.before?.(media);
  t.after(() => {
    removeFakeDom();
    removeFakeMedia();
  });
  // A fresh copy of the script for each test.
  await import(`../src/renderer/renderer.ts?window=${++loads}`);
  await settled();
  const el = (id: string) => elements.get(id)!;
  const texts = () => el("messages").children.map((item) => item.textContent);
  return { el, texts, calls, media };
}
