import type { DownloadResult, PublicSettings, SageApi } from "../shared/api.js";
import { Recording, Speaker, toPcm16k } from "./voice.js";
import {
  appendTranscript,
  MAX_RECORDING_MS,
  MIN_RECORDING_MS,
  micErrorMessage,
  shouldSpeak,
  VOICE_TEXT,
} from "./voice-text.js";

// Hold Ctrl+Space (while Sage's window is focused) or hold the Talk button to record. On release
// the recording is turned into plain 16 kHz sound, sent once to the main process, and the words
// are put in the message box: never sent by themselves. The microphone is open only while held,
// and closes on release, when the window loses focus or is hidden, and on New chat.

export interface VoiceElements {
  input: HTMLTextAreaElement;
  talkButton: HTMLButtonElement;
  voiceStatus: HTMLElement;
  voiceDownload: HTMLButtonElement;
  voiceCancel: HTMLButtonElement;
  stopSpeaking: HTMLButtonElement;
  voiceNote: HTMLElement;
}

export interface VoiceControls {
  /** New chat: closes the microphone, stops speech, and drops a recording being worked out. */
  reset(): void;
  /** For a message being sent: true if any of its words came from talking. Clears the mark. */
  takeFromVoice(): boolean;
  /** Reads Sage's final reply aloud if the setting says so; never while Sage is listening. */
  replied(reply: string, fromVoice: boolean, setting: PublicSettings["speakReplies"]): void;
}

type TalkSource = "key" | "button" | "button-key";
interface Talk {
  source: TalkSource;
  startedAt: number;
  recording: Recording | null;
  timer: ReturnType<typeof setInterval>;
  cap: ReturnType<typeof setTimeout>;
}

/** How often the window asks how far the download has got. */
const DOWNLOAD_POLL_MS = 500;

/** Sets up voice in the window: keys, the Talk button, the download offer and spoken replies. */
export function createVoiceControls(
  sage: SageApi,
  el: VoiceElements,
  synth: SpeechSynthesis | undefined,
): VoiceControls {
  let talk: Talk | null = null;
  /** Goes up on New chat; a transcript for an older chat is dropped. */
  let generation = 0;
  let working = false;
  let downloading = false;
  let ready = false;
  let fromVoice = false;

  const speaker = new Speaker(synth, (current) => {
    el.stopSpeaking.hidden = !current.speaking;
    el.voiceNote.textContent = current.availability === "none" ? VOICE_TEXT.noVoice : "";
  });

  function show(text: string, buttons: { download?: string; cancel?: boolean } = {}): void {
    el.voiceStatus.textContent = text;
    el.voiceDownload.hidden = !buttons.download;
    if (buttons.download) el.voiceDownload.textContent = buttons.download;
    el.voiceCancel.hidden = !buttons.cancel;
  }

  function setTalkButton(active: boolean): void {
    el.talkButton.classList.toggle("active", active);
    el.talkButton.setAttribute("aria-pressed", String(active));
  }

  async function refreshStatus(): Promise<void> {
    try {
      const status = await sage.voiceStatus();
      ready = status.model === "ready";
      if (downloading && status.model === "downloading") {
        show(VOICE_TEXT.downloading(status.received, status.total), { cancel: true });
      }
    } catch {
      // Checked again on the next try.
    }
  }

  async function startTalk(source: TalkSource): Promise<void> {
    // Sage never hears itself: talking stops any reply being read aloud.
    speaker.stop();
    if (talk || working) return;
    if (downloading) {
      show(VOICE_TEXT.waitForDownload, { cancel: true });
      return;
    }
    if (!ready) {
      show(VOICE_TEXT.offer, { download: "Download" });
      return;
    }
    const startedAt = Date.now();
    const current: Talk = {
      source,
      startedAt,
      recording: null,
      timer: setInterval(() => show(VOICE_TEXT.listening(Date.now() - startedAt)), 250),
      // At most 30 seconds: it stops (and is worked out) by itself.
      cap: setTimeout(() => void stopTalk(), MAX_RECORDING_MS),
    };
    talk = current;
    setTalkButton(true);
    show(VOICE_TEXT.listening(0));
    let recording: Recording;
    try {
      recording = await Recording.start();
    } catch (error) {
      if (talk === current) {
        endTalk(current);
        show(micErrorMessage(error));
      }
      return;
    }
    // Let go (or stopped) while the microphone was opening: close it again at once.
    if (talk !== current) {
      recording.cancel();
      return;
    }
    current.recording = recording;
  }

  function endTalk(current: Talk): void {
    clearInterval(current.timer);
    clearTimeout(current.cap);
    if (talk === current) talk = null;
    setTalkButton(false);
  }

  /** Stops the microphone and throws the recording away. */
  function cancelTalk(message: string): void {
    const current = talk;
    if (!current) return;
    endTalk(current);
    current.recording?.cancel();
    show(message);
  }

  /** Stops the microphone and turns what was recorded into words in the message box. */
  async function stopTalk(): Promise<void> {
    const current = talk;
    if (!current) return;
    endTalk(current);
    const recording = current.recording;
    if (!recording || Date.now() - current.startedAt < MIN_RECORDING_MS) {
      // A quick tap records almost nothing.
      recording?.cancel();
      show(VOICE_TEXT.tap);
      return;
    }
    const mine = generation;
    working = true;
    show(VOICE_TEXT.working);
    try {
      const pcm = await toPcm16k(await (await recording.stop()).arrayBuffer());
      if (mine !== generation) return;
      if (pcm.length === 0) {
        show(VOICE_TEXT.nothingHeard);
        return;
      }
      const result = await sage.transcribe(pcm);
      if (mine !== generation) return;
      if (!result.ok) {
        if (result.needsDownload) {
          ready = false;
          show(result.message, { download: "Download" });
        } else {
          show(result.message);
        }
        return;
      }
      if (!result.text.trim()) {
        show(VOICE_TEXT.nothingHeard);
        return;
      }
      el.input.value = appendTranscript(el.input.value, result.text);
      fromVoice = true;
      show("");
      el.input.focus();
    } catch {
      if (mine === generation) show(VOICE_TEXT.badRecording);
    } finally {
      working = false;
    }
  }

  function isTalkKey(event: KeyboardEvent): boolean {
    return (
      event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (event.code === "Space" || event.key === " ")
    );
  }

  document.addEventListener("keydown", (event) => {
    if (!isTalkKey(event)) return;
    event.preventDefault();
    if (event.repeat) return;
    void startTalk("key");
  });
  document.addEventListener("keyup", (event) => {
    if (talk?.source !== "key") return;
    // Letting go of either key stops it.
    if (event.key === "Control" || event.code === "Space" || event.key === " ") {
      event.preventDefault();
      void stopTalk();
    }
  });

  // The Talk button: press and hold with the mouse, a finger or a pen, or hold Space or Enter on it.
  el.talkButton.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    el.talkButton.setPointerCapture(event.pointerId);
    void startTalk("button");
  });
  for (const type of ["pointerup", "pointercancel"] as const) {
    el.talkButton.addEventListener(type, () => {
      if (talk?.source === "button") void stopTalk();
    });
  }
  el.talkButton.addEventListener("keydown", (event) => {
    if (event.ctrlKey || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    if (!event.repeat) void startTalk("button-key");
  });
  el.talkButton.addEventListener("keyup", (event) => {
    if (talk?.source !== "button-key" || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    void stopTalk();
  });

  window.addEventListener("blur", () => cancelTalk(VOICE_TEXT.lostFocus));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") cancelTalk(VOICE_TEXT.lostFocus);
  });

  el.input.addEventListener("input", () => {
    // Everything that came from talking was deleted: what is typed now isn't a voice message.
    if (!el.input.value.trim()) fromVoice = false;
  });
  el.stopSpeaking.addEventListener("click", () => speaker.stop());

  // The download: the main process asks first in its own box, then fetches and checks the file.
  async function download(): Promise<void> {
    if (downloading) return;
    downloading = true;
    show(VOICE_TEXT.asking);
    const poll = setInterval(() => void refreshStatus(), DOWNLOAD_POLL_MS);
    let result: DownloadResult;
    try {
      result = await sage.downloadVoice();
    } catch {
      result = { status: "failed", message: VOICE_TEXT.downloadFailed };
    } finally {
      clearInterval(poll);
      downloading = false;
    }
    if (result.status === "done") {
      ready = true;
      show(VOICE_TEXT.ready);
    } else if (result.status === "declined") {
      show(VOICE_TEXT.declined, { download: "Download" });
    } else if (result.status === "cancelled") {
      show(VOICE_TEXT.cancelled, { download: "Try again" });
    } else {
      show(result.message, { download: "Try again" });
    }
  }
  el.voiceDownload.addEventListener("click", () => void download());
  el.voiceCancel.addEventListener("click", () => void sage.cancelVoiceDownload().catch(() => undefined));

  void refreshStatus();

  return {
    reset() {
      cancelTalk("");
      generation++;
      speaker.stop();
    },
    takeFromVoice() {
      const taken = fromVoice;
      fromVoice = false;
      return taken;
    },
    replied(reply, spoken, setting) {
      if (!talk && shouldSpeak(setting, spoken)) speaker.speak(reply);
    },
  };
}
