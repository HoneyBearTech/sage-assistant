import assert from "node:assert/strict";
import { test } from "node:test";
import {
  brainName,
  briefSpeaks,
  briefText,
  dayName,
  greeting,
  joinList,
  msToNextMinute,
} from "../src/renderer/home-text.js";
import type { HomeReminder, HomeSummary } from "../src/shared/api.js";

// Home's words (src/renderer/home-text.ts): the greeting, the daily brief's fixed wording, and when
// the brief is read aloud. Times are on the PC's own clock, with a fixed 24-hour format here.

const time = (date: Date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
/** Monday 16 November 2026, at this local time. */
const on16th = (hour: number, minute = 0) => new Date(2026, 10, 16, hour, minute);

function due(id: string, at: Date, missed = false, text = id): HomeReminder {
  return { id, text, due: at.toISOString(), missed };
}

function summary(parts: Partial<HomeSummary> = {}): HomeSummary {
  return {
    reminders: [],
    next: null,
    notes: [],
    status: { brain: "local", voiceReady: true, sound: false },
    ...parts,
  };
}

test("the greeting changes at 05:00, 12:00 and 18:00", () => {
  const expected: [number, string][] = [
    [0, "Good evening"],
    [4, "Good evening"],
    [5, "Good morning"],
    [11, "Good morning"],
    [12, "Good afternoon"],
    [17, "Good afternoon"],
    [18, "Good evening"],
    [23, "Good evening"],
  ];
  for (const [hour, words] of expected) assert.equal(greeting(hour), words, `${hour}:00`);
  // Every hour of the day has one.
  for (let hour = 0; hour < 24; hour++) assert.match(greeting(hour), /^Good (morning|afternoon|evening)$/);
});

test("the date and lists are written out in full", () => {
  assert.equal(dayName(on16th(9)), "Monday 16 November");
  assert.equal(dayName(new Date(2027, 0, 3)), "Sunday 3 January");
  assert.equal(joinList([]), "");
  assert.equal(joinList(["A"]), "A");
  assert.equal(joinList(["A", "B"]), "A and B");
  assert.equal(joinList(["A", "B", "C"]), "A, B and C");
});

test("the clock waits for the next minute, never ticking in between", () => {
  assert.equal(msToNextMinute(new Date(2026, 10, 16, 9, 0, 0, 0)), 60_000);
  assert.equal(msToNextMinute(new Date(2026, 10, 16, 9, 0, 59, 500)), 500);
  assert.equal(msToNextMinute(new Date(2026, 10, 16, 9, 0, 30, 0)), 30_000);
});

test("the brain's plain name", () => {
  assert.equal(brainName("local"), "On this computer");
  assert.equal(brainName("claude"), "Claude");
  assert.equal(brainName("openai"), "OpenAI");
  assert.equal(brainName("gemini"), "Gemini");
  assert.equal(brainName("other"), "Another online service");
});

test("the brief with nothing due and no notes", () => {
  assert.equal(
    briefText(summary(), on16th(8, 15), time),
    "Good morning. It's Monday 16 November.\nNothing is due today.\nWhat would you like to start with?",
  );
});

test("the brief with nothing due today says when the next one is", () => {
  const next = due("Renew the passport", new Date(2026, 10, 19, 10, 0));
  assert.equal(
    briefText(summary({ next }), on16th(14), time),
    "Good afternoon. It's Monday 16 November.\nNothing is due today. The next reminder is Renew the passport on Thursday 19 November at 10:00.\nWhat would you like to start with?",
  );
});

test("the brief with one reminder today", () => {
  assert.equal(
    briefText(summary({ reminders: [due("Dentist.", on16th(14, 30))] }), on16th(9), time),
    "Good morning. It's Monday 16 November.\nToday: Dentist at 14:30.\nWhat would you like to start with?",
  );
});

test("the brief with several reminders, missed ones and notes", () => {
  const text = briefText(
    summary({
      reminders: [
        due("Pay the bill", new Date(2026, 10, 15, 18, 0), true),
        due("Water the plants", on16th(9), true),
        due("Stand-up", on16th(9, 30)),
        due("Dentist", on16th(14, 30)),
        due("Call Sam", on16th(19)),
      ],
      notes: ["Shopping", "Ideas for the garden", "Trip"],
      // Ignored: there is something today.
      next: due("Far away", new Date(2026, 11, 1, 9)),
    }),
    on16th(10, 5),
    time,
  );
  assert.equal(
    text,
    [
      "Good morning. It's Monday 16 November.",
      "Today: Stand-up at 09:30; Dentist at 14:30; Call Sam at 19:00.",
      "You missed: Pay the bill on Sunday 15 November at 18:00; Water the plants at 09:00.",
      "Your latest notes: Shopping, Ideas for the garden and Trip.",
      "What would you like to start with?",
    ].join("\n"),
  );
});

test("the brief with only missed ones today says nothing else is due", () => {
  assert.equal(
    briefText(
      summary({ reminders: [due("Water the plants", on16th(9), true)], notes: ["One"] }),
      on16th(20),
      time,
    ),
    [
      "Good evening. It's Monday 16 November.",
      "Nothing else is due today.",
      "You missed: Water the plants at 09:00.",
      "Your latest notes: One.",
      "What would you like to start with?",
    ].join("\n"),
  );
});

test("the brief is read aloud when asked for unless Never; the morning brief only with Always", () => {
  assert.equal(briefSpeaks("voice", "button"), true);
  assert.equal(briefSpeaks("always", "button"), true);
  assert.equal(briefSpeaks("never", "button"), false);
  assert.equal(briefSpeaks("voice", "morning"), false);
  assert.equal(briefSpeaks("always", "morning"), true);
  assert.equal(briefSpeaks("never", "morning"), false);
});
