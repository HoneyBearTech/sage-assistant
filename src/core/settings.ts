import { join } from "node:path";
import { z } from "zod";
import { BRAINS, SAGE_MODELS } from "../shared/api.js";
import { SERVICES } from "./brain/services.js";
import { type CorruptFileHandler, readJson, writeJsonAtomic } from "./json-file.js";
import type { Logger } from "./log.js";
import { Serial } from "./serial.js";

/** A small model that can use tools and runs on most PCs: the Standard one of Sage's two. */
export const DEFAULT_LOCAL_MODEL = SAGE_MODELS.standard.name;

/** The choices for "Read replies aloud". */
export const SPEAK_REPLIES = ["voice", "always", "never"] as const;

/** The window's look: the dark "sage HUD" (the default), a light version, or whatever the system uses. */
export const THEMES = ["dark", "light", "system"] as const;

export const appEntrySchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** The full path to the program. */
  path: z.string().trim().min(1).max(1000),
  /** Fixed arguments, passed as a list (never through a shell). */
  args: z.array(z.string().max(500)).max(20).default([]),
});
export type AppEntry = z.infer<typeof appEntrySchema>;

function serviceModel(model: string) {
  return z.object({ model: z.string().trim().max(200).default(model) }).default({ model });
}

/**
 * Everything in settings.json. There is deliberately no field for any key: they live in
 * the key store, encrypted. Unknown fields (a key pasted in by hand, say) are dropped on save.
 */
export const settingsSchema = z.object({
  version: z.literal(1).default(1),
  /**
   * Where Sage thinks: on this computer, a ready-made online service, or another online service.
   * Before there was a list, the one online choice was saved as "online": it loads as "other", with
   * the same address, model and key. Added without a new version.
   */
  brain: z.preprocess((value) => (value === "online" ? "other" : value), z.enum(BRAINS)).default("local"),
  local: z
    .object({ model: z.string().trim().min(1).max(200).default(DEFAULT_LOCAL_MODEL) })
    .default({ model: DEFAULT_LOCAL_MODEL }),
  online: z
    .object({
      baseUrl: z.string().trim().max(500).default(""),
      model: z.string().trim().max(200).default(""),
    })
    .default({ baseUrl: "", model: "" }),
  /**
   * The model of each ready-made online service (their addresses are fixed in the code). Added
   * without a new version: a settings file saved before it existed loads with the defaults.
   */
  services: z
    .object({
      claude: serviceModel(SERVICES.claude.defaultModel),
      openai: serviceModel(SERVICES.openai.defaultModel),
      gemini: serviceModel(SERVICES.gemini.defaultModel),
    })
    .default(() => ({
      claude: { model: SERVICES.claude.defaultModel },
      openai: { model: SERVICES.openai.defaultModel },
      gemini: { model: SERVICES.gemini.defaultModel },
    })),
  apps: z
    .array(appEntrySchema)
    .max(100)
    .default([])
    .refine(
      (apps) => new Set(apps.map((app) => app.name.toLowerCase())).size === apps.length,
      "Each app needs a different name",
    ),
  folders: z.array(z.string().trim().min(1).max(1000)).max(50).default([]),
  /**
   * Read replies aloud: after voice messages (the default), always, or never. Added without a new
   * version: a settings file saved before it existed loads unchanged, with the default.
   */
  speakReplies: z.enum(SPEAK_REPLIES).default("voice"),
  /**
   * The Welcome screen was finished or skipped, so it isn't shown at start-up. Added without a new
   * version: a settings file saved before it existed loads unchanged, and shows the Welcome screen
   * once. Changed only by the Welcome screen's own requests, never by a Settings save.
   */
  setupDone: z.boolean().default(false),
  /**
   * The window's look. Added without a new version: a settings file saved before it existed loads
   * unchanged, with the dark look.
   */
  theme: z.enum(THEMES).default("dark"),
  /**
   * Short sound effects in the window (a blip on send, a tone when Sage asks). Off unless switched on
   * in the top bar. Added without a new version, like `theme`. Changed only by the top bar's switch,
   * never by a Settings save.
   */
  sound: z.boolean().default(false),
});
export type Settings = z.infer<typeof settingsSchema>;

export function defaultSettings(): Settings {
  return settingsSchema.parse({});
}

export class SettingsStore {
  private readonly path: string;
  private readonly serial = new Serial();

  constructor(
    dataDir: string,
    private readonly logger: Logger,
    private readonly onCorrupt?: CorruptFileHandler,
  ) {
    this.path = join(dataDir, "settings.json");
  }

  load(): Promise<Settings> {
    return this.serial.run(() => this.read());
  }

  private async read(): Promise<Settings> {
    const result = await readJson(this.path, settingsSchema);
    if (result.status === "ok") return result.value;
    if (result.status === "invalid") {
      this.logger.warn(`settings.json couldn't be read; it was kept as ${result.movedTo}`);
      this.onCorrupt?.(result.movedTo);
    }
    return defaultSettings();
  }

  /** Validates and saves. Returns the saved settings, or the reason they were refused. */
  save(input: unknown): Promise<{ ok: true; settings: Settings } | { ok: false; message: string }> {
    return this.serial.run(async () => {
      const result = settingsSchema.safeParse(input);
      if (!result.success) return { ok: false, message: z.prettifyError(result.error) };
      await writeJsonAtomic(this.path, result.data);
      return { ok: true, settings: result.data };
    });
  }

  /**
   * Loads, changes and saves in one step, under the same lock as every other load and save, so
   * two changes never overwrite each other. `change` gets the saved settings and returns the new
   * ones, which are validated like any save. Returns the settings before and after.
   */
  update(
    change: (current: Settings) => unknown,
  ): Promise<{ ok: true; settings: Settings; previous: Settings } | { ok: false; message: string }> {
    return this.serial.run(async () => {
      const previous = await this.read();
      const result = settingsSchema.safeParse(change(structuredClone(previous)));
      if (!result.success) return { ok: false, message: z.prettifyError(result.error) };
      await writeJsonAtomic(this.path, result.data);
      return { ok: true, settings: result.data, previous };
    });
  }
}
