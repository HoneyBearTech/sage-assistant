import type { PublicAppEntry, PublicSettings, SageApi } from "../shared/api.js";

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

async function submit(): Promise<void> {
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  addMessage("user", text);
  const pending = addMessage("assistant", "Thinking…", true);
  sendButton.disabled = true;
  try {
    pending.textContent = await sage.send(text);
  } catch {
    pending.textContent = "Something went wrong. Try again.";
  } finally {
    pending.classList.remove("pending");
    sendButton.disabled = false;
    input.focus();
  }
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  void submit();
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void submit();
  }
});
byId<HTMLButtonElement>("new-chat").addEventListener("click", () => {
  void sage.resetChat().then(() => messages.replaceChildren());
});

// Messages from Sage itself: reminders that couldn't be shown as desktop notifications, and data
// files that had to be set aside. Collected on load and every few seconds.
const NOTICE_POLL_MS = 5_000;
async function collectNotices(): Promise<void> {
  try {
    for (const notice of await sage.takeNotices()) addMessage("notice", notice);
  } catch {
    // The next poll tries again.
  }
}
void collectNotices();
setInterval(() => void collectNotices(), NOTICE_POLL_MS);

// --- Tabs ---

const tabs = { chat: byId<HTMLButtonElement>("tab-chat"), settings: byId<HTMLButtonElement>("tab-settings") };
const views = { chat: byId<HTMLElement>("view-chat"), settings: byId<HTMLElement>("view-settings") };

function show(view: "chat" | "settings"): void {
  for (const name of ["chat", "settings"] as const) {
    views[name].hidden = name !== view;
    tabs[name].classList.toggle("active", name === view);
    tabs[name].setAttribute("aria-pressed", String(name === view));
  }
  // The form isn't reloaded here: unsaved changes stay when switching tabs. Settings are loaded at
  // startup and again after each successful save.
}
tabs.chat.addEventListener("click", () => show("chat"));
tabs.settings.addEventListener("click", () => show("settings"));

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
  void sage.setKey(key).then(async (result) => {
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

void loadSettings();
input.focus();
