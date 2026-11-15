import { z } from "zod";
import { checkAppEntry, describeLaunch, findApp, type Launcher } from "../apps.js";
import { resolveApprovedFile } from "../files.js";
import { MAX_NOTE_TEXT, MAX_NOTE_TITLE, type NotesStore } from "../notes.js";
import { MAX_REMINDER_TEXT, type RemindersStore } from "../reminders.js";
import type { SearchProvider } from "../search/search.js";
import type { Settings } from "../settings.js";
import { plainPath, plainText } from "./display.js";
import { defineSkill, NotWanted, type Skill } from "./registry.js";

/** Opens a file with its default app. In the app: Electron shell.openPath (returns "" on success). */
export type PathOpener = (path: string) => Promise<string>;

export interface BuiltinDeps {
  notes: NotesStore;
  reminders: RemindersStore;
  search: SearchProvider;
  settings: () => Promise<Settings>;
  openPath: PathOpener;
  launch: Launcher;
  now: () => Date;
  platform?: NodeJS.Platform;
}

const id = z.string().trim().min(1).max(64);

export function builtinSkills(deps: BuiltinDeps): Skill[] {
  const when = (iso: string) => new Date(iso).toLocaleString();

  return [
    defineSkill({
      name: "answer",
      description: "Reply to the user in plain words. Use this when no other skill is needed.",
      risk: "safe",
      args: z.strictObject({ text: z.string().min(1).max(20_000) }),
      run: async ({ text }) => ({ text, final: true }),
    }),

    defineSkill({
      name: "web_search",
      description: "Search the web. Returns titles, links and short snippets from the results page.",
      risk: "safe",
      untrustedSource: "web_search",
      args: z.strictObject({ query: z.string().trim().min(1).max(300) }),
      run: async ({ query }) => {
        const outcome = await deps.search.search(query);
        if (!outcome.ok) return { text: outcome.message };
        if (outcome.results.length === 0) return { text: `No results for "${query}".` };
        const lines = outcome.results.map(
          (result, i) => `${i + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet}`,
        );
        return { text: `Results for "${query}" from ${deps.search.name}:\n${lines.join("\n")}` };
      },
    }),

    defineSkill({
      name: "list_notes",
      description: "List the user's notes (id, title and when each was last changed).",
      risk: "safe",
      untrustedSource: "notes",
      args: z.strictObject({}),
      run: async () => {
        const notes = await deps.notes.list();
        if (notes.length === 0) return { text: "There are no notes yet." };
        return {
          text: notes.map((note) => `- ${note.id}: ${note.title} (changed ${when(note.updated)})`).join("\n"),
        };
      },
    }),

    defineSkill({
      name: "read_note",
      description: "Read one note by its id (from list_notes).",
      risk: "safe",
      untrustedSource: "notes",
      args: z.strictObject({ id }),
      run: async (args) => {
        const note = await deps.notes.get(args.id);
        if (!note) return { text: `There's no note with the id ${args.id}.` };
        return { text: `${note.title}\n\n${note.text}` };
      },
    }),

    defineSkill({
      name: "add_note",
      description: "Save a new note for the user.",
      risk: "safe",
      args: z.strictObject({
        title: z.string().trim().min(1).max(MAX_NOTE_TITLE),
        text: z.string().max(MAX_NOTE_TEXT),
      }),
      run: async ({ title, text }) => {
        const note = await deps.notes.add(title, text);
        return { text: `Saved the note "${note.title}" (id ${note.id}).` };
      },
    }),

    defineSkill({
      name: "delete_note",
      description: "Delete one note by its id (from list_notes).",
      risk: "confirm",
      args: z.strictObject({ id }),
      prepare: async (args) => {
        const note = await deps.notes.get(args.id);
        if (!note) return { ok: false, message: `There's no note with the id ${args.id}.` };
        return { ok: true, summary: `Delete the note "${plainText(note.title)}". This can't be undone.` };
      },
      run: async (args) => {
        const removed = await deps.notes.remove(args.id);
        if (!removed) throw new Error("the note was already gone");
        return { text: "Deleted the note." };
      },
    }),

    defineSkill({
      name: "list_reminders",
      description: "List the user's reminders that haven't gone off yet.",
      risk: "safe",
      untrustedSource: "reminders",
      args: z.strictObject({}),
      run: async () => {
        const pending = (await deps.reminders.list()).filter((reminder) => reminder.firedAt === null);
        if (pending.length === 0) return { text: "There are no upcoming reminders." };
        return {
          text: pending
            .map((reminder) => `- ${reminder.id}: ${reminder.text} (due ${when(reminder.due)})`)
            .join("\n"),
        };
      },
    }),

    defineSkill({
      name: "add_reminder",
      description:
        "Set a reminder. `due` is a date and time in ISO 8601 format, such as 2026-11-16T09:00:00 (local time) or with a time zone offset.",
      risk: "safe",
      args: z.strictObject({
        text: z.string().trim().min(1).max(MAX_REMINDER_TEXT),
        due: z.string().trim().min(10).max(40),
      }),
      run: async ({ text, due }) => {
        const at = parseDue(due);
        if (!at) return { text: `"${due}" isn't a date and time Sage understands. Use ISO 8601.` };
        const now = deps.now().getTime();
        if (at.getTime() < now - 60_000) return { text: "That time has already passed. Pick a later one." };
        if (at.getTime() > now + 5 * 365 * 24 * 3600_000)
          return { text: "That's too far ahead. Pick a nearer date." };
        const reminder = await deps.reminders.add(text, at);
        return {
          text: `Okay, I'll remind you "${reminder.text}" at ${when(reminder.due)} (id ${reminder.id}).`,
        };
      },
    }),

    defineSkill({
      name: "delete_reminder",
      description: "Delete one reminder by its id (from list_reminders).",
      risk: "confirm",
      args: z.strictObject({ id }),
      prepare: async (args) => {
        const reminder = await deps.reminders.get(args.id);
        if (!reminder) return { ok: false, message: `There's no reminder with the id ${args.id}.` };
        return {
          ok: true,
          summary: `Delete the reminder "${plainText(reminder.text)}" (due ${when(reminder.due)}).`,
        };
      },
      run: async (args) => {
        const removed = await deps.reminders.remove(args.id);
        if (!removed) throw new Error("the reminder was already gone");
        return { text: "Deleted the reminder." };
      },
    }),

    defineSkill({
      name: "open_app",
      description: "Open one of the apps on the user's list in Settings, by its name.",
      risk: "confirm",
      args: z.strictObject({ name: z.string().trim().min(1).max(60) }),
      prepare: async ({ name }) => {
        const settings = await deps.settings();
        const app = findApp(settings.apps, name);
        if (!app) {
          const names = settings.apps.map((a) => `"${a.name}"`).join(", ") || "none yet";
          return {
            ok: false,
            message: `"${name}" isn't on the app list in Settings. The list is: ${names}.`,
          };
        }
        const problem = await checkAppEntry(app, deps.platform);
        if (problem) return { ok: false, message: problem };
        // The exact program and arguments become part of the approval.
        return {
          ok: true,
          summary: describeLaunch(app),
          action: { name: app.name, path: app.path, args: [...app.args] },
        };
      },
      // Launches exactly the approved program; it never looks the name up again.
      run: async (_args, action) => {
        if (!action) throw new Error("there is no approved program to open");
        await deps.launch(action.path, action.args);
        return { text: `Opened ${plainText(action.name)}.` };
      },
    }),

    defineSkill({
      name: "open_file",
      description: "Open a file with its default app. Only files inside the folders approved in Settings.",
      risk: "confirm",
      args: z.strictObject({ path: z.string().trim().min(1).max(1000) }),
      prepare: async ({ path }) => {
        const check = await resolveApprovedFile(path, (await deps.settings()).folders);
        if (!check.ok) return check;
        return {
          ok: true,
          summary: `Open the file ${plainPath(check.path)} with its default app.`,
          action: { path: check.path },
        };
      },
      // Opens exactly the approved real path, after checking it is still an approved file.
      run: async (_args, action, stillWanted) => {
        if (!action) throw new Error("there is no approved file to open");
        const check = await resolveApprovedFile(action.path, (await deps.settings()).folders);
        if (!check.ok) throw new Error(check.message);
        if (check.path !== action.path) throw new Error("the file changed after it was approved");
        // The checks above awaited; don't open anything for a conversation that was stopped meanwhile.
        if (!stillWanted()) throw new NotWanted();
        const error = await deps.openPath(action.path);
        if (error) throw new Error(error);
        return { text: `Opened ${plainPath(action.path)}.` };
      },
    }),
  ];
}

const ISO_DUE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/i;

function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

/**
 * Accepts ISO 8601 with or without a time zone (without one means local time). Impossible dates
 * and times, such as 2027-02-30 or 25:00, are refused instead of rolling over into the next month.
 */
export function parseDue(text: string): Date | null {
  const match = ISO_DUE.exec(text);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map((part) => Number(part ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const zone = match[7];
  if (zone && !/^z$/i.test(zone)) {
    const [, zh = "", zm = ""] = /^[+-](\d{2}):?(\d{2})$/.exec(zone) ?? [];
    if (Number(zh) > 14 || Number(zm) > 59) return null;
  }
  const date = new Date(text.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}
