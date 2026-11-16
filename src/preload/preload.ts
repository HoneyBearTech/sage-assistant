import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, EVENTS, readAskingEvent, type SageApi } from "../shared/api.js";

// The page gets exactly these methods and nothing else: no ipcRenderer, no Node, no Electron.
const api: SageApi = {
  send: (text) => ipcRenderer.invoke(CHANNELS.send, { text }),
  resetChat: () => ipcRenderer.invoke(CHANNELS.reset),
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  saveSettings: (settings) => ipcRenderer.invoke(CHANNELS.saveSettings, settings),
  setKey: (brain, key, baseUrl) => ipcRenderer.invoke(CHANNELS.setKey, { brain, key, baseUrl }),
  clearKey: (brain) => ipcRenderer.invoke(CHANNELS.clearKey, { brain }),
  listModels: (company) => ipcRenderer.invoke(CHANNELS.listModels, { company }),
  testKey: (company) => ipcRenderer.invoke(CHANNELS.testKey, { company }),
  openKeyPage: (company) => ipcRenderer.invoke(CHANNELS.openKeyPage, { company }),
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
  setSound: (on) => ipcRenderer.invoke(CHANNELS.setSound, { on }),
  homeSummary: () => ipcRenderer.invoke(CHANNELS.homeSummary, {}),
  claimMorningBrief: () => ipcRenderer.invoke(CHANNELS.claimMorningBrief, {}),
  // One way only: news that Sage's own box is asking something, and later its answer. The page gets
  // the checked fields, never the IPC event (which could send a reply), and nothing it does can
  // answer the box.
  onAsking: (listener) => {
    ipcRenderer.on(EVENTS.asking, (_event, payload: unknown) => {
      const event = readAskingEvent(payload);
      if (event) listener(event);
    });
  },
};

contextBridge.exposeInMainWorld("sage", api);
