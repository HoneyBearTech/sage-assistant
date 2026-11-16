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
};

contextBridge.exposeInMainWorld("sage", api);
