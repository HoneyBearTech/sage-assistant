import {
  BRAIN_LABELS,
  type BrainChoice,
  BRAINS,
  type Company,
  COMPANIES,
  MAX_ACK_IDS,
  type PublicAppEntry,
  type PublicSettings,
  privacyLine,
  type SageApi,
} from "../shared/api.js";
import { createAskingCards } from "./asking-cards.js";
import { createHome } from "./home.js";
import { applyTheme, prefersReducedMotion, toTheme } from "./look.js";
import { createOrb } from "./orb.js";
import { createSounds } from "./sounds.js";
import { createTypist } from "./typing.js";
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

/** Starts the chat window: finds its elements, wires them up and loads the first view. */
export function startChatWindow(): void {
  const sage = window.sage;
  let settings: PublicSettings | null = null;

  // --- Chat ---

  const messages = byId<HTMLOListElement>("messages");
  const composer = byId<HTMLFormElement>("composer");
  const input = byId<HTMLTextAreaElement>("input");
  const sendButton = byId<HTMLButtonElement>("send");
  // Sage's presence: resting, listening, thinking or speaking. One state, drawn twice: above the
  // message box, and large on Home.
  const orb = createOrb([
    { orb: byId<HTMLDivElement>("orb"), caption: byId<HTMLParagraphElement>("orb-state") },
    { orb: byId<HTMLDivElement>("home-orb"), caption: byId<HTMLParagraphElement>("home-orb-state") },
  ]);
  // The newest reply types itself out; a click or a key shows it at once.
  const typist = createTypist(prefersReducedMotion);
  // Sound effects: off unless the top bar's switch is on; no audio is made until the first sound.
  const sounds = createSounds(() => (typeof AudioContext === "function" ? new AudioContext() : undefined));
  // While Sage's own box asks before an action: an amber card in the chat with the same question,
  // then the answer. Only news; the box is answered in the box.
  const asking = createAskingCards(messages);
  sage.onAsking((event) => {
    const change = asking.handle(event);
    if (change === "opened") sounds.play("asking");
    else if (change === "allowed") sounds.play("allowed");
  });

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
    sounds.play("send");
    const pending = addMessage("assistant", "Thinking…", true);
    sendButton.disabled = true;
    orb.update({ thinking: true });
    let reply: string;
    let answered = false;
    try {
      reply = await sage.send(text);
      answered = true;
    } catch {
      reply = "Something went wrong. Try again.";
    }
    if (generation !== chatGeneration) return;
    orb.update({ thinking: false });
    pending.textContent = reply;
    pending.classList.remove("pending");
    if (answered) typist.type(pending, reply);
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
    orb.update({ thinking: false });
    typist.finish();
    asking.clear();
    messages.replaceChildren();
    forgetHeldNotices();
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
      briefStop: byId<HTMLButtonElement>("home-stop-speaking"),
      voiceNote: byId<HTMLParagraphElement>("voice-note"),
    },
    typeof speechSynthesis === "undefined" ? undefined : speechSynthesis,
    (change) => orb.update(change),
  );

  // --- Tabs ---

  const tabBar = byId<HTMLElement>("tabs");
  const tabs = {
    home: byId<HTMLButtonElement>("tab-home"),
    chat: byId<HTMLButtonElement>("tab-chat"),
    settings: byId<HTMLButtonElement>("tab-settings"),
  };
  const homeView = byId<HTMLElement>("view-home");
  const views = {
    home: homeView,
    chat: chatView,
    settings: byId<HTMLElement>("view-settings"),
    welcome: byId<HTMLElement>("view-welcome"),
  };
  const TABBED = ["home", "chat", "settings"] as const;

  // All four views start hidden; the first one is chosen once the settings have loaded.
  function show(view: "home" | "chat" | "settings" | "welcome"): void {
    const wasHome = !homeView.hidden;
    for (const name of ["home", "chat", "settings", "welcome"] as const) views[name].hidden = name !== view;
    // The Welcome screen has no tab: it is left with Skip setup, Start chatting or the online choice.
    tabBar.hidden = view === "welcome";
    for (const name of TABBED) {
      tabs[name].classList.toggle("active", name === view);
      tabs[name].setAttribute("aria-pressed", String(name === view));
    }
    if (view === "home") home.shown();
    else if (wasHome) home.hidden();
    // The form isn't reloaded here: unsaved changes stay when switching tabs. Settings are loaded at
    // startup and again after each successful save.
  }
  /** Every way into Chat goes through here, so held notices are confirmed once they can be seen. */
  function openChat(): void {
    show("chat");
    void collectNotices();
  }
  tabs.home.addEventListener("click", () => show("home"));
  tabs.chat.addEventListener("click", () => openChat());
  tabs.settings.addEventListener("click", () => show("settings"));

  // --- Home ---

  // The logic is in home.ts; this only finds the elements.
  const home = createHome(
    sage,
    {
      view: homeView,
      clock: byId<HTMLParagraphElement>("home-clock"),
      greeting: byId<HTMLElement>("home-greeting"),
      today: byId<HTMLUListElement>("home-today"),
      notes: byId<HTMLUListElement>("home-notes"),
      brain: byId<HTMLElement>("home-brain"),
      voice: byId<HTMLElement>("home-voice"),
      sound: byId<HTMLElement>("home-sound"),
      next: byId<HTMLElement>("home-next"),
      status: byId<HTMLParagraphElement>("home-status"),
      talk: byId<HTMLButtonElement>("home-talk"),
      briefMe: byId<HTMLButtonElement>("home-brief"),
      briefPanel: byId<HTMLElement>("home-brief-panel"),
      briefText: byId<HTMLParagraphElement>("home-brief-text"),
    },
    {
      talk: () => {
        openChat();
        input.focus();
      },
      settings: () => settings,
      speak: (text) => voice.speakBrief(text),
      stopSpeaking: () => voice.stopBrief(),
      typist,
    },
  );

  // --- Sound switch ---

  const soundSwitch = byId<HTMLButtonElement>("sound-toggle");
  /**
   * Goes up whenever the switch changes here. A settings read that started before is older than
   * what the switch shows, so it doesn't change the switch (it would undo a mute).
   */
  let soundChanges = 0;

  function showSound(on: boolean): void {
    sounds.setOn(on);
    soundSwitch.setAttribute("aria-pressed", String(on));
    soundSwitch.title = on ? "Sound effects are on" : "Sound effects are off";
  }

  // Saved straight away, on its own: it never saves (or loses) unsaved changes in Settings.
  soundSwitch.addEventListener("click", () => {
    const on = !sounds.on;
    soundChanges++;
    showSound(on);
    if (on) sounds.play("send");
    const undo = () => {
      if (sounds.on !== on) return;
      soundChanges++;
      showSound(!on);
    };
    void sage.setSound(on).then((result) => {
      if (!result.ok) undo();
      // Home's Status panel says whether sound is on.
      home.refresh();
    }, undo);
  });

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

  /**
   * New chat removes the lines, so notices still held lose theirs: the next collection adds them
   * again (Sage hands them out until they are confirmed) as fresh hidden lines. Notices whose
   * confirmation is already on its way were revealed before the chat was cleared, so they stay.
   */
  function forgetHeldNotices(): void {
    for (const id of [...held.keys()]) {
      if (confirming.has(id)) continue;
      held.delete(id);
      shownNotices.delete(id);
    }
    // A confirmation may be going through its batches: make it stop and collect again, which adds
    // the forgotten notices back before anything more is confirmed.
    if (collecting) collectAgain = true;
  }

  async function confirmShown(): Promise<void> {
    if (!chatVisible()) return;
    const ids = [...held.keys()].filter((id) => !confirming.has(id));
    for (let start = 0; start < ids.length; start += MAX_ACK_IDS) {
      // A newer request means this snapshot may be out of date; the collection loop confirms again.
      if (collectAgain || !chatVisible()) return;
      const batch = ids.slice(start, start + MAX_ACK_IDS).filter((id) => held.has(id));
      for (const id of batch) {
        confirming.add(id);
        // Held lines stay hidden until now, so a notice that is withdrawn first is never seen.
        const item = held.get(id);
        if (item?.hidden) {
          item.hidden = false;
          item.scrollIntoView({ block: "end" });
        }
      }
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

  /** Returns false if Sage couldn't be asked, so the held notices can't be trusted to be current. */
  async function collectOnce(): Promise<boolean> {
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
      let arrived = false;
      for (const notice of notices) {
        if (shownNotices.has(notice.id)) continue;
        const item = addMessage("notice", notice.text);
        item.hidden = true;
        held.set(notice.id, item);
        shownNotices.add(notice.id);
        arrived = true;
      }
      // A new notice is usually a reminder that fired: Home's Today panel catches up at once.
      if (arrived) home.reminderArrived();
      return true;
    } catch {
      // The next poll tries again.
      return false;
    }
  }

  let collecting: Promise<void> | undefined;
  let collectAgain = false;

  /**
   * Collects, then confirms what is still held. Opening Chat and the window coming back into view
   * collect first too: a notice whose reminder was deleted meanwhile is taken out before it can be
   * confirmed. Only one collection runs at a time. A request that arrives while one is running makes
   * exactly one more follow it (further requests join that one), and nothing is confirmed until the
   * last has finished (including a request that arrives during a confirmation), so an older answer can
   * never bring back or confirm a notice a newer one removed. After a failed collection nothing is
   * confirmed: the held notices stay held, and hidden, until a later one succeeds.
   */
  function collectNotices(): Promise<void> {
    if (collecting) {
      collectAgain = true;
      return collecting;
    }
    collecting = (async () => {
      do {
        collectAgain = false;
        const fresh = await collectOnce();
        if (fresh && !collectAgain) await confirmShown();
      } while (collectAgain);
    })().finally(() => {
      collecting = undefined;
    });
    return collecting;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void collectNotices();
  });

  /** Started once the first view is chosen, so nothing is confirmed before it is on screen. */
  function startNotices(): void {
    void collectNotices();
    // A poll never queues another collection behind a running one: a slow answer would then be
    // followed by one more every time, and nothing would ever be confirmed.
    setInterval(() => {
      if (!collecting) void collectNotices();
    }, NOTICE_POLL_MS);
  }

  // --- Settings ---

  const form = byId<HTMLFormElement>("settings-form");
  const localModel = byId<HTMLInputElement>("local-model");
  const onlineUrl = byId<HTMLInputElement>("online-url");
  const onlineModel = byId<HTMLInputElement>("online-model");
  const keyInput = byId<HTMLInputElement>("online-key");
  const keyLabel = byId<HTMLLabelElement>("online-key-label");
  const keyStatus = byId<HTMLParagraphElement>("key-status");
  const keyResult = byId<HTMLParagraphElement>("key-result");
  const appsList = byId<HTMLUListElement>("apps");
  const foldersList = byId<HTMLUListElement>("folders");
  const settingsStatus = byId<HTMLSpanElement>("settings-status");
  const brainStatus = byId<HTMLSpanElement>("brain-status");
  const speakReplies = byId<HTMLSelectElement>("speak-replies");
  const morningBrief = byId<HTMLInputElement>("morning-brief");
  const themeChoice = byId<HTMLSelectElement>("theme");
  const brainNotice = byId<HTMLParagraphElement>("brain-notice");
  const panels = {
    local: byId<HTMLDivElement>("brain-local"),
    other: byId<HTMLDivElement>("brain-other"),
    service: byId<HTMLDivElement>("brain-service"),
    key: byId<HTMLDivElement>("brain-key"),
  };
  const serviceModel = byId<HTMLInputElement>("service-model");
  const serviceModelLabel = byId<HTMLLabelElement>("service-model-label");
  const loadModels = byId<HTMLButtonElement>("load-models");
  const modelList = byId<HTMLSelectElement>("model-list");
  const modelListLabel = byId<HTMLLabelElement>("model-list-label");
  const modelsStatus = byId<HTMLParagraphElement>("models-status");
  const testKey = byId<HTMLButtonElement>("test-key");
  const getKeyRow = byId<HTMLDivElement>("get-key-row");

  /** The ready-made services' models as the form shows them, saved or not. */
  let draftModels: Record<Company, string> = { claude: "", openai: "", gemini: "" };
  /** The company whose model the model box shows now (null when another brain is chosen). */
  let shownCompany: Company | null = null;
  /** The brain whose key box is on screen: a key typed for one brain is never saved for another. */
  let shownBrain: BrainChoice | null = null;
  /** Goes up whenever the chosen company changes; a model list for an earlier one is dropped. */
  let companyChanges = 0;

  function isCompany(brain: string): brain is Company {
    return (COMPANIES as readonly string[]).includes(brain);
  }

  /** The brain picked in the form. Anything unknown counts as on this computer. */
  function chosenBrain(): BrainChoice {
    const value = checkedBrain();
    return (BRAINS as readonly string[]).includes(value ?? "") ? (value as BrainChoice) : "local";
  }

  function describeBrain(current: PublicSettings): string {
    if (current.brain === "local") return `Brain: on this computer (${current.local.model})`;
    if (current.brain === "other") return `Brain: online (${current.online.model || "no model chosen"})`;
    const model = current.services[current.brain].model;
    return `Brain: ${BRAIN_LABELS[current.brain].name} (${model || "no model chosen"})`;
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

  function clearModelList(): void {
    modelList.replaceChildren();
    modelList.hidden = true;
    modelListLabel.hidden = true;
    modelsStatus.textContent = "";
  }

  /**
   * Shows the parts of the brain section for the brain picked in the form: the local model, another
   * service's address and model, or a ready-made service's model; and the key for an online brain.
   * The model box keeps each company's model apart, so switching back and forth loses nothing.
   */
  function showBrainPanels(): void {
    const brain = chosenBrain();
    if (shownCompany) draftModels[shownCompany] = serviceModel.value;
    const company = isCompany(brain) ? brain : null;
    if (company !== shownCompany) {
      companyChanges++;
      clearModelList();
      keyResult.textContent = "";
    }
    shownCompany = company;
    // A key typed (and not saved) for one brain is cleared when another is picked, so Save key can
    // only ever store it for the brain it was typed for.
    if (brain !== shownBrain) keyInput.value = "";
    shownBrain = brain;
    panels.local.hidden = brain !== "local";
    panels.other.hidden = brain !== "other";
    panels.service.hidden = company === null;
    panels.key.hidden = brain === "local";
    if (company) {
      serviceModel.value = draftModels[company];
      serviceModelLabel.textContent = `${BRAIN_LABELS[company].name} model`;
    }
    keyLabel.textContent =
      brain === "other" || brain === "local" ? "Online service key" : `${BRAIN_LABELS[brain].name} key`;
    // Test and Get a key are for the ready-made services, whose addresses Sage knows.
    testKey.hidden = company === null;
    getKeyRow.hidden = company === null;
    renderKeyStatus();
  }

  function render(): void {
    if (!settings) return;
    setBrainRadios(settings.brain);
    localModel.value = settings.local.model;
    onlineUrl.value = settings.online.baseUrl;
    onlineModel.value = settings.online.model;
    draftModels = {
      claude: settings.services.claude.model,
      openai: settings.services.openai.model,
      gemini: settings.services.gemini.model,
    };
    shownCompany = null;
    brainNotice.textContent = "";
    showBrainPanels();
    speakReplies.value = settings.speakReplies;
    morningBrief.checked = settings.morningBrief;
    showSound(settings.sound);
    themeChoice.value = settings.theme;
    applyTheme(settings.theme);
    brainStatus.textContent = describeBrain(settings);
    renderLists();
  }

  function renderKeyStatus(): void {
    if (!settings) return;
    const brain = chosenBrain();
    if (brain === "local") {
      keyStatus.textContent = "";
      return;
    }
    keyStatus.textContent = settings.keys[brain]
      ? "A key is saved, encrypted by your system. It is never shown again."
      : "No key saved.";
  }

  /**
   * Goes up on every Settings save and every settings reload. A refresh after the Welcome screen
   * that was overtaken by one of them is dropped, so it never overwrites newer settings.
   */
  let settingsGeneration = 0;

  async function loadSettings(): Promise<void> {
    settingsGeneration++;
    const soundAsked = soundChanges;
    const loaded = await sage.getSettings();
    // The Sound switch was used while this read was on its way: the switch is newer.
    if (soundChanges !== soundAsked) loaded.sound = sounds.on;
    settings = loaded;
    render();
  }

  /** After saving or removing a key: updates only the key line, so unsaved form changes stay. */
  async function refreshKeyStatus(): Promise<void> {
    const latest = await sage.getSettings();
    if (!settings) return;
    settings.keys = latest.keys;
    renderKeyStatus();
  }

  function readSpeakReplies(): PublicSettings["speakReplies"] {
    const value = speakReplies.value;
    return value === "always" || value === "never" ? value : "voice";
  }

  for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="brain"]')) {
    radio.addEventListener("change", () => {
      showBrainPanels();
      const brain = chosenBrain();
      // Picking an online brain (other than the saved one) says, in one line, what goes where.
      brainNotice.textContent = brain !== "local" && brain !== settings?.brain ? privacyLine(brain) : "";
      settingsStatus.textContent = "Not saved yet: choose Save settings.";
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!settings) return;
    settingsGeneration++;
    if (shownCompany) draftModels[shownCompany] = serviceModel.value;
    void sage
      .saveSettings({
        brain: chosenBrain(),
        local: { model: localModel.value.trim() },
        online: { baseUrl: onlineUrl.value.trim(), model: onlineModel.value.trim() },
        services: {
          claude: { model: draftModels.claude.trim() },
          openai: { model: draftModels.openai.trim() },
          gemini: { model: draftModels.gemini.trim() },
        },
        apps: settings.apps,
        folders: settings.folders,
        speakReplies: readSpeakReplies(),
        theme: toTheme(themeChoice.value),
        morningBrief: morningBrief.checked,
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

  // The theme is tried out as soon as it is picked; it is kept once Save settings is chosen.
  themeChoice.addEventListener("change", () => {
    applyTheme(toTheme(themeChoice.value));
    settingsStatus.textContent = "Not saved yet: choose Save settings.";
  });

  byId<HTMLButtonElement>("save-key").addEventListener("click", () => {
    const key = keyInput.value;
    keyInput.value = "";
    const brain = chosenBrain();
    if (!key.trim() || brain === "local") return;
    // For another online service the address on screen goes with the key; the main process refuses
    // it if that address isn't saved yet, so a key is never tied to the wrong service. A company's
    // key is tied to that company's fixed address by the main process.
    void sage.setKey(brain, key, onlineUrl.value).then(async (result) => {
      settingsStatus.textContent = result.ok ? "Key saved." : `Key not saved: ${result.message}`;
      await refreshKeyStatus();
    });
  });

  byId<HTMLButtonElement>("clear-key").addEventListener("click", () => {
    const brain = chosenBrain();
    if (brain === "local") return;
    void sage.clearKey(brain).then(async () => {
      settingsStatus.textContent = "Key removed.";
      await refreshKeyStatus();
    });
  });

  testKey.addEventListener("click", () => {
    const company = shownCompany;
    if (!company) return;
    const mine = companyChanges;
    testKey.disabled = true;
    keyResult.textContent = `Checking the key with ${BRAIN_LABELS[company].name}…`;
    void sage
      .testKey(company)
      .catch(() => ({ ok: false, message: "Sage couldn't check the key. Try again." }))
      .then((result) => {
        testKey.disabled = false;
        if (mine !== companyChanges) return;
        keyResult.textContent = result.ok ? (result.message ?? "The key works.") : result.message;
      });
  });

  loadModels.addEventListener("click", () => {
    const company = shownCompany;
    if (!company) return;
    const mine = companyChanges;
    loadModels.disabled = true;
    modelsStatus.textContent = `Asking ${BRAIN_LABELS[company].name} for its models…`;
    void sage
      .listModels(company)
      .catch(() => ({ ok: false as const, message: "Sage couldn't load the models. Try again." }))
      .then((result) => {
        loadModels.disabled = false;
        // Another brain was picked meanwhile: this list isn't for the model box any more.
        if (mine !== companyChanges) return;
        if (!result.ok) {
          clearModelList();
          modelsStatus.textContent = result.message;
          return;
        }
        modelList.replaceChildren();
        const prompt = document.createElement("option");
        prompt.value = "";
        prompt.textContent = "Pick a model…";
        modelList.append(prompt);
        for (const name of result.models) {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          modelList.append(option);
        }
        modelList.value = result.models.includes(serviceModel.value) ? serviceModel.value : "";
        modelList.hidden = result.models.length === 0;
        modelListLabel.hidden = result.models.length === 0;
        modelsStatus.textContent =
          result.models.length === 0
            ? `${BRAIN_LABELS[company].name} listed no models for this key.`
            : `${result.models.length} models. Pick one, or type a name in the model box.`;
      });
  });

  // Picking from the list fills in the model box, which stays editable.
  modelList.addEventListener("change", () => {
    if (!shownCompany || !modelList.value) return;
    serviceModel.value = modelList.value;
    draftModels[shownCompany] = modelList.value;
    settingsStatus.textContent = "Not saved yet: choose Save settings.";
  });

  byId<HTMLButtonElement>("get-key").addEventListener("click", () => {
    const company = shownCompany;
    if (!company) return;
    const mine = companyChanges;
    keyResult.textContent = "Sage is asking whether to open the key page…";
    void sage
      .openKeyPage(company)
      .catch(() => ({ status: "failed" as const, message: "Sage couldn't open the key page.", address: "" }))
      .then((result) => {
        if (mine !== companyChanges) return;
        keyResult.textContent =
          result.status === "opened"
            ? "The key page opened in your web browser. Create a key there, paste it here and choose Save key."
            : result.status === "declined"
              ? "The key page wasn't opened."
              : result.message;
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
          // The brain list, for the user to pick a service and save its key.
          settingsStatus.textContent = ONLINE_HINT;
          for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="brain"]')) {
            if (radio.value === "claude") radio.focus();
          }
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
    "Choose Claude, OpenAI, Gemini or Another online service under Brain, and choose Save settings. Then paste its key and choose Save key (Get a key opens the company's key page).";

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
    const generation = settingsGeneration;
    let latest: PublicSettings;
    try {
      latest = await sage.getSettings();
    } catch {
      return;
    }
    // A Settings save or reload happened meanwhile: what it shows is newer than this answer.
    if (generation !== settingsGeneration) return;
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
      if (checkedBrain() === shown.brain) {
        setBrainRadios(latest.brain);
        showBrainPanels();
      }
    }
    brainStatus.textContent = describeBrain(settings);
  }

  // The first view: the Welcome screen until setup is finished or skipped, otherwise Home. If the
  // settings can't be read, Home opens.
  void loadSettings()
    .then(
      () => (settings?.setupDone === false ? openWelcome() : show("home")),
      () => show("home"),
    )
    .then(startNotices);
}
