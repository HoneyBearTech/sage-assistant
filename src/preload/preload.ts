import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type SageApi } from "../shared/api.js";

// The page gets exactly these methods and nothing else: no ipcRenderer, no Node, no Electron.
const api: SageApi = {
  send: (text) => ipcRenderer.invoke(CHANNELS.send, { text }),
  resetChat: () => ipcRenderer.invoke(CHANNELS.reset),
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  saveSettings: (settings) => ipcRenderer.invoke(CHANNELS.saveSettings, settings),
  setKey: (key, baseUrl) => ipcRenderer.invoke(CHANNELS.setKey, { key, baseUrl }),
  clearKey: () => ipcRenderer.invoke(CHANNELS.clearKey),
  chooseFolder: () => ipcRenderer.invoke(CHANNELS.chooseFolder),
  chooseApp: () => ipcRenderer.invoke(CHANNELS.chooseApp),
  takeNotices: () => ipcRenderer.invoke(CHANNELS.takeNotices),
  ackNotices: (ids) => ipcRenderer.invoke(CHANNELS.ackNotices, { ids }),
  voiceStatus: () => ipcRenderer.invoke(CHANNELS.voiceStatus),
  downloadVoice: () => ipcRenderer.invoke(CHANNELS.downloadVoice),
  cancelVoiceDownload: () => ipcRenderer.invoke(CHANNELS.cancelVoiceDownload),
  transcribe: (pcm) => ipcRenderer.invoke(CHANNELS.transcribe, { pcm }),
  runnerStatus: () => ipcRenderer.invoke(CHANNELS.runnerStatus),
  pullModel: (choice) => ipcRenderer.invoke(CHANNELS.pullModel, { choice }),
  pullStatus: () => ipcRenderer.invoke(CHANNELS.pullStatus),
  cancelPull: () => ipcRenderer.invoke(CHANNELS.cancelPull),
  openInstallGuide: () => ipcRenderer.invoke(CHANNELS.openInstallGuide),
  finishSetup: () => ipcRenderer.invoke(CHANNELS.finishSetup),
};

contextBridge.exposeInMainWorld("sage", api);
