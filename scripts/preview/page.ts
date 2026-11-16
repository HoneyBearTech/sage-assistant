import type { AskingEvent, HomeSummary, PublicSettings, SageApi } from "../../src/shared/api.js";

// The preview page's own script (review only, never part of Sage). It runs before the real window
// script and stands in for the main process: a fake window.sage with sample settings, a short
// sample chat (a notice, replies that type themselves out, asking cards), sample reminders and notes
// for Home, and a control strip to switch the view, the theme, the orb's state, the sound and
// Home's sample data. Nothing here touches the network.

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const settings: PublicSettings = {
  brain: "local",
  local: { model: "qwen3:4b" },
  online: { baseUrl: "", model: "" },
  services: {
    claude: { model: "claude-sonnet-5-5" },
    openai: { model: "gpt-6-astra" },
    gemini: { model: "gemini-3.8-flash" },
  },
  keys: { claude: true, openai: false, gemini: false, other: false },
  apps: [{ name: "Notepad", path: "C:\\Windows\\notepad.exe", args: [] }],
  folders: ["D:\\Shared\\Documents"],
  speakReplies: "never",
  setupDone: true,
  theme: "dark",
  sound: false,
  morningBrief: false,
};

// --- Home's sample data: made up for the preview, relative to the time the page is opened ---

/** Today at this hour and minute, as an ISO time. */
function todayAt(hour: number, minute = 0): string {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

/** That many days from today, at this hour, as an ISO time. */
function dayAt(days: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

const SAMPLE_HOME: HomeSummary = {
  reminders: [
    { id: "r1", text: "Pay the electricity bill", due: dayAt(-1, 18), missed: true },
    { id: "r2", text: "Water the plants", due: todayAt(0, 30), missed: true },
    { id: "r3", text: "Dentist appointment", due: todayAt(23, 15), missed: false },
    { id: "r4", text: "Call Sam about the weekend", due: todayAt(23, 45), missed: false },
  ],
  missedMore: 2,
  next: null,
  notes: ["Shopping list", "Ideas for the garden", "Holiday packing", "Book recommendations", "Wi-Fi setup"],
  status: { brain: "local", voiceReady: false, sound: false },
};

const EMPTY_HOME: HomeSummary = {
  reminders: [],
  missedMore: 0,
  next: { id: "r9", text: "Renew the passport", due: dayAt(3, 10), missed: false },
  notes: [],
  status: { brain: "claude", voiceReady: true, sound: false },
};

let homeSample: HomeSummary = SAMPLE_HOME;

const askingListeners: ((event: AskingEvent) => void)[] = [];
let askCount = 0;
/** The sample's open question, waiting for the strip's Allow or Don't allow. */
let pendingAnswer: ((allowed: boolean) => void) | null = null;

function ask(text: string): Promise<boolean> {
  askCount += 1;
  const id = `ask-${askCount}`;
  for (const listener of askingListeners) listener({ id, state: "open", text });
  return new Promise((resolve) => {
    pendingAnswer = (allowed) => {
      pendingAnswer = null;
      for (const listener of askingListeners) listener({ id, state: "closed", allowed });
      resolve(allowed);
    };
  });
}

/** Sample answers, by what was typed. */
async function reply(text: string): Promise<string> {
  await wait(900);
  const lower = text.toLowerCase();
  if (lower.includes("budget")) {
    const allowed = await ask(
      'Open the file "Budget 2026.xlsx" in "D:\\Shared\\Documents" with its default app.',
    );
    return allowed ? "Done: Budget 2026.xlsx is open." : "Okay, I haven't opened it.";
  }
  if (lower.includes("shopping")) {
    const allowed = await ask('Delete the note "Shopping (old)". This can\'t be undone.');
    return allowed ? "Deleted the note." : "Okay, I've left the note where it is.";
  }
  if (lower.includes("notepad")) {
    const allowed = await ask('Open the app "Notepad" ("C:\\Windows\\notepad.exe").');
    return allowed ? "Notepad is open." : "Okay, I won't open it.";
  }
  if (lower.includes("today")) {
    return "Two things today: the dentist at 14:30, and the plants need water. Shall I set a reminder for the plants at 18:00?";
  }
  return "Here is a longer reply, so you can watch it type itself out. It never takes more than a little over a second, and any click or key shows all of it at once.";
}

const sage: SageApi = {
  send: (text) => reply(text),
  resetChat: async () => {},
  getSettings: async () => structuredClone(settings),
  saveSettings: async (input) => {
    Object.assign(settings, input);
    return { ok: true };
  },
  setKey: async () => ({ ok: false, message: "The preview has no key store." }),
  clearKey: async () => ({ ok: true }),
  listModels: async (company) => ({
    ok: true,
    models:
      company === "claude"
        ? ["claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]
        : company === "openai"
          ? ["gpt-6-astra", "gpt-6-luna"]
          : ["gemini-3.6-flash", "gemini-3.8-flash"],
  }),
  testKey: async () => ({ ok: false, message: "The preview has no key store, so there is no key to test." }),
  openKeyPage: async () => ({ status: "declined" }),
  chooseFolder: async () => null,
  chooseApp: async () => null,
  takeNotices: async () => [{ id: "n1", text: "Sage reminder: Water the plants (due 09:00)." }],
  ackNotices: async () => {},
  voiceStatus: async () => ({ model: "missing", received: 0, total: 44_243_206 }),
  downloadVoice: async () => ({ status: "declined" }),
  cancelVoiceDownload: async () => {},
  transcribe: async () => ({ ok: false, message: "The preview has no microphone." }),
  runnerStatus: async () => ({
    state: "no-model",
    model: settings.local.model,
    downloaded: { standard: false, smaller: true },
  }),
  pullModel: async () => ({ status: "declined" }),
  pullStatus: async () => ({ downloading: false, completed: 0, total: 0 }),
  cancelPull: async () => "idle",
  openInstallGuide: async () => ({ status: "declined" }),
  finishSetup: async () => ({ ok: true }),
  setSound: async (on) => {
    settings.sound = on;
    return { ok: true };
  },
  homeSummary: async () => ({
    ...structuredClone(homeSample),
    status: { ...homeSample.status, sound: settings.sound },
  }),
  // The preview never shows the morning brief by itself; Brief me on Home shows the same brief.
  claimMorningBrief: async () => false,
  onAsking: (listener) => {
    askingListeners.push(listener);
  },
};

(window as unknown as { sage: SageApi }).sage = sage;

// --- The sample chat, played once the window has started ---

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

async function say(text: string): Promise<void> {
  const input = element<HTMLTextAreaElement>("input");
  const send = element<HTMLButtonElement>("send");
  while (send.disabled) await wait(100);
  input.value = text;
  element<HTMLFormElement>("composer").requestSubmit();
  await wait(50);
  while (send.disabled) await wait(100);
}

async function sampleChat(): Promise<void> {
  // Sage opens on Home; the sample chat plays in Chat behind it (the strip's Chat shows it).
  await wait(400);
  await say("What's on my list for today?");
  await wait(1_600);
  const budget = say("Open the budget spreadsheet, please.");
  await wait(2_400);
  pendingAnswer?.(true);
  await budget;
  await wait(1_400);
  const shopping = say("Delete my old shopping note.");
  await wait(2_200);
  pendingAnswer?.(false);
  await shopping;
  await wait(1_400);
  // The last one stays open: the strip's Allow and Don't allow stand in for the system box.
  void say("Open Notepad.");
}

// --- The control strip ---

type Control = { label: string; run: () => void; group: string; value?: string };

/** Both drawings of the orb, the chat's and Home's. */
function setOrb(state: string, caption: string): void {
  for (const id of ["orb", "home-orb"]) {
    element(id).setAttribute("data-state", state);
    element(`${id}-state`).textContent = caption;
  }
}

function showView(view: "home" | "chat" | "settings" | "welcome"): void {
  const welcomeOpen = !element("view-welcome").hidden;
  if (view === "welcome") {
    if (welcomeOpen) return;
    element("tab-settings").click();
    element("setup-again").click();
  } else if (welcomeOpen) {
    element("welcome-skip").click();
    if (view !== "chat") setTimeout(() => element(`tab-${view}`).click(), 50);
  } else {
    element(`tab-${view}`).click();
  }
}

/** Switches Home's sample data and shows Home with it. */
function homeData(sample: HomeSummary): void {
  homeSample = sample;
  // Home loads each time it is shown; clicking its tab while it is open does nothing, so go by Chat.
  showView("home");
  element("tab-chat").click();
  element("tab-home").click();
}

const controls: Control[] = [
  { group: "View", label: "Home", run: () => showView("home") },
  { group: "View", label: "Chat", run: () => showView("chat") },
  { group: "View", label: "Settings", run: () => showView("settings") },
  { group: "View", label: "Welcome", run: () => showView("welcome") },
  { group: "Theme", label: "Dark", run: () => document.documentElement.setAttribute("data-theme", "dark") },
  { group: "Theme", label: "Light", run: () => document.documentElement.setAttribute("data-theme", "light") },
  { group: "Orb", label: "Ready", run: () => setOrb("idle", "Ready") },
  { group: "Orb", label: "Listening", run: () => setOrb("listening", "Listening") },
  { group: "Orb", label: "Thinking", run: () => setOrb("thinking", "Thinking") },
  { group: "Orb", label: "Speaking", run: () => setOrb("speaking", "Speaking") },
  { group: "Sound", label: "On / off", run: () => element("sound-toggle").click() },
  { group: "System box (stand-in)", label: "Allow", run: () => pendingAnswer?.(true) },
  { group: "System box (stand-in)", label: "Don't allow", run: () => pendingAnswer?.(false) },
  { group: "Chat", label: "Type a reply", run: () => void say("Show me a longer reply.") },
  { group: "Home", label: "Sample data", run: () => homeData(SAMPLE_HOME) },
  { group: "Home", label: "Empty", run: () => homeData(EMPTY_HOME) },
];

function buildStrip(): void {
  const strip = document.createElement("nav");
  strip.className = "preview-strip";
  strip.setAttribute("aria-label", "Preview controls (not part of Sage)");
  const title = document.createElement("span");
  title.className = "preview-title";
  title.textContent = "Preview";
  strip.append(title);
  const groups = new Map<string, HTMLElement>();
  for (const control of controls) {
    let group = groups.get(control.group);
    if (!group) {
      group = document.createElement("span");
      group.className = "preview-group";
      const name = document.createElement("span");
      name.className = "preview-group-name";
      name.textContent = control.group;
      group.append(name);
      groups.set(control.group, group);
      strip.append(group);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = control.label;
    button.addEventListener("click", control.run);
    group.append(button);
  }
  document.body.append(strip);
}

document.addEventListener("DOMContentLoaded", () => {
  buildStrip();
  void sampleChat();
});
