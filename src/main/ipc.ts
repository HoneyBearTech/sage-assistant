import { z } from "zod";
import { serviceOrigin } from "../core/brain/online.js";
import { validateKey } from "../core/keystore.js";
import { describeError } from "../core/log.js";
import type { Sage } from "../core/sage.js";
import type { Settings } from "../core/settings.js";
import {
  CHANNELS,
  COMPANIES,
  type Channel,
  type GuideResult,
  type HomeSummary,
  type ModelListResult,
  ONLINE_BRAINS,
  privacyLine,
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
  // Which brain the key is for: a closed list.
  brain: z.enum(ONLINE_BRAINS),
  key: z.string().min(1).max(1_000),
  // For another online service: the address on screen when Save key was pressed; checked against
  // the saved one. Ignored for a ready-made service, whose address is fixed.
  baseUrl: z.string().trim().max(500),
});
const clearKeyPayload = z.strictObject({ brain: z.enum(ONLINE_BRAINS) });
// Load models, Test and Get a key: the window names a company, nothing else.
const companyPayload = z.strictObject({ company: z.enum(COMPANIES) });

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

// The top bar's sound switch: on or off, nothing else.
const soundPayload = z.strictObject({ on: z.boolean() });

// Home's two requests carry nothing: an empty object, and nothing else is accepted.
const emptyPayload = z.strictObject({});

// The window picks one of Sage's two models; it never sends a model name.
const pullPayload = z.strictObject({ choice: z.enum(MODEL_CHOICES) });

export const BAD_RECORDING = "Sage couldn't read that recording. Try again.";

export const SAVE_SETTINGS_FIRST = "Save settings first, then save the key.";

export const NOT_READ = "Sage couldn't read that choice.";

export function toPublicSettings(settings: Settings, keys: PublicSettings["keys"]): PublicSettings {
  return {
    brain: settings.brain,
    local: { model: settings.local.model },
    online: { baseUrl: settings.online.baseUrl, model: settings.online.model },
    services: {
      claude: { model: settings.services.claude.model },
      openai: { model: settings.services.openai.model },
      gemini: { model: settings.services.gemini.model },
    },
    keys: { claude: keys.claude, openai: keys.openai, gemini: keys.gemini, other: keys.other },
    apps: settings.apps.map((app) => ({ name: app.name, path: app.path, args: [...app.args] })),
    folders: [...settings.folders],
    speakReplies: settings.speakReplies,
    setupDone: settings.setupDone,
    theme: settings.theme,
    sound: settings.sound,
    morningBrief: settings.morningBrief,
  };
}

/**
 * The main-process side of every channel. Each payload is validated here; the window is treated
 * as untrusted input like everything else. main.ts checks the sender before calling these.
 */
/** The model name the chosen brain uses: a change to it stops a turn in progress. */
export function activeModel(settings: Settings): string {
  switch (settings.brain) {
    case "local":
      return settings.local.model;
    case "other":
      return settings.online.model;
    default:
      return settings.services[settings.brain].model;
  }
}

export function createIpcHandlers(sage: Sage, pickers: Pickers): Record<Channel, Handler> {
  const fail = (message: string): Result => ({ ok: false, message });
  // A turn in progress was started with the key that was saved then; once the chosen brain's key is
  // replaced or removed, it stops rather than carry on.
  const stopTurnIfActive = async (brain: Settings["brain"]) => {
    if ((await sage.settings.load()).brain === brain) sage.assistant.stopTurn();
  };
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
      toPublicSettings(await sage.settings.load(), await sage.keyStore.hasKeys()),
    [CHANNELS.saveSettings]: async (payload): Promise<Result> => {
      // The Settings screen saves everything it shows; "set up", the sound switch and the day of
      // the last morning brief aren't among them, so their saved values are kept (read and written
      // under the settings lock).
      const result = await sage.settings.update((current) => ({
        ...(payload as object),
        version: 1,
        setupDone: current.setupDone,
        sound: current.sound,
        lastBrief: current.lastBrief,
      }));
      if (!result.ok) return fail(result.message);
      const previous = result.previous;
      const after = serviceOrigin(result.settings.online.baseUrl);
      // A turn in progress was started against the old brain or service; it stops rather than
      // carry on against settings the user has moved away from.
      if (
        previous.brain !== result.settings.brain ||
        serviceOrigin(previous.online.baseUrl) !== after ||
        activeModel(previous) !== activeModel(result.settings)
      ) {
        sage.assistant.stopTurn();
      }
      const notes: string[] = [];
      // An online brain chosen now that wasn't before: one line on what is sent to which company.
      const brain = result.settings.brain;
      if (brain !== "local" && brain !== previous.brain) notes.push(privacyLine(brain));
      // Another online service's key belongs to the service it was entered for. If the address now
      // points at a different service, the key is removed so it is never sent there.
      if ((await sage.keyStore.afterAddressSaved(after)) === "removed") {
        notes.push(
          "The online service's address changed, so the saved key was removed. Enter the key for the new service again.",
        );
      }
      return notes.length ? { ok: true, message: notes.join(" ") } : { ok: true };
    },
    [CHANNELS.setKey]: async (payload): Promise<Result> => {
      const parsed = keyPayload.safeParse(payload);
      if (!parsed.success) return fail("That doesn't look like a key.");
      try {
        const brain = parsed.data.brain;
        // Checked before anything changes, so a key that is refused stops nothing.
        validateKey(parsed.data.key);
        if (brain !== "other") {
          // A turn in progress with the chosen brain stops first, so it can't finish with the old key.
          await stopTurnIfActive(brain);
          // A company's key is bound to that company's fixed address, held in the main process.
          await sage.keyStore.setCompanyKey(brain, parsed.data.key);
          sage.services.forget(brain);
          return { ok: true };
        }
        // Another online service's key belongs to the service whose address is saved now (or, if
        // none is saved yet, to the first address saved after it). The user typed it for the
        // address on screen, so if that isn't the saved one, nothing is stored: the key would
        // otherwise be tied to a service it wasn't entered for.
        const origin = serviceOrigin((await sage.settings.load()).online.baseUrl);
        if (serviceOrigin(parsed.data.baseUrl) !== origin) return fail(SAVE_SETTINGS_FIRST);
        await stopTurnIfActive(brain);
        await sage.keyStore.setOtherKey(parsed.data.key, origin);
        return { ok: true };
      } catch (error) {
        // The key store's own messages (a key that doesn't look right, no system protection).
        return fail(describeError(error));
      }
    },
    [CHANNELS.clearKey]: async (payload): Promise<Result> => {
      const parsed = clearKeyPayload.safeParse(payload);
      if (!parsed.success) return fail(NOT_READ);
      const brain = parsed.data.brain;
      await stopTurnIfActive(brain);
      await sage.keyStore.clear(brain);
      if (brain !== "other") sage.services.forget(brain);
      return { ok: true };
    },
    // Each of these sends only a company's id; the addresses are fixed in the main process, and a
    // key is handed out only for its own company. Errors are Sage's own plain sentences.
    [CHANNELS.listModels]: async (payload): Promise<ModelListResult> => {
      const parsed = companyPayload.safeParse(payload);
      if (!parsed.success) return { ok: false, message: NOT_READ };
      return sage.services.listModels(parsed.data.company);
    },
    [CHANNELS.testKey]: async (payload): Promise<Result> => {
      const parsed = companyPayload.safeParse(payload);
      if (!parsed.success) return fail(NOT_READ);
      return sage.services.testKey(parsed.data.company);
    },
    // Asks first, then opens one of the companies' fixed key pages; nothing else from the window is used.
    [CHANNELS.openKeyPage]: async (payload): Promise<GuideResult> => {
      const parsed = companyPayload.safeParse(payload);
      if (!parsed.success) return { status: "failed", message: NOT_READ, address: "" };
      return sage.services.openKeyPage(parsed.data.company);
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
      if (!parsed.success) return { status: "failed", message: NOT_READ };
      return sage.setup.pullModel(parsed.data.choice);
    },
    [CHANNELS.pullStatus]: async () => sage.setup.pullStatus(),
    [CHANNELS.cancelPull]: async () => sage.setup.cancelPull(),
    // Asks first, then opens the one fixed address; nothing from the window is used.
    [CHANNELS.openInstallGuide]: () => sage.setup.openInstallGuide(),
    [CHANNELS.finishSetup]: () => sage.setup.finish(),
    // Changes only the sound switch, so unsaved changes on the Settings screen are neither saved
    // nor lost.
    [CHANNELS.setSound]: async (payload): Promise<Result> => {
      const parsed = soundPayload.safeParse(payload);
      if (!parsed.success) return fail(NOT_READ);
      const result = await sage.settings.update((current) => ({ ...current, sound: parsed.data.on }));
      return result.ok ? { ok: true } : fail(result.message);
    },
    // Home's summary: read-only and bounded (src/core/home.ts). The request carries nothing.
    [CHANNELS.homeSummary]: async (payload): Promise<HomeSummary> => {
      if (!emptyPayload.safeParse(payload).success) throw new Error(NOT_READ);
      return sage.home.summary();
    },
    // Whether to show the morning brief now; true once a day, when the setting is on.
    [CHANNELS.claimMorningBrief]: async (payload): Promise<boolean> => {
      if (!emptyPayload.safeParse(payload).success) return false;
      return sage.home.claimMorningBrief();
    },
  };
}
