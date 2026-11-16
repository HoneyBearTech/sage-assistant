import { BRAIN_LABELS, type HomeReminder, type HomeSummary, type PublicSettings } from "../shared/api.js";

// Home's words and small rules, without the DOM, so the tests can check them directly: the greeting
// for the time of day, the daily brief's fixed wording, and when the brief is read aloud. home.ts
// shows them.

export const HOME_TEXT = {
  nothingToday: "Nothing due today",
  noNotes: "No notes yet",
  missed: "Missed",
  noNext: "None",
  voiceReady: "Ready",
  voiceMissing: "Not set up yet",
  soundOn: "On",
  soundOff: "Off",
  loadFailed: "Sage couldn't load Home just now. It tries again every minute.",
  briefFailed: "Sage couldn't put the brief together just now. Try again.",
  question: "What would you like to start with?",
  missedMore: (count: number) => `${count} more missed`,
} as const;

export type Greeting = "Good morning" | "Good afternoon" | "Good evening";

/** Morning from 05:00 to 11:59, afternoon from 12:00 to 17:59, evening the rest of the day and night. */
export function greeting(hour: number): Greeting {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Monday 16 November", on the PC's own day. */
export function dayName(date: Date): string {
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** True when `date` falls on the same day as `now`, on the PC's own clock. */
export function sameDay(date: Date, now: Date): boolean {
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/** How long until the clock next shows a new minute. */
export function msToNextMinute(now: Date): number {
  return 60_000 - (now.getSeconds() * 1_000 + now.getMilliseconds());
}

/** The brain in use, by its plain name. */
export function brainName(brain: HomeSummary["status"]["brain"]): string {
  return brain === "local" ? "On this computer" : BRAIN_LABELS[brain].name;
}

/** "A", "A and B", "A, B and C". */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** A reminder's words without a full stop (or other mark) at the end, so a sentence can go on. */
function words(text: string): string {
  return text.replace(/[\s.!?;,:]+$/u, "");
}

/** Shows a time in the PC's own format, such as 09:00 or 9:00 AM. */
export type TimeFormat = (date: Date) => string;

/** When a reminder is due: its time today, or its day and time on another day. */
export function whenDue(reminder: Pick<HomeReminder, "due">, now: Date, time: TimeFormat): string {
  const due = new Date(reminder.due);
  return sameDay(due, now) ? `at ${time(due)}` : `on ${dayName(due)} at ${time(due)}`;
}

/**
 * The daily brief, from Home's summary, in fixed words: the greeting and the date, today's reminders
 * with their times (or that nothing is due, and the next one if there is one), the missed ones, the
 * latest note titles, then a question. Built here, on the PC: it is never sent to the brain.
 */
export function briefText(summary: HomeSummary, now: Date, time: TimeFormat): string {
  const lines = [`${greeting(now.getHours())}. It's ${dayName(now)}.`];
  const missed = summary.reminders.filter((reminder) => reminder.missed);
  const today = summary.reminders.filter(
    (reminder) => !reminder.missed && sameDay(new Date(reminder.due), now),
  );
  const describe = (reminder: HomeReminder) => `${words(reminder.text)} ${whenDue(reminder, now, time)}`;
  if (today.length > 0) {
    lines.push(`Today: ${today.map(describe).join("; ")}.`);
  } else {
    const missedToday = missed.some((reminder) => sameDay(new Date(reminder.due), now));
    let line = missedToday ? "Nothing else is due today." : "Nothing is due today.";
    if (summary.next) line += ` The next reminder is ${describe(summary.next)}.`;
    lines.push(line);
  }
  if (missed.length > 0) {
    const more = summary.missedMore > 0 ? `; and ${summary.missedMore} more` : "";
    lines.push(`You missed: ${missed.map(describe).join("; ")}${more}.`);
  }
  if (summary.notes.length > 0) lines.push(`Your latest notes: ${joinList(summary.notes.map(words))}.`);
  lines.push(HOME_TEXT.question);
  return lines.join("\n");
}

/** Who asked for the brief: the Brief me button, or the morning brief when Sage first opens. */
export type BriefTrigger = "button" | "morning";

/**
 * Whether the brief is read aloud. Asked for with Brief me: unless Read replies aloud is Never. The
 * morning brief, which nobody asked for just then: only when it is Always.
 */
export function briefSpeaks(setting: PublicSettings["speakReplies"], trigger: BriefTrigger): boolean {
  return trigger === "button" ? setting !== "never" : setting === "always";
}
