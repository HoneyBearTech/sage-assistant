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
} as const;

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

export type Result = { ok: true } | { ok: false; message: string };

export interface SageApi {
  send(text: string): Promise<string>;
  resetChat(): Promise<void>;
  getSettings(): Promise<PublicSettings>;
  saveSettings(settings: SettingsInput): Promise<Result>;
  setKey(key: string): Promise<Result>;
  clearKey(): Promise<Result>;
  chooseFolder(): Promise<string | null>;
  chooseApp(): Promise<string | null>;
}
