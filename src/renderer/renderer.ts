import { MAX_ACK_IDS, type PublicAppEntry, type PublicSettings, type SageApi } from "../shared/api.js";
import { createVoiceControls } from "./voice-controls.js";
import { createWelcome } from "./welcome.js";

// The chat window. It runs sandboxed with no Node access; `window.sage` (from the preload) is its
// only way to reach the rest of Sage. Text is always inserted with textContent, never as HTML.

declare global {
  interface Window {
    sage: SageApi;
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

const sage = window.sage;
let settings: PublicSettings | null = null;

// --- Chat ---

const messages = byId<HTMLOListElement>("messages");
const composer = byId<HTMLFormElement>("composer");
const input = byId<HTMLTextAreaElement>("input");
const sendButton = byId<HTMLButtonElement>("send");

function addMessage(role: "user" | "assistant" | "notice", text: string, pending = false): HTMLLIElement {
  const item = document.createElement("li");
  item.className = `message ${role}${pending ? " pending" : ""}`;
  item.textContent = text;
  messages.append(item);
  item.scrollIntoView({ block: "end" });
  return item;
}

// Goes up on New chat. A reply that arrives for an older chat is ignored: it must not write into
// the new chat or change the Send button, which belongs to the new chat now.
let chatGeneration = 0;

async function submit(): Promise<void> {
  // Enter also submits, so the busy check can't rely on the disabled button alone.
  if (sendButton.disabled) return;
  const text = input.value.trim();
  if (!text) return;
  const generation = chatGeneration;
  // A voice message: some of its words came from talking, even if they were edited afterwards.
  const fromVoice = voice.takeFromVoice();
  input.value = "";
  addMessage("user", text);
  const pending = addMessage("assistant", "Thinking…", true);
  sendButton.disabled = true;
  let reply: string;
  let answered = false;
  try {
    reply = await sage.send(text);
    answered = true;
  } catch {
    reply = "Something went wrong. Try again.";
  }
  if (generation !== chatGeneration) return;
  pending.textContent = reply;
  pending.classList.remove("pending");
  sendButton.disabled = false;
  input.focus();
  // Only Sage's final reply is read aloud; never notices.
  if (answered) voice.replied(reply, fromVoice, settings?.speakReplies ?? "voice");
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  void submit();
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    // Only a fresh press sends: not a held key repeating, and not while the key that started a
    // recording is still down (holding Enter on Talk can end with the focus here).
    if (event.repeat || voice.holdingTalkKey()) return;
    void submit();
  }
});
byId<HTMLButtonElement>("new-chat").addEventListener("click", () => {
  // The microphone closes, speech stops, and a recording still being worked out is dropped.
  voice.reset();
  // The old chat's pending reply is abandoned at once; Send comes back when Sage has reset.
  chatGeneration++;
  const generation = chatGeneration;
  messages.replaceChildren();
  sendButton.disabled = true;
  void sage
    .resetChat()
    .catch(() => undefined)
    .then(() => {
      if (generation !== chatGeneration) return;
      sendButton.disabled = false;
      input.focus();
    });
});

// --- Voice ---

const chatView = byId<HTMLElement>("view-chat");

// The logic is in voice-controls.ts; this only finds the elements.
const voice = createVoiceControls(
  sage,
  {
    chatView,
    input,
    talkButton: byId<HTMLButtonElement>("talk"),
    voiceStatus: byId<HTMLSpanElement>("voice-status"),
    voiceDownload: byId<HTMLButtonElement>("voice-download"),
    voiceCancel: byId<HTMLButtonElement>("voice-cancel"),
    stopSpeaking: byId<HTMLButtonElement>("stop-speaking"),
    voiceNote: byId<HTMLParagraphElement>("voice-note"),
  },
  typeof speechSynthesis === "undefined" ? undefined : speechSynthesis,
);

// --- Tabs ---

const tabBar = byId<HTMLElement>("tabs");
const tabs = { chat: byId<HTMLButtonElement>("tab-chat"), settings: byId<HTMLButtonElement>("tab-settings") };
const views = {
  chat: chatView,
  settings: byId<HTMLElement>("view-settings"),
  welcome: byId<HTMLElement>("view-welcome"),
};

// All three views start hidden; the first one is chosen once the settings have loaded.
function show(view: "chat" | "settings" | "welcome"): void {
  for (const name of ["chat", "settings", "welcome"] as const) views[name].hidden = name !== view;
  // The Welcome screen has no tab: it is left with Skip setup, Start chatting or the online choice.
  tabBar.hidden = view === "welcome";
  for (const name of ["chat", "settings"] as const) {
    tabs[name].classList.toggle("active", name === view);
    tabs[name].setAttribute("aria-pressed", String(name === view));
  }
  // The form isn't reloaded here: unsaved changes stay when switching tabs. Settings are loaded at
  // startup and again after each successful save.
}
/** Every way into Chat goes through here, so held notices are confirmed once they can be seen. */
function openChat(): void {
  show("chat");
  void confirmShown();
}
tabs.chat.addEventListener("click", () => openChat());
tabs.settings.addEventListener("click", () => show("settings"));

// --- Notices ---

// Messages from Sage itself: reminders that couldn't be shown as desktop notifications, and data
// files that had to be set aside. Collected on load and every few seconds and added to the chat.
// Sage hands a notice out again until the window confirms it, so ids already in the chat are
// skipped. A notice is confirmed only once the user can actually see it: the Chat view is open and
// the window isn't hidden or minimised. Until then the confirmation is held, so a reminder that
// arrives while Settings is open still comes back if Sage closes before Chat is opened.
//
// While a notice is held, each collection is the source of truth: a held notice that Sage no
// longer hands out (its reminder was deleted, say) is taken out of the chat before anyone sees it.
// A notice already confirmed is never taken out.
const NOTICE_POLL_MS = 5_000;
const shownNotices = new Set<string>();
/** In the chat but not yet confirmed to Sage, with the chat line that shows each one. */
const held = new Map<string, HTMLLIElement>();
/** Held notices whose confirmation is on its way; Sage may already have stopped handing them out. */
const confirming = new Set<string>();

function chatVisible(): boolean {
  return !views.chat.hidden && document.visibilityState !== "hidden";
}

async function confirmShown(): Promise<void> {
  if (!chatVisible()) return;
  const ids = [...held.keys()].filter((id) => !confirming.has(id));
  for (let start = 0; start < ids.length; start += MAX_ACK_IDS) {
    const batch = ids.slice(start, start + MAX_ACK_IDS);
    for (const id of batch) confirming.add(id);
    try {
      await sage.ackNotices(batch);
      for (const id of batch) held.delete(id);
    } catch {
      // Still held, for the next try; Sage hands the notice out again meanwhile.
      return;
    } finally {
      for (const id of batch) confirming.delete(id);
    }
  }
}

async function collectNotices(): Promise<void> {
  try {
    const notices = await sage.takeNotices();
    const current = new Set(notices.map((notice) => notice.id));
    for (const [id, item] of held) {
      if (current.has(id) || confirming.has(id)) continue;
      // Withdrawn by Sage before it was seen.
      item.remove();
      held.delete(id);
      shownNotices.delete(id);
    }
    for (const notice of notices) {
      if (shownNotices.has(notice.id)) continue;
      held.set(notice.id, addMessage("notice", notice.text));
      shownNotices.add(notice.id);
    }
  } catch {
    // The next poll tries again.
  }
  await confirmShown();
}

document.addEventListener("visibilitychange", () => void confirmShown());

/** Started once the first view is chosen, so nothing is confirmed before it is on screen. */
function startNotices(): void {
  void collectNotices();
  setInterval(() => void collectNotices(), NOTICE_POLL_MS);
}

// --- Settings ---

const form = byId<HTMLFormElement>("settings-form");
const localModel = byId<HTMLInputElement>("local-model");
const onlineUrl = byId<HTMLInputElement>("online-url");
const onlineModel = byId<HTMLInputElement>("online-model");
const keyInput = byId<HTMLInputElement>("online-key");
const keyStatus = byId<HTMLParagraphElement>("key-status");
const appsList = byId<HTMLUListElement>("apps");
const foldersList = byId<HTMLUListElement>("folders");
const settingsStatus = byId<HTMLSpanElement>("settings-status");
const brainStatus = byId<HTMLSpanElement>("brain-status");
const speakReplies = byId<HTMLSelectElement>("speak-replies");

function describeBrain(current: PublicSettings): string {
  return current.brain === "local"
    ? `Brain: on this computer (${current.local.model})`
    : `Brain: online (${current.online.model || "no model chosen"})`;
}

function removable(list: HTMLUListElement, label: string, onRemove: () => void): void {
  const item = document.createElement("li");
  const text = document.createElement("span");
  text.textContent = label;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Remove";
  button.addEventListener("click", onRemove);
  item.append(text, button);
  list.append(item);
}

function renderLists(): void {
  if (!settings) return;
  const current = settings;
  appsList.replaceChildren();
  current.apps.forEach((app: PublicAppEntry, index) => {
    removable(appsList, `${app.name}: ${app.path}`, () => {
      current.apps.splice(index, 1);
      renderLists();
    });
  });
  foldersList.replaceChildren();
  current.folders.forEach((folder, index) => {
    removable(foldersList, folder, () => {
      current.folders.splice(index, 1);
      renderLists();
    });
  });
}

function render(): void {
  if (!settings) return;
  for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="brain"]')) {
    radio.checked = radio.value === settings.brain;
  }
  localModel.value = settings.local.model;
  onlineUrl.value = settings.online.baseUrl;
  onlineModel.value = settings.online.model;
  speakReplies.value = settings.speakReplies;
  renderKeyStatus();
  brainStatus.textContent = describeBrain(settings);
  renderLists();
}

function renderKeyStatus(): void {
  if (!settings) return;
  keyStatus.textContent = settings.online.hasKey
    ? "A key is saved, encrypted by your system. It is never shown again."
    : "No key saved.";
}

async function loadSettings(): Promise<void> {
  settings = await sage.getSettings();
  render();
}

/** After saving or removing the key: updates only the key line, so unsaved form changes stay. */
async function refreshKeyStatus(): Promise<void> {
  const latest = await sage.getSettings();
  if (!settings) return;
  settings.online.hasKey = latest.online.hasKey;
  renderKeyStatus();
}

function readSpeakReplies(): PublicSettings["speakReplies"] {
  const value = speakReplies.value;
  return value === "always" || value === "never" ? value : "voice";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!settings) return;
  const brain =
    form.querySelector<HTMLInputElement>('input[name="brain"]:checked')?.value === "online"
      ? "online"
      : "local";
  void sage
    .saveSettings({
      brain,
      local: { model: localModel.value.trim() },
      online: { baseUrl: onlineUrl.value.trim(), model: onlineModel.value.trim() },
      apps: settings.apps,
      folders: settings.folders,
      speakReplies: readSpeakReplies(),
    })
    .then(async (result) => {
      if (!result.ok) {
        settingsStatus.textContent = `Not saved: ${result.message}`;
        return;
      }
      settingsStatus.textContent = result.message ? `Saved. ${result.message}` : "Saved.";
      await loadSettings();
    });
});

byId<HTMLButtonElement>("save-key").addEventListener("click", () => {
  const key = keyInput.value;
  keyInput.value = "";
  if (!key.trim()) return;
  // The address on screen goes with the key; the main process refuses it if that address isn't
  // saved yet, so a key is never tied to the wrong service.
  void sage.setKey(key, onlineUrl.value).then(async (result) => {
    settingsStatus.textContent = result.ok ? "Key saved." : `Key not saved: ${result.message}`;
    await refreshKeyStatus();
  });
});

byId<HTMLButtonElement>("clear-key").addEventListener("click", () => {
  void sage.clearKey().then(async () => {
    settingsStatus.textContent = "Key removed.";
    await refreshKeyStatus();
  });
});

const appName = byId<HTMLInputElement>("app-name");
const appPath = byId<HTMLInputElement>("app-path");
byId<HTMLButtonElement>("browse-app").addEventListener("click", () => {
  void sage.chooseApp().then((path) => {
    if (path) appPath.value = path;
  });
});
byId<HTMLButtonElement>("add-app").addEventListener("click", () => {
  if (!settings || !appName.value.trim() || !appPath.value.trim()) return;
  settings.apps.push({ name: appName.value.trim(), path: appPath.value.trim(), args: [] });
  appName.value = "";
  appPath.value = "";
  settingsStatus.textContent = "Not saved yet: choose Save settings.";
  renderLists();
});

const folderPath = byId<HTMLInputElement>("folder-path");
byId<HTMLButtonElement>("browse-folder").addEventListener("click", () => {
  void sage.chooseFolder().then((path) => {
    if (path) folderPath.value = path;
  });
});
byId<HTMLButtonElement>("add-folder").addEventListener("click", () => {
  if (!settings || !folderPath.value.trim()) return;
  settings.folders.push(folderPath.value.trim());
  folderPath.value = "";
  settingsStatus.textContent = "Not saved yet: choose Save settings.";
  renderLists();
});

// --- Welcome ---

// The logic is in welcome.ts; this only finds the elements.
const welcome = createWelcome(
  sage,
  {
    skip: byId<HTMLButtonElement>("welcome-skip"),
    status: byId<HTMLParagraphElement>("welcome-status"),
    steps: {
      place: byId<HTMLElement>("step-place"),
      runner: byId<HTMLElement>("step-runner"),
      model: byId<HTMLElement>("step-model"),
      done: byId<HTMLElement>("step-done"),
    },
    headings: {
      place: byId<HTMLElement>("step-place-heading"),
      runner: byId<HTMLElement>("step-runner-heading"),
      model: byId<HTMLElement>("step-model-heading"),
      done: byId<HTMLElement>("step-done-heading"),
    },
    placeLocal: byId<HTMLButtonElement>("place-local"),
    placeOnline: byId<HTMLButtonElement>("place-online"),
    runnerStatus: byId<HTMLParagraphElement>("runner-status"),
    runnerInstall: byId<HTMLDivElement>("runner-install"),
    runnerCheck: byId<HTMLButtonElement>("runner-check"),
    runnerNext: byId<HTMLButtonElement>("runner-next"),
    openGuide: byId<HTMLButtonElement>("open-guide"),
    guideStatus: byId<HTMLParagraphElement>("guide-status"),
    guideAddress: byId<HTMLParagraphElement>("guide-address"),
    modelStandard: byId<HTMLInputElement>("model-standard"),
    modelSmaller: byId<HTMLInputElement>("model-smaller"),
    standardMark: byId<HTMLSpanElement>("model-standard-mark"),
    smallerMark: byId<HTMLSpanElement>("model-smaller-mark"),
    modelDownload: byId<HTMLButtonElement>("model-download"),
    modelCancel: byId<HTMLButtonElement>("model-cancel"),
    modelProgress: byId<HTMLProgressElement>("model-progress"),
    modelStatus: byId<HTMLParagraphElement>("model-status"),
    modelSkills: byId<HTMLParagraphElement>("model-skills"),
    modelNext: byId<HTMLButtonElement>("model-next"),
    doneSummary: byId<HTMLParagraphElement>("done-summary"),
    doneVoice: byId<HTMLParagraphElement>("done-voice"),
    startChatting: byId<HTMLButtonElement>("start-chatting"),
  },
  {
    leave: (to) => {
      // What the form shows now; the refresh below changes a field only if it still shows this.
      const shown = { brain: checkedBrain(), model: localModel.value };
      if (to === "chat") {
        openChat();
        input.focus();
      } else {
        show("settings");
        // Picked in the form, unsaved, for the user to fill in and save.
        setBrainRadios("online");
        settingsStatus.textContent = ONLINE_HINT;
      }
      void refreshAfterSetup(shown);
    },
  },
);

function openWelcome(): void {
  show("welcome");
  welcome.open();
}
byId<HTMLButtonElement>("setup-again").addEventListener("click", () => openWelcome());

const ONLINE_HINT =
  "Enter the online service's address and model, choose Save settings, then paste the key and choose Save key.";

function checkedBrain(): string | undefined {
  return form.querySelector<HTMLInputElement>('input[name="brain"]:checked')?.value;
}

function setBrainRadios(brain: string): void {
  for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="brain"]')) {
    radio.checked = radio.value === brain;
  }
}

/**
 * After the Welcome screen: only what it actually saved (the local model, and the brain when a
 * download switched it to local) is updated. A form field is changed only if it still shows what
 * it showed when the Welcome screen closed, so edits made since (or other unsaved changes) stay.
 */
async function refreshAfterSetup(shown: { brain: string | undefined; model: string }): Promise<void> {
  let latest: PublicSettings;
  try {
    latest = await sage.getSettings();
  } catch {
    return;
  }
  if (!settings) {
    settings = latest;
    render();
    return;
  }
  settings.setupDone = latest.setupDone;
  if (latest.local.model !== settings.local.model) {
    settings.local.model = latest.local.model;
    if (localModel.value === shown.model) localModel.value = latest.local.model;
  }
  if (latest.brain !== settings.brain) {
    settings.brain = latest.brain;
    if (checkedBrain() === shown.brain) setBrainRadios(latest.brain);
  }
  brainStatus.textContent = describeBrain(settings);
}

// The first view: the Welcome screen until setup is finished or skipped, otherwise Chat. If the
// settings can't be read, Chat opens.
void loadSettings()
  .then(
    () => (settings?.setupDone === false ? openWelcome() : openChat()),
    () => openChat(),
  )
  .then(startNotices);
input.focus();
