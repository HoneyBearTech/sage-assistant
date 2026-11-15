import { z } from "zod";
import { serviceOrigin } from "../core/brain/online.js";
import { describeError } from "../core/log.js";
import type { Sage } from "../core/sage.js";
import type { Settings } from "../core/settings.js";
import { CHANNELS, type Channel, MAX_ACK_IDS, type PublicSettings, type Result } from "../shared/api.js";

/** Native pickers, supplied by the main process (Electron's dialog module). */
export interface Pickers {
  chooseFolder(): Promise<string | null>;
  chooseApp(): Promise<string | null>;
}

export type Handler = (payload: unknown) => Promise<unknown>;

const sendPayload = z.strictObject({ text: z.string().trim().min(1).max(8_000) });
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

export const SAVE_SETTINGS_FIRST = "Save settings first, then save the key.";

export function toPublicSettings(settings: Settings, hasKey: boolean): PublicSettings {
  return {
    brain: settings.brain,
    local: { model: settings.local.model },
    online: { baseUrl: settings.online.baseUrl, model: settings.online.model, hasKey },
    apps: settings.apps.map((app) => ({ name: app.name, path: app.path, args: [...app.args] })),
    folders: [...settings.folders],
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
      const previous = await sage.settings.load();
      const result = await sage.settings.save({ ...(payload as object), version: 1 });
      if (!result.ok) return fail(result.message);
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
  };
}
