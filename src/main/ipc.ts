import { z } from "zod";
import { serviceOrigin } from "../core/brain/online.js";
import { describeError } from "../core/log.js";
import type { Sage } from "../core/sage.js";
import type { Settings } from "../core/settings.js";
import {
  CHANNELS,
  type Channel,
  MAX_ACK_IDS,
  MAX_MESSAGE_CHARS,
  MAX_VOICE_SAMPLES,
  MODEL_CHOICES,
  type PublicSettings,
  type PullResult,
  type Result,
  type TranscribeResult,
} from "../shared/api.js";

/** Native pickers, supplied by the main process (Electron's dialog module). */
export interface Pickers {
  chooseFolder(): Promise<string | null>;
  chooseApp(): Promise<string | null>;
}

export type Handler = (payload: unknown) => Promise<unknown>;

const sendPayload = z.strictObject({ text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS) });
const keyPayload = z.strictObject({
  key: z.string().min(1).max(1_000),
  // The address on screen when Save key was pressed; checked against the saved one.
  baseUrl: z.string().trim().max(500),
});

// Notice ids are short (see NoticeBoard). The window sends at most MAX_ACK_IDS per call, in
// batches, since confirmations can pile up while the Chat view is hidden.
const ackPayload = z.strictObject({
  ids: z.array(z.string().min(1).max(32)).max(MAX_ACK_IDS),
});

// One recording: 16-bit samples, 16 kHz mono, not empty and at most 30 seconds. The type and the
// sizes are checked before a single sample is read or copied; a view onto a bigger buffer is
// refused too, so nothing larger than one recording is ever held on to.
const transcribePayload = z.strictObject({
  pcm: z
    .instanceof(Int16Array)
    .refine(
      (pcm) =>
        pcm.length > 0 && pcm.length <= MAX_VOICE_SAMPLES && pcm.buffer.byteLength <= MAX_VOICE_SAMPLES * 2,
      "bad recording",
    ),
});

// The window picks one of Sage's two models; it never sends a model name.
const pullPayload = z.strictObject({ choice: z.enum(MODEL_CHOICES) });

export const BAD_RECORDING = "Sage couldn't read that recording. Try again.";

export const SAVE_SETTINGS_FIRST = "Save settings first, then save the key.";

export function toPublicSettings(settings: Settings, hasKey: boolean): PublicSettings {
  return {
    brain: settings.brain,
    local: { model: settings.local.model },
    online: { baseUrl: settings.online.baseUrl, model: settings.online.model, hasKey },
    apps: settings.apps.map((app) => ({ name: app.name, path: app.path, args: [...app.args] })),
    folders: [...settings.folders],
    speakReplies: settings.speakReplies,
    setupDone: settings.setupDone,
  };
}

/**
 * The main-process side of every channel. Each payload is validated here; the window is treated
 * as untrusted input like everything else. main.ts checks the sender before calling these.
 */
export function createIpcHandlers(sage: Sage, pickers: Pickers): Record<Channel, Handler> {
  const fail = (message: string): Result => ({ ok: false, message });
  return {
    [CHANNELS.send]: async (payload) => {
      const parsed = sendPayload.safeParse(payload);
      if (!parsed.success) return "Sage couldn't read that message.";
      try {
        return await sage.assistant.send(parsed.data.text);
      } catch (error) {
        sage.logger.error("A chat turn failed", error);
        return "Something went wrong. Try again.";
      }
    },
    [CHANNELS.reset]: async () => {
      sage.assistant.reset();
    },
    [CHANNELS.getSettings]: async () =>
      toPublicSettings(await sage.settings.load(), await sage.keyStore.has()),
    [CHANNELS.saveSettings]: async (payload): Promise<Result> => {
      // The Settings screen saves everything it shows; "set up" isn't one of them, so the saved
      // value is kept (read and written under the settings lock).
      const result = await sage.settings.update((current) => ({
        ...(payload as object),
        version: 1,
        setupDone: current.setupDone,
      }));
      if (!result.ok) return fail(result.message);
      const previous = result.previous;
      const after = serviceOrigin(result.settings.online.baseUrl);
      // A turn in progress was started against the old brain or service; it stops rather than
      // carry on against settings the user has moved away from.
      if (previous.brain !== result.settings.brain || serviceOrigin(previous.online.baseUrl) !== after) {
        sage.assistant.stopTurn();
      }
      // A saved key belongs to the service it was entered for. If the address now points at a
      // different service, the key is removed so it is never sent there.
      if ((await sage.keyStore.afterAddressSaved(after)) === "removed") {
        return {
          ok: true,
          message:
            "The online service's address changed, so the saved key was removed. Enter the key for the new service again.",
        };
      }
      return { ok: true };
    },
    [CHANNELS.setKey]: async (payload): Promise<Result> => {
      const parsed = keyPayload.safeParse(payload);
      if (!parsed.success) return fail("That doesn't look like a key.");
      try {
        // The key belongs to the service whose address is saved now (or, if none is saved yet, to
        // the first address saved after it). The user typed it for the address on screen, so if
        // that isn't the saved one, nothing is stored: the key would otherwise be tied to a
        // service it wasn't entered for.
        const origin = serviceOrigin((await sage.settings.load()).online.baseUrl);
        if (serviceOrigin(parsed.data.baseUrl) !== origin) return fail(SAVE_SETTINGS_FIRST);
        await sage.keyStore.set(parsed.data.key, origin);
        return { ok: true };
      } catch (error) {
        return fail(describeError(error));
      }
    },
    [CHANNELS.clearKey]: async (): Promise<Result> => {
      await sage.keyStore.clear();
      return { ok: true };
    },
    [CHANNELS.chooseFolder]: () => pickers.chooseFolder(),
    [CHANNELS.chooseApp]: () => pickers.chooseApp(),
    // Handing a notice out doesn't make it delivered; the window's confirmation does.
    [CHANNELS.takeNotices]: () => sage.notices.take(),
    [CHANNELS.ackNotices]: async (payload) => {
      const parsed = ackPayload.safeParse(payload);
      if (parsed.success) await sage.notices.ack(parsed.data.ids);
    },
    [CHANNELS.voiceStatus]: () => sage.voice.status(),
    // The main process asks the user first, in its own box; the window can only ask for it.
    [CHANNELS.downloadVoice]: () => sage.voice.downloadModel(),
    [CHANNELS.cancelVoiceDownload]: async () => {
      sage.voice.cancelDownload();
    },
    [CHANNELS.transcribe]: async (payload): Promise<TranscribeResult> => {
      const parsed = transcribePayload.safeParse(payload);
      if (!parsed.success) return { ok: false, message: BAD_RECORDING };
      try {
        return await sage.voice.transcribe(parsed.data.pcm);
      } catch (error) {
        // The error is about the helper or the engine; never the sound or the words.
        sage.logger.error("A recording couldn't be turned into text", error);
        return { ok: false, message: "Sage couldn't work out what you said. Try again." };
      }
    },
    [CHANNELS.runnerStatus]: () => sage.setup.status(),
    // The main process asks the user first, in its own box; the window can only ask for it.
    [CHANNELS.pullModel]: async (payload): Promise<PullResult> => {
      const parsed = pullPayload.safeParse(payload);
      if (!parsed.success) return { status: "failed", message: "Sage couldn't read that choice." };
      return sage.setup.pullModel(parsed.data.choice);
    },
    [CHANNELS.pullStatus]: async () => sage.setup.pullStatus(),
    [CHANNELS.cancelPull]: async () => sage.setup.cancelPull(),
    // Asks first, then opens the one fixed address; nothing from the window is used.
    [CHANNELS.openInstallGuide]: () => sage.setup.openInstallGuide(),
    [CHANNELS.finishSetup]: () => sage.setup.finish(),
  };
}
