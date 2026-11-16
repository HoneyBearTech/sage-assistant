import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { homeSummary } from "../src/core/home.js";
import type { HomeSummary } from "../src/shared/api.js";
import {
  type FakeElement,
  focusedElement,
  pressKey,
  setReducedMotion,
  setWindowVisibility,
} from "./fake-dom.js";
import { deferred, settled } from "./helpers.js";
import { EMPTY_HOME, startWindow, type WindowOptions } from "./window.js";

// Home (src/renderer/home.ts, wired up in renderer.ts), run in the real window script on the fake
// DOM. Times are made on the PC's own clock; the window's clock is mocked.

const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

/** Monday 16 November 2026, at this local time. */
const on16th = (hour: number, minute = 0, second = 0) => new Date(2026, 10, 16, hour, minute, second);
/** The PC's own time format, as the window uses it. */
const clockText = (date: Date) =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);

const SAMPLE: HomeSummary = {
  reminders: [
    { id: "a", text: "Water the plants", due: on16th(9).toISOString(), missed: true },
    { id: "b", text: "Dentist", due: on16th(14, 30).toISOString(), missed: false },
  ],
  missedMore: 0,
  next: null,
  notes: ["Shopping", "Ideas"],
  status: { brain: "claude", voiceReady: true, sound: true },
};

async function homeWindow(
  t: Parameters<typeof startWindow>[0],
  options: WindowOptions = {},
  overrides: Parameters<typeof startWindow>[2] = {},
  send: (text: string) => Promise<string> = async () => "A reply.",
) {
  return startWindow(t, send, overrides, { now: on16th(10).getTime(), startOn: "home", ...options });
}

/** Each row of a Home list: the texts of its parts (or its own text), and its class. */
function rows(list: FakeElement): { className: string; parts: string[] }[] {
  return list.children.map((item) => ({
    className: item.className,
    parts: item.children.length > 0 ? item.children.map((part) => part.textContent) : [item.textContent],
  }));
}

test("Home is the first tab, before Chat and Settings, and the tabs are plain buttons", () => {
  const nav = html.slice(html.indexOf('<nav id="tabs"'), html.indexOf("</nav>"));
  const order = [
    ...nav.matchAll(/<button type="button" id="tab-(\w+)" class="tab[^"]*" aria-pressed="(\w+)">(\w+)</g),
  ];
  assert.deepEqual(
    order.map((match) => [match[1], match[2], match[3]]),
    [
      ["home", "true", "Home"],
      ["chat", "false", "Chat"],
      ["settings", "false", "Settings"],
    ],
  );
  // Every Home control is a real button with its own words, so it has a name and works by keyboard.
  for (const [id, words] of [
    ["home-talk", "Talk to Sage"],
    ["home-brief", "Brief me"],
  ]) {
    assert.match(html, new RegExp(`<button type="button" id="${id}"[^>]*>${words}</button>`));
  }
  // The panels are named by their headings.
  for (const name of ["today", "notes", "status", "brief"]) {
    assert.match(html, new RegExp(`aria-labelledby="home-${name}-heading"`));
    assert.match(html, new RegExp(`<h2 id="home-${name}-heading" class="panel-label">`));
  }
  assert.match(
    html,
    /<input type="checkbox" id="morning-brief" [^>]*\/>\s*Brief me when Sage first opens each day/,
  );
});

test("Sage opens on Home; the tabs switch views and say which is pressed", async (t) => {
  const { el } = await homeWindow(t);
  const pressed = () =>
    ["home", "chat", "settings"].filter((name) => el(`tab-${name}`).getAttribute("aria-pressed") === "true");
  assert.equal(el("view-home").hidden, false);
  assert.deepEqual(pressed(), ["home"]);
  el("tab-chat").click();
  assert.equal(el("view-home").hidden, true);
  assert.equal(el("view-chat").hidden, false);
  assert.deepEqual(pressed(), ["chat"]);
  el("tab-settings").click();
  assert.deepEqual(pressed(), ["settings"]);
  el("tab-home").click();
  assert.equal(el("view-home").hidden, false);
  assert.equal(el("view-settings").hidden, true);
  assert.deepEqual(pressed(), ["home"]);
  assert.equal(el("tab-home").classList.contains("active"), true);
  assert.equal(el("tab-chat").classList.contains("active"), false);
});

test("the clock is in the PC's own format, changes only on the minute, and the greeting follows", async (t) => {
  const { el } = await homeWindow(t, { now: on16th(11, 59, 30).getTime() });
  assert.equal(el("home-clock").textContent, clockText(on16th(11, 59)));
  assert.equal(el("home-greeting").textContent, "Good morning");
  t.mock.timers.tick(29_000);
  assert.equal(el("home-clock").textContent, clockText(on16th(11, 59)), "no ticking in between");
  t.mock.timers.tick(1_000);
  assert.equal(el("home-clock").textContent, clockText(on16th(12, 0)));
  assert.equal(el("home-greeting").textContent, "Good afternoon");
  t.mock.timers.tick(6 * 60 * 60_000);
  assert.equal(el("home-clock").textContent, clockText(on16th(18, 0)));
  assert.equal(el("home-greeting").textContent, "Good evening");
});

test("the panels show today's reminders with times, missed ones marked, notes and the status", async (t) => {
  const { el } = await homeWindow(t, { summary: SAMPLE });
  assert.deepEqual(rows(el("home-today")), [
    { className: "missed", parts: [clockText(on16th(9)), "Water the plants", "Missed"] },
    { className: "", parts: [clockText(on16th(14, 30)), "Dentist"] },
  ]);
  assert.deepEqual(rows(el("home-notes")), [
    { className: "", parts: ["Shopping"] },
    { className: "", parts: ["Ideas"] },
  ]);
  assert.equal(el("home-brain").textContent, "Claude");
  assert.equal(el("home-voice").textContent, "Ready");
  assert.equal(el("home-sound").textContent, "On");
  assert.equal(el("home-next").textContent, `Dentist at ${clockText(on16th(14, 30))}`);
  assert.equal(el("home-status").textContent, "");
});

test("ten old missed reminders don't hide the one still to come: panels and brief agree", async (t) => {
  // End to end: the real summary from the main process, shown by the window.
  const missed = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`,
    text: `Missed ${i}`,
    due: new Date(2026, 10, 5 + i, 9).toISOString(),
    created: new Date(2026, 10, 1).toISOString(),
    firedAt: null,
  }));
  const dentist = {
    id: "d",
    text: "Dentist",
    due: on16th(15).toISOString(),
    created: new Date(2026, 10, 1).toISOString(),
    firedAt: null,
  };
  const summary = homeSummary({
    reminders: [...missed, dentist],
    notes: [],
    now: on16th(10),
    brain: "local",
    voiceReady: false,
    sound: false,
  });
  const { el } = await homeWindow(t, { summary });
  const today = rows(el("home-today"));
  assert.equal(today.length, 7);
  assert.deepEqual(today.at(-2), { className: "", parts: [clockText(on16th(15)), "Dentist"] });
  assert.deepEqual(today.at(-1), { className: "more", parts: ["5 more missed"] });
  assert.equal(el("home-next").textContent, `Dentist at ${clockText(on16th(15))}`);
  el("home-brief").click();
  await settled();
  const brief = el("home-brief-text").textContent;
  assert.match(brief, new RegExp(`\nToday: Dentist at ${clockText(on16th(15))}.\n`));
  assert.doesNotMatch(brief, /Nothing is due today/);
  assert.match(brief, /; and 5 more\.\n/);
});

test("empty panels say so plainly", async (t) => {
  const { el } = await homeWindow(t);
  assert.deepEqual(rows(el("home-today")), [{ className: "empty", parts: ["Nothing due today"] }]);
  assert.deepEqual(rows(el("home-notes")), [{ className: "empty", parts: ["No notes yet"] }]);
  assert.equal(el("home-brain").textContent, "On this computer");
  assert.equal(el("home-voice").textContent, "Not set up yet");
  assert.equal(el("home-sound").textContent, "Off");
  assert.equal(el("home-next").textContent, "None");
});

test("the next reminder after today, with its day, when nothing more is to come today", async (t) => {
  const { el } = await homeWindow(t, {
    summary: {
      ...EMPTY_HOME,
      reminders: [{ id: "x", text: "Old one", due: new Date(2026, 10, 15, 18).toISOString(), missed: true }],
      next: { id: "n", text: "Passport", due: new Date(2026, 10, 19, 10).toISOString(), missed: false },
    },
  });
  assert.deepEqual(rows(el("home-today")), [
    {
      className: "missed",
      parts: [`Sunday 15 November, ${clockText(new Date(2026, 10, 15, 18))}`, "Old one", "Missed"],
    },
  ]);
  assert.equal(
    el("home-next").textContent,
    `Passport on Thursday 19 November at ${clockText(new Date(2026, 10, 19, 10))}`,
  );
});

test("Home loads when shown, every minute while shown, and when a reminder notice arrives", async (t) => {
  let notices: { id: string; text: string }[] = [];
  const { el, calls } = await homeWindow(
    t,
    { now: on16th(10, 0, 0).getTime() },
    { takeNotices: async () => notices },
  );
  assert.equal(calls.homeSummary, 1, "loaded when first shown");
  t.mock.timers.tick(60_000);
  await settled();
  assert.equal(calls.homeSummary, 2, "and on the minute");

  notices = [{ id: "n1", text: "Sage reminder: Dentist" }];
  t.mock.timers.tick(5_000);
  await settled();
  assert.equal(calls.homeSummary, 3, "a new notice: at once");
  t.mock.timers.tick(5_000);
  await settled();
  assert.equal(calls.homeSummary, 3, "the same notice again: nothing new");

  el("tab-settings").click();
  t.mock.timers.tick(3 * 60_000);
  await settled();
  assert.equal(calls.homeSummary, 3, "not while another view is open");
  el("tab-home").click();
  await settled();
  assert.equal(calls.homeSummary, 4, "shown again: loaded again");

  setWindowVisibility("hidden");
  t.mock.timers.tick(60_000);
  await settled();
  assert.equal(calls.homeSummary, 4, "not while the window is hidden");
  setWindowVisibility("visible");
  await settled();
  assert.equal(calls.homeSummary, 5, "back in view: loaded again");
});

test("a late answer never overwrites a newer one", async (t) => {
  const answers = [deferred<HomeSummary>(), deferred<HomeSummary>()];
  let call = 0;
  const { el } = await homeWindow(t, {}, { homeSummary: () => answers[call++]!.promise });
  el("tab-chat").click();
  el("tab-home").click();
  answers[1]!.resolve(SAMPLE);
  await settled();
  answers[0]!.resolve(EMPTY_HOME);
  await settled();
  assert.equal(el("home-brain").textContent, "Claude", "the newer answer stays");
});

test("a failed load says so", async (t) => {
  const failing = await homeWindow(
    t,
    {},
    { homeSummary: async () => Promise.reject(new Error("no answer")) },
  );
  assert.equal(
    failing.el("home-status").textContent,
    "Sage couldn't load Home just now. It tries again every minute.",
  );
});

test("Talk to Sage opens Chat with the message box ready", async (t) => {
  const { el } = await homeWindow(t);
  el("home-talk").click();
  assert.equal(el("view-chat").hidden, false);
  assert.equal(el("view-home").hidden, true);
  assert.equal(el("tab-chat").getAttribute("aria-pressed"), "true");
  assert.equal(focusedElement(), el("input"));
});

test("Brief me shows the brief in its panel, typed out, and never sends it to the brain", async (t) => {
  const { el, calls, media } = await homeWindow(t, {
    summary: SAMPLE,
    now: on16th(10).getTime(),
    settings: { speakReplies: "never" },
  });
  assert.equal(el("home-brief-panel").hidden, true);
  setReducedMotion(false);
  el("home-brief").click();
  await settled();
  const text = el("home-brief-text").textContent;
  assert.equal(
    text,
    [
      "Good morning. It's Monday 16 November.",
      `Today: Dentist at ${clockText(on16th(14, 30))}.`,
      `You missed: Water the plants at ${clockText(on16th(9))}.`,
      "Your latest notes: Shopping and Ideas.",
      "What would you like to start with?",
    ].join("\n"),
  );
  assert.equal(el("home-brief-panel").hidden, false);
  assert.equal(el("home-brief-text").classList.contains("typing"), true, "typed out like a reply");
  // A key shows all of it at once, as for replies.
  pressKey("keydown", { key: "Escape" });
  assert.equal(el("home-brief-text").classList.contains("typing"), false);
  assert.deepEqual(calls.send, [], "nothing went to the brain");
  assert.equal(media.speech.spoken.length, 0, "Read replies aloud is Never");
});

test("with reduced motion the brief appears at once; the orb and clock have no motion of their own", async (t) => {
  const { el } = await homeWindow(t, { summary: SAMPLE });
  setReducedMotion(true);
  el("home-brief").click();
  await settled();
  assert.equal(el("home-brief-text").classList.contains("typing"), false);
  assert.match(el("home-brief-text").textContent, /^Good morning/);
  // The clock is never animated; the orb stands still by the stylesheet's reduced-motion rule.
  const css = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const clock = css.match(/\.home-clock \{([^}]*)\}/);
  assert.ok(clock);
  assert.doesNotMatch(clock[1]!, /animation|transition/);
  assert.match(
    html,
    /<div id="home-orb" class="orb orb-large"/,
    "the same .orb rules, so the same reduced-motion rule",
  );
});

test("Brief me reads the brief aloud unless Read replies aloud is Never", async (t) => {
  for (const [setting, speaks] of [
    ["voice", true],
    ["always", true],
    ["never", false],
  ] as const) {
    await t.test(setting, async (t) => {
      const { el, media } = await homeWindow(t, { settings: { speakReplies: setting } });
      el("home-brief").click();
      await settled();
      assert.equal(media.speech.spoken.length, speaks ? 1 : 0);
      if (speaks) {
        assert.equal(media.speech.spoken[0]!.text, el("home-brief-text").textContent);
        assert.equal(el("home-orb").getAttribute("data-state"), "speaking", "the Home orb speaks too");
        assert.equal(el("orb").getAttribute("data-state"), "speaking");
        el("stop-speaking").click();
        assert.equal(el("home-orb").getAttribute("data-state"), "idle");
      }
    });
  }
});

test("a brief that can't be put together says so", async (t) => {
  let fail = false;
  const { el, media } = await homeWindow(
    t,
    {},
    {
      homeSummary: async () => {
        if (fail) throw new Error("no answer");
        return EMPTY_HOME;
      },
    },
  );
  fail = true;
  el("home-brief").click();
  await settled();
  assert.equal(el("home-brief-panel").hidden, false);
  assert.equal(
    el("home-brief-text").textContent,
    "Sage couldn't put the brief together just now. Try again.",
  );
  assert.equal(media.speech.spoken.length, 0);
});

test("the morning brief: shown on Home when Sage claims the day, read aloud only with Always", async (t) => {
  for (const [setting, speaks] of [
    ["always", true],
    ["voice", false],
    ["never", false],
  ] as const) {
    await t.test(setting, async (t) => {
      const { el, calls, media } = await homeWindow(
        t,
        { summary: SAMPLE, settings: { morningBrief: true, speakReplies: setting } },
        { claimMorningBrief: async () => true },
      );
      await settled();
      assert.equal(el("home-brief-panel").hidden, false);
      assert.match(el("home-brief-text").textContent, /^Good morning\. It's Monday 16 November\./);
      assert.equal(media.speech.spoken.length, speaks ? 1 : 0);
      assert.deepEqual(calls.send, []);
    });
  }
});

test("with the morning brief off, Sage is never asked for it", async (t) => {
  const off = await homeWindow(t);
  clickAllTabs(off.el);
  setWindowVisibility("hidden");
  setWindowVisibility("visible");
  await settled();
  assert.equal(off.calls.claims, 0);
});

/** Goes through every tab and back to Home. */
function clickAllTabs(el: (id: string) => FakeElement): void {
  for (const tab of ["tab-chat", "tab-settings", "tab-home"]) el(tab).click();
}

test("the morning brief is asked for on Home, and shows only when Sage says it is a new day", async (t) => {
  // On, but Sage says the day was claimed already: nothing shows.
  let claims = 0;
  let answer = false;
  const { el } = await homeWindow(
    t,
    { settings: { morningBrief: true } },
    {
      claimMorningBrief: async () => {
        claims++;
        return answer;
      },
    },
  );
  assert.equal(claims, 1);
  assert.equal(el("home-brief-panel").hidden, true);

  // Asked again when Home is shown again, or the window comes back into view on Home...
  el("tab-chat").click();
  answer = true;
  await settled();
  assert.equal(claims, 1, "not on Chat");
  el("tab-home").click();
  await settled();
  await settled();
  assert.equal(claims, 2);
  assert.equal(el("home-brief-panel").hidden, false);
  setWindowVisibility("hidden");
  setWindowVisibility("visible");
  await settled();
  assert.equal(claims, 3);
});

test("a window that opens on Chat or Settings doesn't ask for the morning brief", async (t) => {
  const { calls, el } = await startWindow(t, async () => "", {}, { settings: { morningBrief: true } });
  // startWindow opened Home first, then Chat (as a click on the Chat tab would).
  const asked = calls.claims;
  el("tab-settings").click();
  setWindowVisibility("hidden");
  setWindowVisibility("visible");
  await settled();
  assert.equal(calls.claims, asked);
});

test("the Home orb shows the same state as the chat's", async (t) => {
  const reply = deferred<string>();
  const { el } = await homeWindow(t, {}, {}, () => reply.promise);
  assert.equal(el("home-orb").getAttribute("data-state"), "idle");
  assert.equal(el("home-orb-state").textContent, "Ready");
  el("home-talk").click();
  el("input").value = "hello";
  el("composer").dispatch("submit");
  await settled();
  el("tab-home").click();
  assert.equal(el("home-orb").getAttribute("data-state"), "thinking");
  assert.equal(el("home-orb-state").textContent, "Thinking");
  reply.resolve("hi");
  await settled();
  assert.equal(el("home-orb").getAttribute("data-state"), "idle");
  setWindowVisibility("hidden");
  assert.equal(el("home-orb").classList.contains("paused"), true);
  assert.equal(el("orb").classList.contains("paused"), true);
});

test("the morning brief setting is shown and saved with the other settings", async (t) => {
  const { el, calls } = await startWindow(t, async () => "", {}, { settings: { morningBrief: true } });
  assert.equal(el("morning-brief").checked, true);
  el("morning-brief").checked = false;
  el("settings-form").dispatch("submit");
  await settled();
  assert.equal((calls.saved[0] as { morningBrief: boolean }).morningBrief, false);
});

test("the sound switch updates Home's Status panel", async (t) => {
  let sound = false;
  const { el } = await homeWindow(
    t,
    {},
    {
      homeSummary: async () => ({ ...EMPTY_HOME, status: { ...EMPTY_HOME.status, sound } }),
      setSound: async (on) => {
        sound = on;
        return { ok: true };
      },
    },
  );
  assert.equal(el("home-sound").textContent, "Off");
  el("sound-toggle").click();
  await settled();
  await settled();
  assert.equal(el("home-sound").textContent, "On");
});
