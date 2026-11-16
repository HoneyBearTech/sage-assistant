import { join } from "node:path";
import { Assistant } from "./assistant.js";
import type { Brain, FetchLike } from "./brain/brain.js";
import { LocalBrain } from "./brain/local.js";
import { MessagesBrain } from "./brain/anthropic.js";
import { serviceName } from "./brain/errors.js";
import { GeminiBrain } from "./brain/gemini.js";
import { OnlineBrain } from "./brain/online.js";
import { OPENAI_CHAT_URL } from "./brain/services.js";
import { RunnerClient } from "./brain/runner.js";
import type { Launcher } from "./apps.js";
import { type KeyStores, ServiceKeys } from "./keystore.js";
import { createLogger, type Logger, type LogSink, SecretRedactor } from "./log.js";
import { NoticeBoard } from "./notices.js";
import { NotesStore } from "./notes.js";
import { OnlineServices } from "./online-services.js";
import { RemindersStore } from "./reminders.js";
import { type Clock, type Notifier, ReminderScheduler, systemClock } from "./scheduler.js";
import { DuckDuckGoProvider } from "./search/duckduckgo.js";
import type { SearchProvider } from "./search/search.js";
import { type Settings, SettingsStore } from "./settings.js";
import { Setup, type SetupDeps } from "./setup.js";
import { ActionLog } from "./skills/action-log.js";
import { builtinSkills, type PathOpener } from "./skills/builtin.js";
import { ApprovalGate, type ConfirmPresenter } from "./skills/gate.js";
import { SkillRegistry } from "./skills/registry.js";
import type { SpeechModel } from "./voice/model.js";
import { HelperTranscriber, type StartHelper } from "./voice/transcriber.js";
import { Voice } from "./voice/voice.js";

/** Everything Sage needs from the outside world. The Electron main process supplies the real ones. */
export interface SageDeps {
  /** Sage's own folder: Electron's app.getPath("userData"). */
  dataDir: string;
  /** One key store per online brain (each company's, and another online service's). */
  keyStores: KeyStores;
  presenter: ConfirmPresenter;
  notify: Notifier;
  openPath: PathOpener;
  launch: Launcher;
  logSink: LogSink;
  fetch?: FetchLike;
  search?: SearchProvider;
  clock?: Clock;
  platform?: NodeJS.Platform;
  /** For tests only: the port of a fake local model runner on 127.0.0.1. */
  localPort?: number;
  /** Voice's parts from the main process; without them voice says it isn't available. */
  voice?: VoiceParts;
  /** First-run setup's parts from the main process; without them nothing is asked or opened. */
  setup?: SetupParts;
}

/**
 * The main process's boxes for the Welcome screen and the key pages, and the web browser. A box
 * before a key page opens: `confirmOpenPage`, the same kind of box as the install guide's.
 */
export type SetupParts = Pick<
  SetupDeps,
  "confirmPull" | "confirmOpenGuide" | "openExternal" | "timers" | "stallMs"
> & { confirmOpenPage?: (question: string, detail: string) => Promise<boolean> };

const NO_SETUP: SetupParts = {
  confirmPull: async () => false,
  confirmOpenGuide: async () => false,
  confirmOpenPage: async () => false,
  openExternal: async () => {
    throw new Error("No web browser here.");
  },
};

export interface VoiceParts {
  /** The main process's own box: "Voice needs a 44 MB speech file … Download it now?" */
  confirmDownload: () => Promise<boolean>;
  /** Starts the speech helper process. */
  startHelper: StartHelper;
  /** For tests only: the files to download (a fake server's addresses). */
  model?: SpeechModel;
}

const NO_VOICE: VoiceParts = {
  confirmDownload: async () => false,
  startHelper: () => {
    throw new Error("Voice isn't available here.");
  },
};

export interface Sage {
  assistant: Assistant;
  settings: SettingsStore;
  keyStore: ServiceKeys;
  notes: NotesStore;
  reminders: RemindersStore;
  scheduler: ReminderScheduler;
  /** Messages from Sage itself waiting to be shown in the window. */
  notices: NoticeBoard;
  registry: SkillRegistry;
  gate: ApprovalGate;
  logger: Logger;
  redactor: SecretRedactor;
  /** The speech file, its download, and turning recordings into text. */
  voice: Voice;
  /** The Welcome screen's requests: the local model runner, a model download, the install guide. */
  setup: Setup;
  /** Settings' requests for a ready-made service: Load models, Test, Get a key. */
  services: OnlineServices;
}

export function createSage(deps: SageDeps): Sage {
  const clock = deps.clock ?? systemClock;
  const now = () => clock.now();
  const redactor = new SecretRedactor();
  const logger = createLogger(deps.logSink, redactor);

  // Every key that passes through Sage is registered with the redactor, so even an unexpected
  // log line or action-log entry can't contain it.
  const keyStore = new ServiceKeys(deps.keyStores, (key) => redactor.add(key));

  const notices = new NoticeBoard();
  // An unreadable data file is moved aside, never deleted; the user is told once, in the window.
  const corrupt = (what: string, fresh: string) => (movedTo: string) =>
    notices.post(
      `Sage couldn't read its ${what} file, so it ${fresh}. The old file wasn't deleted; it was kept here: ${movedTo}`,
    );
  const settings = new SettingsStore(
    deps.dataDir,
    logger,
    corrupt("settings", "went back to the default settings"),
  );
  const notes = new NotesStore(deps.dataDir, logger, now, corrupt("notes", "started an empty notes list"));
  const reminders = new RemindersStore(
    deps.dataDir,
    logger,
    now,
    corrupt("reminders", "started an empty reminders list"),
  );
  const scheduler = new ReminderScheduler(reminders, deps.notify, clock, logger, notices);
  const gate = new ApprovalGate(deps.presenter);
  const actionLog = new ActionLog(join(deps.dataDir, "action-log.jsonl"), (text) => redactor.redact(text));
  const registry = new SkillRegistry(gate, actionLog, logger, now);
  const search = deps.search ?? new DuckDuckGoProvider(deps.fetch ? { fetch: deps.fetch } : {});

  for (const skill of builtinSkills({
    notes,
    reminders,
    search,
    settings: () => settings.load(),
    openPath: deps.openPath,
    launch: deps.launch,
    now,
    ...(deps.platform ? { platform: deps.platform } : {}),
    reminderDeleted: (id) => scheduler.withdraw(id),
  })) {
    registry.register(skill);
  }

  const getBrain = async (): Promise<Brain> =>
    brainFor(await settings.load(), keyStore, deps, (text) => redactor.redact(text));
  const assistant = new Assistant({ getBrain, registry, logger, now });

  const voiceParts = deps.voice ?? NO_VOICE;
  const voice = new Voice({
    dataDir: deps.dataDir,
    confirmDownload: voiceParts.confirmDownload,
    transcriber: new HelperTranscriber(voiceParts.startHelper),
    logger,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(voiceParts.model ? { model: voiceParts.model } : {}),
  });

  const setup = new Setup({
    settings,
    runner: new RunnerClient({
      ...(deps.localPort ? { port: deps.localPort } : {}),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    }),
    logger,
    // A download switches the brain to local; a turn on the online service stops, as it does when
    // Settings changes the brain.
    brainChanged: () => assistant.stopTurn(),
    ...NO_SETUP,
    ...deps.setup,
  });

  const setupParts = { ...NO_SETUP, ...deps.setup };
  const services = new OnlineServices({
    keys: keyStore,
    logger,
    confirmOpenPage: setupParts.confirmOpenPage ?? (async () => false),
    openExternal: setupParts.openExternal,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });

  return {
    services,
    assistant,
    settings,
    keyStore,
    notes,
    reminders,
    scheduler,
    notices,
    registry,
    gate,
    logger,
    redactor,
    voice,
    setup,
  };
}

/**
 * The brain for one turn. An online brain is tied to the service it was made for: every request in
 * the turn asks for the key of that brain only, for the exact address the request goes to. A
 * company's key goes only to its fixed address; another online service's key only to the address it
 * was saved for, so a key saved for another service (after the settings changed mid-turn) is never
 * sent to this one.
 */
export function brainFor(
  settings: Settings,
  keyStore: Pick<ServiceKeys, "keyForRequest">,
  deps: Pick<SageDeps, "fetch" | "localPort">,
  redact?: (text: string) => string,
): Brain {
  const common = {
    ...(redact ? { redact } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  };
  switch (settings.brain) {
    case "claude":
      return new MessagesBrain({
        model: settings.services.claude.model,
        getKey: (url) => keyStore.keyForRequest("claude", url),
        ...common,
      });
    case "openai":
      return new OnlineBrain({
        endpoint: OPENAI_CHAT_URL,
        service: serviceName("OpenAI"),
        model: settings.services.openai.model,
        getKey: (url) => keyStore.keyForRequest("openai", url),
        ...common,
      });
    case "gemini":
      return new GeminiBrain({
        model: settings.services.gemini.model,
        getKey: (url) => keyStore.keyForRequest("gemini", url),
        ...common,
      });
    case "other":
      return new OnlineBrain({
        baseUrl: settings.online.baseUrl,
        model: settings.online.model,
        getKey: (url) => keyStore.keyForRequest("other", url),
        ...common,
      });
    default:
      return new LocalBrain({
        model: settings.local.model,
        ...(deps.localPort ? { port: deps.localPort } : {}),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
  }
}
