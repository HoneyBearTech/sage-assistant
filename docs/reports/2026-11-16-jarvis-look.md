# jarvis-agent.tech: interface study and design brief for Sage

Research report, 2026-11-16. The owner asked for Sage's interface, visuals and user experience to closely
follow this product's. Sage is public and the product is closed and paid, so Sage follows its patterns with
its own name, artwork, palette, sounds and words. This report lists the patterns only: it deliberately
leaves out the product's exact colours, sound settings, wording and artwork, so none of them can be copied
from here.

**What the evidence is.** The product is closed source and sold through a landing page. The site has no app
screenshots and no public docs, and web searches found no reviews or screenshots. What is known comes from:
1. The landing page's own code, read in full. It reuses the app's look, so it shows the visual language,
   though not the app's layouts.
2. One low-resolution photo of the app running full screen on a wall TV (the demo video's poster).
3. The page's description of the app (agents, push-to-talk, a setup wizard). This is inferred, never seen.

## What the app looks like

### The main screen (seen in the photo, low resolution)
A dark, full-screen dashboard. A large circular "reactor" of thin rings with tick marks sits in the centre
and dominates; a big digital clock sits top right; small panels of text rows and progress bars run down
the left; a small radar circle and dense monospace readouts sit on the right; a bordered box with large
figures sits bottom centre. There is a grid backdrop and thin glowing lines, with almost no filled colour.

### Voice, agents and settings (inferred from the page text)
- Push-to-talk: hold a key, speak, and it answers aloud with a time-of-day greeting.
- A roster of named agents shown as status cards with a blinking "active" dot, plus an empty "slot open"
  card.
- A setup wizard inside the app that needs no terminal, signs in to an online service and offers an API key
  as an advanced option.
- Failures show a support code and a "copy diagnostics" button. The user sets a spending cap.

### The landing page (seen in code)
A fixed top bar (brand dot, sound toggle, live clock), a fixed bottom status bar, corner brackets, a
"tap to start" overlay with the orb, typed start-up lines ending in OK, a typed greeting, and numbered
sections. Its "voice log" panel is the closest thing to a chat view: a transcript with a label column for
each speaker (the user's in a warm colour, the assistant's in the accent), not bubbles.

## Visual language (patterns)
- **Colour:** a near-black ground, one luminous cool accent, a warm second colour for the user and for
  calls to action, dim secondary text, dark text on filled buttons.
- **Type:** monospace for all the window's chrome, in small uppercase labels with very wide letter spacing;
  the system font only for paragraphs.
- **Shapes:** 1 px hairline borders, corner ticks on panels, buttons with cut corners, no rounded corners
  except circles, dashed borders for empty places.
- **Background:** a faint grid, a soft glow at the top and bottom, and faint scanlines.
- **Glow:** soft shadows in the accent colour, glowing text on greetings, blinking status dots.
- **Orb:** a glowing orb that slowly breathes, inside rotating rings with ticks; tapping it spins the rings
  and it speaks a line.
- **Motion:** elements fade and rise in, headings flicker briefly, typed text with a blinking cursor, a
  short start-up sequence. Reduced motion is honoured.
- **Sound:** short synthesised blips, a two-note confirm and a low tone; pre-recorded voice clips for the
  greeting and the daily brief; a sound toggle; sound starts only after a click.
- **Theme:** dark only.
- **Voice persona:** a formal butler. Sage does not use one.

## User experience
- **First run (inferred):** one installer, a setup wizard, then a spoken greeting. The landing page models
  the feel: a start gate, a short start-up sequence, then a typed and spoken greeting.
- **Talking:** hold a key, speak, let go; it answers aloud. The orb is the voice's presence.
- **Replies:** the daily brief is the signature moment. It speaks and types at once, in short beats with
  figures highlighted, and ends with a suggestion and a question.
- **Accessibility seen in code:** labels, visible focus and reduced motion. Much of the text is tiny
  (9-11 px) and low-contrast, which is a weakness Sage should not copy.

## Features Sage lacks (rough effort)
1. A central voice orb that shows its state (resting, listening, thinking, speaking): medium.
2. A short spoken greeting on start: small; Sage already reads replies aloud.
3. A greeting for the time of day and a daily brief of reminders and notes: small to medium.
4. A Home view with a clock and status panels: medium.
5. A typed start-up sequence with check lines: small.
6. A skills status list (Sage has one assistant, not a roster): small.
7. A transcript-style chat with speaker labels: small.
8. Sound effects with a toggle: small.
9. A support code and Copy diagnostics on setup failures: small, valuable.
10. A spending cap for an online brain: small to medium.
11. Slack, ad and revenue integrations, multiple agents, a developer agent: large and out of scope.
12. Their product has no voice on Linux; Sage already does, an advantage to keep.

## What we may and may not copy
**Theirs, not copied:** the name, tagline and any page wording, the persona and its lines, the agent names
and roles, their videos, posters, images and voice clips, their ring artwork, their exact screen layout,
their exact colours and sound settings, and their code. No film or comic references either.

**Generic patterns, fine for an original design:** a dark UI with one glowing accent; a circular voice orb;
thin rings; dark glass panels with hairline borders; corner ticks; monospace uppercase labels; status dots;
typed text and a blinking cursor; a faint grid and scanlines; push-to-talk; a daily brief; a sound toggle;
reduced-motion support; numbered section labels.

**Rule of thumb:** follow the idea, draw our own artwork, write our own words, make our own sounds, and use
Sage's own name, leaf icon and green identity.

## Design brief for Sage
- **Identity.** Keep the leaf icon and the name. Move to a calm "HUD in green": a deep green-black ground,
  one sage-mint accent, and amber for anything waiting on the user. No cyan.
- **Sage's own tokens:** ground `#05100d`, panel `#0a1a15`, panel-2 `#0e231c`, line `#1c3b31`, line-bright
  `#2f6b58`, accent `#5fd3a8`, accent-dim `#2f8a6c`, text `#d6efe4`, muted `#7fa393`, amber `#ffc266`,
  danger `#ff6b6b`. Keep a light theme as an option. Body text at least 4.5 to 1 contrast and never under
  12 px.
- **Type:** the PC's monospace font for labels, status, clock and tabs; the system font at 15-16 px for
  messages. No web fonts (the window only loads its own files).
- **Shapes:** 1 px borders, at most 2-4 px radius, cut-corner main buttons, corner ticks, dashed empty
  states.
- **Motion:** a breathing orb, new messages fading in quickly (under 300 ms), no video; the orb drawn in
  the window's own code. All motion off under reduced motion.
- **Sound:** Sage's own synthesised tones only: a blip on send, two notes when an action is allowed, a low
  tone when an asking box appears. Off until switched on, and remembered.

### Buildable slices (smallest first)
1. Theme tokens and chrome: new dark tokens, mono labels, hairline panels, cut-corner buttons, light theme
   kept, a glowing status dot.
2. The orb above the message box, with resting, listening, thinking and speaking states; the Hold to talk
   button stays.
3. Message styling: YOU and SAGE rows, the newest reply typed out (skippable), small cards for results.
4. The asking box shown prominently in amber, keeping every existing safety rule.
5. Welcome as a start-up sequence: numbered sections, typed check lines, Support code and Copy diagnostics.
6. A Home view: a large orb, clock, greeting, and Today, Notes and Status panels.
7. A daily brief of reminders and recent notes, text first, speech later.
8. Sounds and a toggle.
9. Better voices (later, its own plan).
10. A skills status list.

Out of scope: several agents, Slack, business integrations, a developer agent, a TV-wall mode.

Constraints to keep: the strict content rules stay (no remote files, no inline script), nothing is sent
anywhere, no telemetry, every control has an accessible name and works from the keyboard.

## Sources
- The product's public landing page and its demo video's poster image (read 2026-11-16).
- Two web searches, which found no reviews or screenshots of the product.
- Sage: README.md, src/renderer/index.html and styles.css. See also
  [the similar-projects report](2026-11-15-similar-projects.md).
