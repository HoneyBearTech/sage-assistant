# Plan: hud-look

## What the owner asked for

"I'm wanting the interface, visuals, and user experience to closely replicate the one this application
has" (jarvis-agent.tech). The other half of the request, more brains, is a separate job.

## What we found

The full study is in [docs/reports/2026-11-16-jarvis-look.md](../reports/2026-11-16-jarvis-look.md).

- The product is one dark, glowing "heads-up display": a big animated circle (its voice presence) in
  the middle, thin-lined panels with corner marks around it, a large clock, small uppercase labels in a
  typewriter-style font, a faint grid and scanlines, short beeps, and replies that type themselves out.
- Its app isn't shown anywhere public except one low-resolution photo of it on a wall TV; the look comes
  from its website, which is built in the same style.
- It is closed and paid, and Sage is public. Sage follows the same **patterns** (dark glass panels, a
  voice orb, corner marks, monospace labels, typed replies, beeps) but keeps its own name, leaf icon and
  green colours, and draws its own artwork, sounds and words. Its logo, name, artwork, voice clips, page
  text and code are not copied, and neither are film references.
- Sage's window today is a plain light/dark design with three screens (Welcome, Chat, Settings).

## The new look, in jobs

This job is the first; the rest each get their own plan and pull request.

1. **This job - the look:** new dark theme, the orb, restyled chat, the asking box and sounds.
2. **A Home screen:** a big orb, a clock, a greeting for the time of day, and panels for today's reminders,
   recent notes and Sage's status (brain, voice, last actions). Then a "daily brief" that reads them out.
3. **The Welcome screen as a start-up sequence:** the same steps, shown as numbered sections with typed
   check lines (brain OK, voice ready), plus a support code and Copy diagnostics when something fails.

## What we'll change in this job

1. **Dark "sage HUD" theme.** New colours in `src/renderer/styles.css`: a deep green-black background, one
   glowing sage-mint accent, amber for anything waiting on you, red for errors. Thin 1-pixel panel lines
   with corner marks, cut-corner main buttons, small uppercase labels in the PC's own monospace font, the
   message text in the normal font at a readable size, and a faint grid in the background. The dark look
   is the default; a "Theme: Dark / Light / Match Windows" setting keeps a light version. Text stays at
   least 12 px and readable against the background (at least 4.5 to 1 contrast).

   *Check:* a test that the contrast of the main colour pairs is at least 4.5 to 1; a preview page (below)
   showing Chat, Settings and Welcome in both themes.
2. **The orb.** A round, glowing orb drawn in the window's own code (no video or image files), above the
   message box. It shows what Sage is doing: resting (slow breathing), listening (pulses with your voice
   while you hold the talk key), thinking (rings turn) and speaking (pulses while a reply is read aloud).
   The Hold to talk button stays, for the mouse and for screen readers.

   *Check:* window tests that the orb's state follows listening, thinking, speaking and resting.
3. **The chat as a transcript.** Rows labelled `YOU` (amber) and `SAGE` (green) instead of bubbles; the
   newest reply types itself out quickly, and a click or key shows it all at once; actions Sage took show
   as small bordered cards. Text is still only ever inserted as text, never as HTML.

   *Check:* the existing chat tests pass; new tests for the labels and for skipping the typing.
4. **The asking box.** The box that asks before Sage changes anything becomes a bright amber panel with
   corner marks, showing exactly what Sage wants to do, with Allow and Decline. Every safety rule stays
   (only you can answer it, no "always allow", it never answers itself).

   *Check:* the existing asking-box and security tests pass unchanged.
5. **Sounds and a sound switch.** Short tones made by the window itself (no sound files): a blip when you
   send, a two-note tone when you allow an action, a low tone when an asking box appears. A sound on/off
   switch in the top bar, off until you turn it on, remembered in Settings.
6. **Motion that can be turned off.** Breathing, ring turning, fade-in and typing all stop when Windows'
   "reduce animations" setting is on.
7. **A preview page.** A page made from the real window files with sample messages, an asking box and
   the orb in each state, so you can see the look in a browser before the final approval (the team's
   machine can't take screenshots of the window). It is for review only and isn't part of Sage.
8. **Notes.** Roadmap (the three jobs above), changelog, README screenshots if it has any, and the
   Windows checklist gets a short "new look" section (both themes, sound switch, orb states, reduced
   motion).

Everything stays inside the window's strict security rules: no files or fonts from the internet, no
inline scripts, nothing sent anywhere.

## Who's on it

CEO, Engineer, QA, Security Officer, Auditor and a Plain-English Reader. No Researcher: the study above
is done.

## Risks

- **Looks are a matter of taste.** You get a private link to the preview page before the final approval,
  so you can ask for changes.
- **Animation can use power.** It is drawn with simple shapes and stops when the window is hidden or
  minimised.
- **CI can't open the real window on Windows**, so you check it with the Windows checklist after the next
  install.

## Out of scope

- The Home screen, the daily brief and the start-up sequence (next jobs).
- New brains (Claude, OpenAI, Gemini, Copilot): a separate job.
- Several agents, Slack, business dashboards, a TV-wall mode.
