import type { HomeReminder, HomeSummary, PublicSettings, SageApi } from "../shared/api.js";
import {
  type BriefTrigger,
  brainName,
  briefSpeaks,
  briefText,
  dayName,
  greeting,
  HOME_TEXT,
  msToNextMinute,
  sameDay,
  type TimeFormat,
  whenDue,
} from "./home-text.js";
import type { Typist } from "./typing.js";

// Home: the large orb (drawn by orb.ts with the chat's, from the same state), a clock in the PC's own
// time format, a greeting, and the Today, Notes and Status panels, filled from Sage's read-only
// summary when Home is shown, every minute while it is, and when a reminder notice arrives. Brief me
// builds the daily brief here, from the same summary, types it out and reads it aloud as the
// settings say; it is never sent to the brain. Text goes in with textContent, never as HTML.

export interface HomeElements {
  view: HTMLElement;
  clock: HTMLElement;
  greeting: HTMLElement;
  today: HTMLElement;
  notes: HTMLElement;
  brain: HTMLElement;
  voice: HTMLElement;
  sound: HTMLElement;
  next: HTMLElement;
  /** A problem loading Home. */
  status: HTMLElement;
  talk: HTMLButtonElement;
  briefMe: HTMLButtonElement;
  briefPanel: HTMLElement;
  briefText: HTMLElement;
}

export interface HomeHooks {
  /** Talk to Sage: open Chat with the message box ready. */
  talk(): void;
  /** The saved settings, once loaded. */
  settings(): Pick<PublicSettings, "speakReplies" | "morningBrief"> | null;
  /** Reads text aloud with the PC's own voice; never while the microphone is open. */
  speak(text: string): void;
  /** The chat's typist: one text types out at a time, with its skip and reduced-motion rules. */
  typist: Typist;
  /** The PC's own time format; the tests give a fixed one. */
  time?: TimeFormat;
}

export interface Home {
  /** Home was just shown: the clock starts, the panels load, and the morning brief may show. */
  shown(): void;
  /** Home was hidden: the clock stops. */
  hidden(): void;
  /** A reminder notice arrived: the panels load again if Home is on screen. */
  reminderArrived(): void;
  /** Loads the panels again if Home is on screen (after the sound switch, say). */
  refresh(): void;
}

/** The PC's own time format: hours and minutes, as the system's language writes them. */
export function systemTimeFormat(): TimeFormat {
  const format = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  return (date) => format.format(date);
}

export function createHome(sage: SageApi, el: HomeElements, hooks: HomeHooks): Home {
  const time = hooks.time ?? systemTimeFormat();
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Goes up with each load; an older answer that arrives late is dropped. */
  let loads = 0;
  let claiming = false;

  function onScreen(): boolean {
    return !el.view.hidden && document.visibilityState !== "hidden";
  }

  function showClock(): void {
    const now = new Date();
    el.clock.textContent = time(now);
    el.greeting.textContent = greeting(now.getHours());
  }

  /** The clock changes on the minute, never in between; the panels load again with it. */
  function tickNextMinute(): void {
    clearTimeout(timer);
    timer = setTimeout(() => {
      showClock();
      if (onScreen()) void load();
      tickNextMinute();
    }, msToNextMinute(new Date()));
  }

  function item(list: HTMLElement, className = ""): HTMLLIElement {
    const li = document.createElement("li");
    if (className) li.className = className;
    list.append(li);
    return li;
  }

  function part(parent: HTMLElement, className: string, text: string): void {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    parent.append(span);
  }

  /** A reminder's time: today's as the clock shows it; another day's with the day first. */
  function shortWhen(reminder: HomeReminder, now: Date): string {
    const due = new Date(reminder.due);
    return sameDay(due, now) ? time(due) : `${dayName(due)}, ${time(due)}`;
  }

  function render(summary: HomeSummary): void {
    const now = new Date();
    el.today.replaceChildren();
    if (summary.reminders.length === 0) item(el.today, "empty").textContent = HOME_TEXT.nothingToday;
    for (const reminder of summary.reminders) {
      const li = item(el.today, reminder.missed ? "missed" : "");
      part(li, "home-when", shortWhen(reminder, now));
      part(li, "home-what", reminder.text);
      if (reminder.missed) part(li, "home-tag", HOME_TEXT.missed);
    }
    if (summary.missedMore > 0) item(el.today, "more").textContent = HOME_TEXT.missedMore(summary.missedMore);
    el.notes.replaceChildren();
    if (summary.notes.length === 0) item(el.notes, "empty").textContent = HOME_TEXT.noNotes;
    for (const title of summary.notes) item(el.notes).textContent = title;

    el.brain.textContent = brainName(summary.status.brain);
    el.voice.textContent = summary.status.voiceReady ? HOME_TEXT.voiceReady : HOME_TEXT.voiceMissing;
    el.sound.textContent = summary.status.sound ? HOME_TEXT.soundOn : HOME_TEXT.soundOff;
    // The next reminder still to come: later today, or the next one after today.
    const next =
      summary.reminders.find((reminder) => !reminder.missed && Date.parse(reminder.due) > now.getTime()) ??
      summary.next;
    el.next.textContent = next ? `${next.text} ${whenDue(next, now, time)}` : HOME_TEXT.noNext;
  }

  /** Loads the summary and shows it. Gives it back, or null when it couldn't be loaded. */
  async function load(): Promise<HomeSummary | null> {
    const mine = ++loads;
    let summary: HomeSummary;
    try {
      summary = await sage.homeSummary();
    } catch {
      if (mine === loads) el.status.textContent = HOME_TEXT.loadFailed;
      return null;
    }
    if (mine === loads) {
      el.status.textContent = "";
      render(summary);
    }
    return summary;
  }

  async function brief(trigger: BriefTrigger): Promise<void> {
    const summary = await load();
    el.briefPanel.hidden = false;
    if (!summary) {
      hooks.typist.finish();
      el.briefText.textContent = HOME_TEXT.briefFailed;
      return;
    }
    const text = briefText(summary, new Date(), time);
    el.briefText.textContent = text;
    hooks.typist.type(el.briefText, text);
    if (briefSpeaks(hooks.settings()?.speakReplies ?? "voice", trigger)) hooks.speak(text);
  }

  /** The first time Home is on screen on a new day, with the morning brief on: the brief. */
  async function morningBrief(): Promise<void> {
    if (claiming || !hooks.settings()?.morningBrief || !onScreen()) return;
    claiming = true;
    try {
      if (await sage.claimMorningBrief()) await brief("morning");
    } catch {
      // Asked again the next time Home is shown.
    } finally {
      claiming = false;
    }
  }

  // The Brief panel appears with the first brief.
  el.briefPanel.hidden = true;
  el.talk.addEventListener("click", () => hooks.talk());
  el.briefMe.addEventListener("click", () => void brief("button"));

  // The window coming back into view counts as showing Home again.
  document.addEventListener("visibilitychange", () => {
    if (!onScreen()) return;
    showClock();
    void load();
    void morningBrief();
  });

  return {
    shown() {
      showClock();
      tickNextMinute();
      void load();
      void morningBrief();
    },
    hidden() {
      clearTimeout(timer);
      timer = undefined;
    },
    reminderArrived() {
      if (onScreen()) void load();
    },
    refresh() {
      if (onScreen()) void load();
    },
  };
}
