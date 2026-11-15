import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "./json-file.js";
import type { Logger } from "./log.js";
import { Serial } from "./serial.js";

export const MAX_NOTE_TITLE = 200;
export const MAX_NOTE_TEXT = 20_000;

const noteSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  text: z.string(),
  created: z.string(),
  updated: z.string(),
});
export type Note = z.infer<typeof noteSchema>;

const notesFile = z.object({ version: z.literal(1), notes: z.array(noteSchema) });

/** Notes live in one JSON file in Sage's folder in the user's profile, written atomically. */
export class NotesStore {
  private readonly path: string;
  private readonly serial = new Serial();

  constructor(
    dataDir: string,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.path = join(dataDir, "notes.json");
  }

  list(): Promise<Note[]> {
    return this.serial.run(() => this.load());
  }

  async get(id: string): Promise<Note | undefined> {
    return (await this.list()).find((note) => note.id === id);
  }

  add(title: string, text: string): Promise<Note> {
    return this.serial.run(async () => {
      const notes = await this.load();
      const stamp = this.now().toISOString();
      const note: Note = {
        id: randomUUID().slice(0, 8),
        title: title.trim().slice(0, MAX_NOTE_TITLE) || "Untitled",
        text: text.slice(0, MAX_NOTE_TEXT),
        created: stamp,
        updated: stamp,
      };
      notes.push(note);
      await this.save(notes);
      return note;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.serial.run(async () => {
      const notes = await this.load();
      const kept = notes.filter((note) => note.id !== id);
      if (kept.length === notes.length) return false;
      await this.save(kept);
      return true;
    });
  }

  private async load(): Promise<Note[]> {
    const result = await readJson(this.path, notesFile, this.now);
    if (result.status === "ok") return result.value.notes;
    if (result.status === "invalid") {
      this.logger.warn(`notes.json couldn't be read; it was kept as ${result.movedTo}`);
    }
    return [];
  }

  private save(notes: Note[]): Promise<void> {
    return writeJsonAtomic(this.path, { version: 1, notes });
  }
}
