import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type SageApi } from "../shared/api.js";

// The page gets exactly these methods and nothing else: no ipcRenderer, no Node, no Electron.
const api: SageApi = {
  send: (text) => ipcRenderer.invoke(CHANNELS.send, { text }),
  resetChat: () => ipcRenderer.invoke(CHANNELS.reset),
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  saveSettings: (settings) => ipcRenderer.invoke(CHANNELS.saveSettings, settings),
  setKey: (key) => ipcRenderer.invoke(CHANNELS.setKey, { key }),
  clearKey: () => ipcRenderer.invoke(CHANNELS.clearKey),
  chooseFolder: () => ipcRenderer.invoke(CHANNELS.chooseFolder),
  chooseApp: () => ipcRenderer.invoke(CHANNELS.chooseApp),
};

contextBridge.exposeInMainWorld("sage", api);
