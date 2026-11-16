import { type DownloadResult, MAX_MESSAGE_CHARS, type PublicSettings, type SageApi } from "../shared/api.js";
import { Recording, Speaker, toPcm16k } from "./voice.js";
import {
  appendTranscript,
  MAX_RECORDING_MS,
  MIN_RECORDING_MS,
  micErrorMessage,
  shouldSpeak,
  VOICE_TEXT,
} from "./voice-text.js";

// Hold Ctrl+Space (while Sage's window is focused and Chat is open) or hold the Talk button to record. On release
// the recording is turned into plain 16 kHz sound, sent once to the main process, and the words
// are put in the message box: never sent by themselves. The microphone is open only while held,
// and closes on release, when the window loses focus or is hidden, and on New chat.

export interface VoiceElements {
  /** The Chat view: the talk key works only while it is shown. */
  chatView: HTMLElement;
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
  /**
   * True from pressing a key that starts a recording until that key is let go, even after the
   * recording itself has stopped: a held Enter must not go on to send the words it just dictated.
   */
  holdingTalkKey(): boolean;
  /** Reads Sage's final reply aloud if the setting says so; never while Sage is listening. */
  replied(reply: string, fromVoice: boolean, setting: PublicSettings["speakReplies"]): void;
  /** Reads Sage's own text (the daily brief) aloud; never while Sage is listening. */
  speak(text: string): void;
}

type TalkSource = "key" | "button" | "button-key";
interface Talk {
  source: TalkSource;
  /** For a recording held from the keyboard on the Talk button: the key that started it. */
  key?: string;
  startedAt: number;
  recording: Recording | null;
  timer: ReturnType<typeof setInterval>;
  cap: ReturnType<typeof setTimeout>;
}

/** How often the window asks how far the download has got. */
const DOWNLOAD_POLL_MS = 500;

/** What voice is doing, for the orb: the microphone is open, or a reply is being read aloud. */
export type VoiceActivity = { listening: boolean } | { speaking: boolean };

/** Sets up voice in the window: keys, the Talk button, the download offer and spoken replies. */
export function createVoiceControls(
  sage: SageApi,
  el: VoiceElements,
  synth: SpeechSynthesis | undefined,
  onActivity: (change: VoiceActivity) => void = () => {},
): VoiceControls {
  let talk: Talk | null = null;
  /** Goes up on New chat; a transcript for an older chat is dropped. */
  let generation = 0;
  let working = false;
  let downloading = false;
  let ready = false;
  let fromVoice = false;
  /** The key (or "ctrl-space") pressed to start a recording, until it is let go. */
  let heldKey: string | null = null;

  const speaker = new Speaker(synth, (current) => {
    el.stopSpeaking.hidden = !current.speaking;
    onActivity({ speaking: current.speaking });
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
    onActivity({ listening: active });
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

  async function startTalk(source: TalkSource, key?: string): Promise<void> {
    // Sage never hears itself: talking stops any reply being read aloud.
    speaker.stop();
    if (talk) return;
    if (working) {
      show(VOICE_TEXT.stillWorking);
      return;
    }
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
      ...(key ? { key } : {}),
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
      const combined = appendTranscript(el.input.value, result.text);
      if (combined.length > MAX_MESSAGE_CHARS) {
        // Setting the value directly skips the box's own limit; the draft is kept as it is.
        show(VOICE_TEXT.tooLong);
        return;
      }
      el.input.value = combined;
      fromVoice = true;
      show("");
      el.input.focus();
    } catch {
      if (mine === generation) show(VOICE_TEXT.badRecording);
    } finally {
      working = false;
      // A job dropped by New chat: if the talk key was pressed while it ran, its "still working"
      // line would otherwise stay. Nothing else is running now (one job at a time).
      if (mine !== generation && el.voiceStatus.textContent === VOICE_TEXT.stillWorking) show("");
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
    // Only on the Chat screen: not behind Settings or the Welcome screen.
    if (!isTalkKey(event) || el.chatView.hidden) return;
    event.preventDefault();
    if (event.repeat) return;
    heldKey = "ctrl-space";
    void startTalk("key");
  });
  // Letting go is watched on the whole page, so it works wherever the focus has moved meanwhile.
  document.addEventListener("keyup", (event) => {
    if (
      heldKey === "ctrl-space"
        ? event.key === "Control" || event.code === "Space" || event.key === " "
        : event.key === heldKey
    ) {
      heldKey = null;
    }
    const stops =
      talk?.source === "key"
        ? // Letting go of either key stops it.
          event.key === "Control" || event.code === "Space" || event.key === " "
        : talk?.source === "button-key" && event.key === talk.key;
    if (!stops) return;
    event.preventDefault();
    void stopTalk();
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
    if (event.repeat) return;
    heldKey = event.key;
    void startTalk("button-key", event.key);
  });
  // Held from the keyboard and the focus moves away (Tab, or a reply focusing the message box): it
  // stops there, and what was said so far is worked out.
  el.talkButton.addEventListener("blur", () => {
    if (talk?.source === "button-key") void stopTalk();
  });

  // Key releases aren't seen while another window has the focus, so a held key is forgotten here.
  window.addEventListener("blur", () => {
    heldKey = null;
    cancelTalk(VOICE_TEXT.lostFocus);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    heldKey = null;
    cancelTalk(VOICE_TEXT.lostFocus);
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
      // The status line goes (a download keeps its progress line). The message box keeps its text,
      // so the mark that some of it came from talking stays until the box is emptied or sent.
      if (!downloading) show("");
    },
    holdingTalkKey() {
      return heldKey !== null;
    },
    takeFromVoice() {
      const taken = fromVoice;
      fromVoice = false;
      return taken;
    },
    replied(reply, spoken, setting) {
      if (!talk && shouldSpeak(setting, spoken)) speaker.speak(reply);
    },
    speak(text) {
      if (!talk) speaker.speak(text);
    },
  };
}
