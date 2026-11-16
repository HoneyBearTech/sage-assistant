import {
  type HomeReminder,
  type HomeSummary,
  MAX_HOME_MISSED,
  MAX_HOME_NOTE_TITLE,
  MAX_HOME_NOTES,
  MAX_HOME_REMINDER_TEXT,
  MAX_HOME_REMINDERS,
} from "../shared/api.js";
import type { Note } from "./notes.js";
import type { Reminder } from "./reminders.js";
import type { Settings, SettingsStore } from "./settings.js";

// Home's summary for the window, and the once-a-day mark for the morning brief. The summary is
// read-only and bounded: a few reminders with shortened text, a few note titles (never the notes'
// text) and the status values. "Today" is the PC's own day.

/** Cuts `text` to at most `max` characters (whole characters, never half an emoji), ending in "…". */
export function shorten(text: string, max: number): string {
  const characters = Array.from(text.trim());
  if (characters.length <= max) return characters.join("");
  return `${characters
    .slice(0, max - 1)
    .join("")
    .trimEnd()}…`;
}

/** The start of the PC's own day that `now` falls in, and the start of the next one. */
export function localDay(now: Date): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start, end };
}

/** The PC's own day as YYYY-MM-DD, as the morning brief remembers it. */
export function localDate(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface HomeInputs {
  reminders: readonly Reminder[];
  notes: readonly Note[];
  now: Date;
  brain: Settings["brain"];
  voiceReady: boolean;
  sound: boolean;
}

/**
 * What Home shows. Reminders: those due on the PC's day (shown or still to come; at most
 * MAX_HOME_REMINDERS, keeping the ones still to come first) and those whose time has passed without
 * being shown (`missed`; at most MAX_HOME_MISSED, the newest, with `missedMore` counting the rest),
 * capped separately so old missed ones can never hide what is still to come, then soonest first.
 * `next`: when nothing more is to come today, the first reminder after today that isn't shown yet.
 * Notes: the titles of the MAX_HOME_NOTES most recently changed notes, newest first.
 */
export function homeSummary(input: HomeInputs): HomeSummary {
  const now = input.now.getTime();
  const { start, end } = localDay(input.now);
  const dueAt = (reminder: Reminder) => Date.parse(reminder.due);
  const missed = (reminder: Reminder) => reminder.firedAt === null && dueAt(reminder) <= now;
  const toHome = (reminder: Reminder): HomeReminder => ({
    id: reminder.id,
    text: shorten(reminder.text, MAX_HOME_REMINDER_TEXT),
    due: new Date(dueAt(reminder)).toISOString(),
    missed: missed(reminder),
  });
  const valid = input.reminders.filter((reminder) => Number.isFinite(dueAt(reminder)));
  const soonest = (a: Reminder, b: Reminder) => dueAt(a) - dueAt(b);
  const latest = (a: Reminder, b: Reminder) => dueAt(b) - dueAt(a);
  const allMissed = valid.filter(missed).sort(latest);
  const today = valid.filter((reminder) => {
    const due = dueAt(reminder);
    return !missed(reminder) && due >= start.getTime() && due < end.getTime();
  });
  // Still to come today, soonest first; then the ones already shown today, the latest first.
  const toComeToday = today.filter((reminder) => dueAt(reminder) > now).sort(soonest);
  const shownToday = today.filter((reminder) => dueAt(reminder) <= now).sort(latest);
  const kept = [
    ...allMissed.slice(0, MAX_HOME_MISSED),
    ...[...toComeToday, ...shownToday].slice(0, MAX_HOME_REMINDERS),
  ].sort(soonest);
  const toCome = toComeToday.length > 0;
  const later = valid
    .filter((reminder) => reminder.firedAt === null && dueAt(reminder) >= end.getTime())
    .sort((a, b) => dueAt(a) - dueAt(b));
  const next = toCome ? undefined : later[0];
  const notes = [...input.notes]
    .sort((a, b) => timeOf(b.updated) - timeOf(a.updated))
    .slice(0, MAX_HOME_NOTES)
    .map((note) => shorten(note.title, MAX_HOME_NOTE_TITLE) || "Untitled");
  return {
    reminders: kept.map(toHome),
    missedMore: Math.max(0, allMissed.length - MAX_HOME_MISSED),
    next: next ? toHome(next) : null,
    notes,
    status: { brain: input.brain, voiceReady: input.voiceReady, sound: input.sound },
  };
}

function timeOf(stamp: string): number {
  const time = Date.parse(stamp);
  return Number.isFinite(time) ? time : 0;
}

export interface HomeDeps {
  reminders: { list(): Promise<Reminder[]> };
  notes: { list(): Promise<Note[]> };
  settings: Pick<SettingsStore, "load" | "update">;
  voiceReady: () => Promise<boolean>;
  now: () => Date;
}

/** Home's two requests from the window. */
export class Home {
  constructor(private readonly deps: HomeDeps) {}

  /** Reads the stores and settings and builds the summary. Writes nothing. */
  async summary(): Promise<HomeSummary> {
    const [reminders, notes, settings, voiceReady] = await Promise.all([
      this.deps.reminders.list(),
      this.deps.notes.list(),
      this.deps.settings.load(),
      this.deps.voiceReady().catch(() => false),
    ]);
    return homeSummary({
      reminders,
      notes,
      now: this.deps.now(),
      brain: settings.brain,
      voiceReady,
      sound: settings.sound,
    });
  }

  /**
   * True only the first time it is asked on a new day while the morning brief is on, and that day
   * is then saved (under the settings lock, changing nothing else), so a second window load, or a
   * restart, the same day gets false. False when the day couldn't be saved: better no brief than one
   * every time the window opens.
   */
  async claimMorningBrief(): Promise<boolean> {
    const today = localDate(this.deps.now());
    // Most days, and whenever it is off, nothing needs saving: the file isn't touched.
    const saved = await this.deps.settings.load();
    if (!saved.morningBrief || saved.lastBrief === today) return false;
    let claimed = false;
    const result = await this.deps.settings.update((current) => {
      if (!current.morningBrief || current.lastBrief === today) return current;
      claimed = true;
      return { ...current, lastBrief: today };
    });
    return result.ok && claimed;
  }
}
