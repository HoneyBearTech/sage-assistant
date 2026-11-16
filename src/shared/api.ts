/** The only things the chat window can ask the main process for. Shared by preload and renderer. */

export const CHANNELS = {
  send: "sage:chat-send",
  reset: "sage:chat-reset",
  getSettings: "sage:settings-get",
  saveSettings: "sage:settings-save",
  setKey: "sage:key-set",
  clearKey: "sage:key-clear",
  chooseFolder: "sage:choose-folder",
  chooseApp: "sage:choose-app",
  takeNotices: "sage:notices-take",
  ackNotices: "sage:notices-ack",
  voiceStatus: "sage:voice-status",
  downloadVoice: "sage:voice-download",
  cancelVoiceDownload: "sage:voice-download-cancel",
  transcribe: "sage:voice-transcribe",
  runnerStatus: "sage:setup-runner-status",
  pullModel: "sage:setup-pull",
  pullStatus: "sage:setup-pull-status",
  cancelPull: "sage:setup-pull-cancel",
  openInstallGuide: "sage:setup-open-guide",
  finishSetup: "sage:setup-finish",
  setSound: "sage:sound-set",
} as const;

/** The longest message the window may send; the message box has the same limit. */
export const MAX_MESSAGE_CHARS = 8_000;

/** One recording: 16,000 samples a second, one channel, at most 30 seconds. */
export const VOICE_SAMPLE_RATE = 16_000;
export const MAX_VOICE_SAMPLES = VOICE_SAMPLE_RATE * 30;

/** The most notice ids one `ackNotices` call may carry; the window sends more in batches. */
export const MAX_ACK_IDS = 50;

/** A message from Sage itself for the window. The id is what the window confirms with. */
export interface Notice {
  id: string;
  text: string;
}

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

export interface PublicAppEntry {
  name: string;
  path: string;
  args: string[];
}

/** Settings as the window sees them. The key itself is never sent; only whether one is saved. */
export interface PublicSettings {
  brain: "local" | "online";
  local: { model: string };
  online: { baseUrl: string; model: string; hasKey: boolean };
  apps: PublicAppEntry[];
  folders: string[];
  /** Read replies aloud: after voice messages, always, or never. */
  speakReplies: "voice" | "always" | "never";
  /** The Welcome screen was finished or skipped. Changed only by `finishSetup`. */
  setupDone: boolean;
  /** The window's look: dark (the default), light, or the system's choice. */
  theme: "dark" | "light" | "system";
  /** Sound effects in the window. Changed only by `setSound` (the top bar's switch). */
  sound: boolean;
}

export type SettingsInput = Omit<PublicSettings, "online" | "setupDone" | "sound"> & {
  online: { baseUrl: string; model: string };
};

/** `message` on success is something the user should know, such as a key that was removed. */
export type Result = { ok: true; message?: string } | { ok: false; message: string };

/** Whether the speech file is there, and how far a download has got. */
export interface VoiceStatus {
  model: "missing" | "downloading" | "ready";
  received: number;
  total: number;
}

/** "declined": the user chose Not now in the main process's box. */
export type DownloadResult =
  | { status: "done" }
  | { status: "declined" }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

/** `needsDownload`: the speech file isn't there, so the window offers the download. */
export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; message: string; needsDownload?: true };

/** Sage's two local models, as the window names them; the main process maps them to model names. */
export const MODEL_CHOICES = ["standard", "smaller"] as const;
export type ModelChoice = (typeof MODEL_CHOICES)[number];

/** Sage's two local models. Only these can be downloaded from the Welcome screen. */
export const SAGE_MODELS: Record<ModelChoice, { name: string; label: string; size: string }> = {
  standard: { name: "qwen3:4b", label: "Standard", size: "about 2.5 GB" },
  smaller: { name: "qwen3:1.7b", label: "Smaller", size: "about 1.4 GB" },
};

/**
 * The local model runner, for the local model saved in Settings: not reachable (not installed or
 * not started), an answer Sage couldn't read, running without that model, or ready. `downloaded`
 * says which of Sage's two models the runner already has.
 */
export interface RunnerStatus {
  state: "unreachable" | "unreadable" | "no-model" | "ready";
  /** The local model saved in Settings. */
  model: string;
  downloaded: Record<ModelChoice, boolean>;
}

/**
 * "declined": the user chose Not now in the main process's box. `skills` after a download: whether
 * the runner says the model can use tools ("unknown" when it doesn't say).
 */
export type PullResult =
  | { status: "done"; skills: "yes" | "no" | "unknown" }
  | { status: "declined" }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

/** How far the model download has got, in bytes, as the runner reports it. */
export interface PullStatus {
  downloading: boolean;
  completed: number;
  total: number;
}

/**
 * Cancel: "cancelled" before the commit point; "too-late" once the downloaded model is being saved
 * as the local model (it stays chosen); "idle" when nothing was running.
 */
export type CancelPullResult = "cancelled" | "too-late" | "idle";

/** Opening the install guide. `address` is shown to copy when no browser opened. */
export type GuideResult =
  | { status: "opened" }
  | { status: "declined" }
  | { status: "failed"; message: string; address: string };

export interface SageApi {
  send(text: string): Promise<string>;
  resetChat(): Promise<void>;
  getSettings(): Promise<PublicSettings>;
  saveSettings(settings: SettingsInput): Promise<Result>;
  /** `baseUrl` is the address on screen; the key is saved only if it is the saved address. */
  setKey(key: string, baseUrl: string): Promise<Result>;
  clearKey(): Promise<Result>;
  chooseFolder(): Promise<string | null>;
  chooseApp(): Promise<string | null>;
  /**
   * Messages from Sage itself (reminders, data-file problems). A notice is handed out again until
   * the window confirms it with `ackNotices`, so the window skips ids it already shows.
   */
  takeNotices(): Promise<Notice[]>;
  /** Confirms these notices are on screen; only then does a reminder count as shown. */
  ackNotices(ids: string[]): Promise<void>;
  voiceStatus(): Promise<VoiceStatus>;
  /** The main process asks the user first, in its own box, then downloads the speech file. */
  downloadVoice(): Promise<DownloadResult>;
  cancelVoiceDownload(): Promise<void>;
  /** 16 kHz mono sound, at most MAX_VOICE_SAMPLES samples; the words go into the message box. */
  transcribe(pcm: Int16Array): Promise<TranscribeResult>;
  /** The Welcome screen: the local model runner and which of Sage's models it has. */
  runnerStatus(): Promise<RunnerStatus>;
  /**
   * The main process asks first, in its own box, then has the local model runner download the
   * model; on success it is saved as the local model. Only Sage's two models can be chosen.
   */
  pullModel(choice: ModelChoice): Promise<PullResult>;
  pullStatus(): Promise<PullStatus>;
  cancelPull(): Promise<CancelPullResult>;
  /** The main process asks first, then opens Sage's install guide (one fixed address). */
  openInstallGuide(): Promise<GuideResult>;
  /** Saves that setup was finished or skipped, so the Welcome screen isn't shown at start-up. */
  finishSetup(): Promise<Result>;
  /** The top bar's sound switch: saves only whether sound effects are on. */
  setSound(on: boolean): Promise<Result>;
}
