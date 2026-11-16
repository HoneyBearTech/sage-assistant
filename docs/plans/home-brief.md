# Plan: home-brief

## What the owner asked for

"The Home screen with a daily brief" - part 2 of the new look.

## What we found

- The design study ([docs/reports/2026-11-16-jarvis-look.md](../reports/2026-11-16-jarvis-look.md))
  already describes it: a large orb, a clock, a greeting for the time of day, panels for today, notes and
  status, and a daily brief, text first.
- Today the window has two tabs (Chat and Settings). It can't read notes or reminders directly; only the
  assistant can.
- Sage can already read text aloud with a voice installed on the PC (Settings, "Read replies aloud").
- Part 1 left two small chat items (cards for actions done without asking, and an open question's card
  after a window reload). They are a chat change, not part of Home, so they stay on the roadmap as their
  own small job.

## What we'll change

1. **A Home tab, first in the bar.** Sage opens on Home (the Welcome screen still comes first on a first
   run). Checked by: window tests for the tab order, the start view and keyboard use.
2. **What Home shows:**
   - a large orb that follows the same states as in Chat (resting, listening, thinking, speaking);
   - a clock in the PC's own time format;
   - a greeting for the time of day ("Good morning", "Good afternoon", "Good evening");
   - three panels:
     - **Today:** reminders due today, plus any missed ones, with their times;
     - **Notes:** the titles of the five most recently changed notes;
     - **Status:** the brain in use, whether voice is ready, whether sound is on, and the next reminder.
   - a **Talk to Sage** button that opens Chat with the message box ready.

   Empty panels say so plainly ("Nothing due today"). Checked by: tests for the greeting at each hour
   boundary, the panels' content and empty states, and the contrast and minimum text size tests from
   part 1.
3. **A read-only summary for the window.** A new one-way request from the window returns only what Home
   shows:
   - at most 10 reminders (text and time);
   - at most 5 note titles, shortened, never the note text;
   - the status values.

   It is checked like every other window request (only Sage's own window may ask) and can change nothing.
   Home refreshes it when opened, every minute, and when a reminder fires. Checked by: tests for the
   limits, the sender check and the window security test's list of allowed requests.
4. **The daily brief.** A **Brief me** button on Home.
   - **Built by Sage itself** from the same summary, with fixed wording: the greeting and date, today's
     reminders (or the next one if none today), missed ones, the latest note titles, then "What would you
     like to start with?"
   - **Never sent to the brain**, so it works offline, costs nothing with an online brain, and sends
     nothing anywhere.
   - **Typed out like a reply**, and read aloud unless "Read replies aloud" is set to "Never".

   Checked by: tests for the brief's text in each case (nothing due, one, several, missed, no notes),
   and for when it is read aloud.
5. **Optional morning brief.** A setting **Brief me when Sage first opens each day**, off by default. When
   on, the first time the window opens on a new day, Home shows the brief. It is read aloud only if
   "Read replies aloud" is set to "Always". Checked by: tests for once per day, the setting being
   remembered, and settings from 0.1.1 or the online-brains change carrying over.
6. **Reduced motion and sound.** The clock and orb follow the existing reduced-motion and Sound rules.
   No new sounds.
7. **Docs and preview.**
   - README, CHANGELOG, the architecture notes, the assurance case (the new window request) and a "Home
     screen" section in the Windows checklist.
   - An update to the review-only preview page, so the owner can see Home before approving.

## Who's on it

Engineer, QA, Security Officer, Auditor, and a plain-English check of the final report. No Researcher: the
part 1 study covers the design.

## Risks

- **More of Sage's data is visible in the window.** Reminder text and note titles were only shown inside
  chat replies before. The summary is read-only, bounded and never includes note text.
- **The morning brief could speak when you don't expect it.** It is off by default, and it speaks only
  when "Read replies aloud" is set to "Always".

## Out of scope

- Weather, news or a calendar in the brief. They would need online services and their own plan.
- Pre-recorded voice clips, and better voices (on the roadmap).
- The chat cards from part 1 (their own small job), and the Welcome start-up sequence (part 3, built
  after this job is merged).
