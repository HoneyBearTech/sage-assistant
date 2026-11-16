import { join } from "node:path";
import { Assistant } from "./assistant.js";
import type { Brain, FetchLike } from "./brain/brain.js";
import { LocalBrain } from "./brain/local.js";
import { OnlineBrain, serviceOrigin } from "./brain/online.js";
import type { Launcher } from "./apps.js";
import { type KeyStore, ServiceKeys } from "./keystore.js";
import { createLogger, type Logger, type LogSink, SecretRedactor } from "./log.js";
import { NoticeBoard } from "./notices.js";
import { NotesStore } from "./notes.js";
import { RemindersStore } from "./reminders.js";
import { type Clock, type Notifier, ReminderScheduler, systemClock } from "./scheduler.js";
import { DuckDuckGoProvider } from "./search/duckduckgo.js";
import type { SearchProvider } from "./search/search.js";
import { type Settings, SettingsStore } from "./settings.js";
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
  keyStore: KeyStore;
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
}

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
}

export function createSage(deps: SageDeps): Sage {
  const clock = deps.clock ?? systemClock;
  const now = () => clock.now();
  const redactor = new SecretRedactor();
  const logger = createLogger(deps.logSink, redactor);

  // Every key that passes through Sage is registered with the redactor, so even an unexpected
  // log line or action-log entry can't contain it.
  const keyStore = new ServiceKeys(deps.keyStore, (key) => redactor.add(key));

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

  return {
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
  };
}

/**
 * The brain for one turn. An online brain is tied to the service it was made for: every request
 * in the turn asks for the key of that service only, so a key saved for another service (after
 * the settings changed mid-turn) is never sent to this one.
 */
export function brainFor(
  settings: Settings,
  keyStore: Pick<ServiceKeys, "keyFor">,
  deps: Pick<SageDeps, "fetch" | "localPort">,
  redact?: (text: string) => string,
): Brain {
  if (settings.brain === "online") {
    const origin = serviceOrigin(settings.online.baseUrl);
    return new OnlineBrain({
      baseUrl: settings.online.baseUrl,
      model: settings.online.model,
      getKey: async () => (origin ? keyStore.keyFor(origin) : null),
      ...(redact ? { redact } : {}),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
  }
  return new LocalBrain({
    model: settings.local.model,
    ...(deps.localPort ? { port: deps.localPort } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
}
