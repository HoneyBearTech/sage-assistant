import { z } from "zod";
import { describeError } from "../core/log.js";
import type { Sage } from "../core/sage.js";
import type { Settings } from "../core/settings.js";
import { CHANNELS, type Channel, type PublicSettings, type Result } from "../shared/api.js";

/** Native pickers, supplied by the main process (Electron's dialog module). */
export interface Pickers {
  chooseFolder(): Promise<string | null>;
  chooseApp(): Promise<string | null>;
}

export type Handler = (payload: unknown) => Promise<unknown>;

const sendPayload = z.strictObject({ text: z.string().trim().min(1).max(8_000) });
const keyPayload = z.strictObject({ key: z.string().min(1).max(1_000) });

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
      const result = await sage.settings.save({ ...(payload as object), version: 1 });
      return result.ok ? { ok: true } : fail(result.message);
    },
    [CHANNELS.setKey]: async (payload): Promise<Result> => {
      const parsed = keyPayload.safeParse(payload);
      if (!parsed.success) return fail("That doesn't look like a key.");
      try {
        await sage.keyStore.set(parsed.data.key);
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
  };
}
