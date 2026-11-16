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
} as const;

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
}

export type SettingsInput = Omit<PublicSettings, "online"> & {
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
}
