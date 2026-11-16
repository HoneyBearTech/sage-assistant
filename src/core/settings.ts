import { join } from "node:path";
import { z } from "zod";
import { SAGE_MODELS } from "../shared/api.js";
import { type CorruptFileHandler, readJson, writeJsonAtomic } from "./json-file.js";
import type { Logger } from "./log.js";
import { Serial } from "./serial.js";

/** A small model that can use tools and runs on most PCs: the Standard one of Sage's two. */
export const DEFAULT_LOCAL_MODEL = SAGE_MODELS.standard.name;

/** The choices for "Read replies aloud". */
export const SPEAK_REPLIES = ["voice", "always", "never"] as const;

export const appEntrySchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** The full path to the program. */
  path: z.string().trim().min(1).max(1000),
  /** Fixed arguments, passed as a list (never through a shell). */
  args: z.array(z.string().max(500)).max(20).default([]),
});
export type AppEntry = z.infer<typeof appEntrySchema>;

/**
 * Everything in settings.json. There is deliberately no field for the online key: it lives in
 * the key store, encrypted. Unknown fields (a key pasted in by hand, say) are dropped on save.
 */
export const settingsSchema = z.object({
  version: z.literal(1).default(1),
  brain: z.enum(["local", "online"]).default("local"),
  local: z
    .object({ model: z.string().trim().min(1).max(200).default(DEFAULT_LOCAL_MODEL) })
    .default({ model: DEFAULT_LOCAL_MODEL }),
  online: z
    .object({
      baseUrl: z.string().trim().max(500).default(""),
      model: z.string().trim().max(200).default(""),
    })
    .default({ baseUrl: "", model: "" }),
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
