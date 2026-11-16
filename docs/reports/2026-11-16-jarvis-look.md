# jarvis-agent.tech: interface study and design brief for Sage

Research report, 2026-11-16. The owner asked for Sage's interface, visuals and user experience to closely
follow this product's. Sage is public and the product is closed and paid, so Sage follows its patterns with
its own name, artwork, palette, sounds and words.

**Read this first - what the evidence is.** The product is closed source and sold through a landing page. I found NO app screenshots on the site, no linked docs/changelog pages (only /terms and /privacy, which I did not mine for UI), and no third-party reviews or screenshots by web search (two searches found only unrelated hobby "Jarvis" projects). The real app UI is therefore known from only three sources:
1. The landing page's own HTML/CSS/JS (read in full: 126 KB once the 16 inline mp3 voice clips are stripped; there are no inline images). **Seen in code = certain for the site, not the app.**
2. One real photo: `assets/poster-demo.jpg` (the demo-video poster, 720x1280, from jarvis-agent.tech/assets/). It shows the HUD running full screen on a wall TV. Low resolution, so details below are **read from the image at poster size; partly illegible**.
3. Page copy describing the app (agents, push-to-talk, Slack, Settings, setup wizard). **Inferred from text, never seen.**

The landing page deliberately reuses the HUD look (it IS the brand), so it is a fair guide to the app's visual language, not to its layouts. I did not render the site (not needed; code was enough). Their demo video (assets/demo.mp4, 72 s) and background videos were not downloaded or watched; a person should watch them if more layout detail is wanted.

## What the app looks like

### A. The HUD main window (the product's one big screen)
Seen in the demo poster (screenshot, low-res): a dark navy full-screen dashboard on a wall TV, in a browser-like/Electron frame.
- **Centre: a large circular "reactor"** - concentric thin rings with tick marks, a dotted/starfield disc inside, glowing cyan. Dominant element.
- **Top right:** a large digital clock with seconds and hundredths (reads like `20:43:36.81`) plus a small status strip.
- **Left column:** stacked small panels of text/list rows with progress bars (tiny, illegible).
- **Right column:** a small radar/sweep circle at the top, a horizontal progress bar below, dense monospace telemetry lines at the bottom right.
- **Bottom centre:** a bordered box with a big revenue-target figure and two smaller figures (reads `$30,000 / $16,479 / $11,330`: target vs now vs a sub-figure) with a progress bar.
- Overall: a grid backdrop, thin cyan lines, nearly no filled colour; everything is a telemetry readout.
Copy (inferred): SYS-01 "The HUD ... revenue, targets, telemetry - built to live on the TV in your room"; runs "as its own desktop app" (Electron; Mac/Windows installers, Linux from source with `bash start.sh`).

### B. Voice mode (inferred from copy; not seen)
"Push-to-talk in the HUD: hold Space, speak, he answers aloud. 'Good evening, sir' ... local speech-to-text, configured by the setup wizard." Two-way voice on Mac/Windows only. The spoken greeting is time-of-day ("Good morning/afternoon/evening, sir").

### C. Agent roster (inferred from copy; the landing page draws it as cards)
Five agents with name, role, and an `ACTIVE` status (blinking dot): JARVIS (chief of staff), SARAH (support), TOM (developer, opens pull requests), BOBBY (media buyer), SCOUT (research); plus a dashed "+ YOURS / SLOT OPEN" ghost card (agents can be cloned with skills and a channel). In the app, agents report "in the HUD or in its own Slack channel".

### D. Settings, setup wizard, support (inferred from copy)
- A setup wizard inside the app, "no terminal needed"; installs the official ChatGPT/Claude app if missing and starts sign-in; an "Advanced: use an API key instead" option.
- Settings connects a Slack workspace, plus integrations (revenue, Meta ads, posting, email).
- Failures show a **support code** and a **COPY DIAGNOSTICS** button.
- Spending cap the user sets.

### E. The landing page (seen in code; the best look at their UI components)
Fixed top bar (brand dot, tagline, SND toggle, live clock), fixed bottom status bar ("ALL SYSTEMS OPERATIONAL", CTA), corner brackets, tap-to-initialize overlay with orb, hero with a plasma-orb video and rotating SVG bezel, typed boot lines (`> init J.A.R.V.I.S. v3.1 ........ OK`), typed greeting, then numbered sections `// 01 LIVE FEED` ... `// 08 INTEL`. The **"voice log" terminal panel** (header `VOICE LOG // DAILY BRIEF`, `● REC`, rows labelled `YOU` in gold and `J.A.R.V.I.S.` in cyan, typed text with highlighted figures, a replay button) is the closest thing to a chat view we can see: it is a transcript, not bubbles.

## Visual language (all from the page CSS - certain for the site)
**Palette:** void `#02060e` (page), panel `#061120`, panel-2 `#081827`, line `#12304a`, line-bright `#1d4a6e`, cyan `#35c6ff` (primary), cyan-dim `#1a7fb0`, ice `#bfe9ff` (body text), dim `#5f88a8` (secondary text), gold `#ffb64d` (call to action, user's lines, warnings, "tap" prompts), gold-dim `#8a5f22`. One-off magenta `rgb(255,77,150)` only as a glitch split on headings. Black text on cyan/gold buttons.
**Type:** monospace everywhere for chrome (ui-monospace/SF Mono/Cascadia/JetBrains Mono/Consolas), 9-13 px uppercase labels with very wide tracking (.14em-.52em); system sans only for paragraph text. Headings 24-34 px mono. Brand is spaced caps `J.A.R.V.I.S.`.
**Shapes:** hairline 1 px borders; panels have corner ticks (L-shaped brackets at the four corners); buttons and the CTA have chamfered corners (`clip-path` polygon cut 6-10 px); no rounded corners except the circular orb/dots; dashed borders mean "empty/placeholder".
**Background:** faint 48 px cyan grid, soft cyan radial glow at top and bottom, and a scanline overlay (1 px dark line every 3 px, 35% opacity, overlay blend).
**Glow:** `box-shadow` 30-70 px cyan at 35-55%; text-shadow glow on greetings and step numbers; blinking status dots with glow.
**Orb:** an orb (video, screen blend, radial mask) with a "breathe" scale 0.93-1.07 over 3.4-3.6 s; a rotating SVG bezel of six rings (spin periods 18-130 s, alternating direction, some with drop-shadow glow, tick/label text); tap = bezel whirls once and the orb "pops" (scale 1.14, brightness 1.65) and it speaks a line ("At your service, sir.", "How may I assist, sir?", "Standing by, sir...").
**Motion:** elements "materialize" (rise 20 px, fade in from brightness 2.1, 0.8 s), headings do a cyan/magenta chromatic split for 0.55 s, panels get a one-shot scan sweep, agent cards stagger by 70 ms, typed text (5-45 ms/char), blinking cursor, section reveals on scroll. A wake sequence: orb surges to 2.7x and fades while the bezel spins 540 degrees. `prefers-reduced-motion` is honoured everywhere (static fallback), video is skipped on save-data.
**Sound:** (a) Web Audio sine blips - `blip` 1200->1900 Hz 90 ms, `deep` 160 Hz 350 ms, `confirm` two notes 880 then 1320 Hz 70 ms each; (b) 16 pre-recorded voice clips (a deep, formal male voice; mp3s embedded) for the welcome line and the daily brief, so the voice paces the typing. A sound on/off toggle (`◉ SND`) and "ENTER SILENT" always exist; sound only starts after a click (browser rule).
**Dark/light:** dark only. No light theme.
**Voice persona:** butler tone ("sir", dry wit). Brief format: spoken, short sentences, numbers highlighted in cyan, ends with a question ("What would you like me to handle first, sir?").

## User experience
- **First run (inferred):** download, one installer, setup wizard in-app, connect stack via playbooks, then first greeting "Good evening, sir". Landing page models the feel: an "initialize" gate, a short boot sequence with OK lines, then a greeting typed and spoken.
- **Talking to it:** hold Space, speak, release; it answers aloud (inferred). The orb is the voice presence and reacts to taps (seen in code for the site).
- **Replies:** the daily brief is the signature interaction - it speaks and types at once, one short paragraph per beat, with figures highlighted, ending in a recommendation and a question. Agent work is shown as a status card (name, role, `ACTIVE`) in the HUD and as per-agent Slack channels; actions that need a person arrive as a pull request or an approval ("Approve, veto, delegate").
- **Notifications:** not shown. Copy says agents "brief you when you walk in the room" and post to Slack.
- **Settings:** inferred only (see D).
- **Keyboard:** hold Space for voice (copy); Enter/Space on the site's init overlay.
- **Accessibility seen in code:** aria labels, focus-visible outline, reduced-motion; the page is dense, tiny (9-11 px) low-contrast `dim` text on near-black - a weakness, not something to copy.

## Features shown in the UI that Sage lacks (size = rough effort for Sage)
1. Always-visible central **voice orb with state** (idle / listening / thinking / speaking) - medium.
2. **A short spoken wake greeting** - small (Sage already speaks replies with the PC's own voices and has a Speak replies setting; a greeting reuses that).
3. **Time-of-day greeting and a "daily brief"** (reminders due, notes, anything pending, read aloud) - small-medium; fits Sage's reminders/notes.
4. **Dashboard/HUD view** with clock, status readouts and a brain/mic/network state panel - medium.
5. **Typed boot sequence** with OK lines (e.g. brain reachable, voice model ready, notes loaded) - small.
6. **Agent roster with status cards** - large; Sage has one assistant, so only a "skills" status list (Answer, Search, Notes, Reminders, Open app/file) is sensible - small.
7. **Voice log transcript view** (YOU / assistant rows, highlighted figures, REC badge) - small.
8. **Sound effects** (blip/confirm) with a sound toggle - small.
9. **Support code + COPY DIAGNOSTICS** in setup failures - small, valuable.
10. Spending cap for the online brain - small-medium (only relevant to online mode).
11. Slack command centre, ad/revenue/email integrations, multi-agent hand-offs, PR-writing developer agent - **large and out of scope**; Sage's ask-first model is deliberately narrower.
12. Linux voice is absent in their product; Sage already has voice on Windows and Linux - an advantage to keep.

## What we may and may not copy
**Theirs - do not copy:** the name "J.A.R.V.I.S." and the tagline wording ("Your entire business. One voice command.", "Stark built his in a cave", "Good evening, sir" persona/lines), the agent names and roles as a set, their orb and background videos and posters, the og image, their voice clips (and the voice itself), their exact SVG bezel artwork, any screenshots, the exact HUD arrangement (reactor centre + left/right panels + revenue box), the page copy, and the code. Also avoid using Marvel/Stark references: their footer disclaims them, and we should not borrow them either.
**Generic patterns - fine for an original design:** dark UI with a single glowing accent; a circular voice orb as the assistant's presence; thin concentric rings; dark translucent "glass" panels with hairline borders; corner-bracket ticks; monospace uppercase labels with wide tracking; status dots; typed text and a blinking cursor; subtle grid/scanline backdrop; push-to-talk; a daily brief; sound on/off toggle; reduced-motion support; `// 01` style section labels. Colours and spacing numbers are not protectable, but we should not paste their exact palette: pick our own.
**Rule of thumb:** follow the *idea*, draw our own artwork, write our own copy, synthesise our own sounds, use Sage's own name, leaf icon and green identity.

## Design brief for Sage
**Identity.** Keep the sage-green leaf icon and the name "Sage". Move from today's light/dark neutral theme (accent `#2f6f5e` / `#5fb39b`, system sans) to a calm "HUD in green" look: deep green-black ground, one luminous sage-mint accent, one warm amber for things that need the user's attention (ask-first boxes). Do not use cyan.
**Suggested tokens (own palette):** ground `#05100d`, panel `#0a1a15`, panel-2 `#0e231c`, line `#1c3b31`, line-bright `#2f6b58`, accent `#5fd3a8` (glow `rgba(95,211,168,.4)`), accent-dim `#2f8a6c`, text `#d6efe4`, muted `#7fa393`, amber `#ffc266` (ask-first/pending), danger `#ff6b6b`. Keep today's light theme as an option (system setting) since Sage already supports it; the HUD style is the dark theme. Contrast: keep body text >= 4.5:1 and no text under 12 px (their 9-11 px dim text fails this).
**Type:** UI chrome in a monospace stack (ui-monospace, Cascadia, JetBrains Mono, Consolas) for labels, status, clock, tabs; message text in the system sans at 15-16 px for readability. No web fonts (the app's CSP is `font-src 'self'`; bundle a font file only if wanted).
**Shapes:** hairline 1 px borders, 2-4 px radius at most, chamfered primary buttons via `clip-path`, corner ticks on panels, dashed border for empty states.
**Motion:** orb breathing (3.5 s), materialize-in for new messages (<= 300 ms, shorter than the site's 800 ms), no heavy video; draw the orb in CSS/SVG/canvas (no video files). All motion off under `prefers-reduced-motion`.
**Sound:** synthesised Web Audio only - soft `blip` on send, two-note `confirm` when an action is allowed, low `deep` on an ask-first box appearing; off by default or one-click toggle remembered in settings; no sampled voice at first.

### Buildable slices (smallest first)
1. **Theme tokens + chrome (small).** New dark "sage HUD" tokens in `styles.css`; mono labels; hairline panels; chamfer buttons; keep light theme. Status text in the top bar gets a glowing dot (brain: local/online; ok/error).
2. **Orb in the chat window (small-medium).** A 96-160 px CSS/SVG orb above or beside the message box with states: idle (breathe), listening (pulse with mic level, tied to the existing Hold-to-talk), thinking (slow ring spin), speaking (later). Replaces the plain "Hold to talk" look; the button stays for accessibility.
3. **Message styling (small).** Transcript rows labelled `YOU` (amber) and `SAGE` (accent), typed-in reveal for the newest reply (skippable), highlighted numbers/dates, tool results as small bordered cards with a status tag.
4. **Ask-first card (small, safety-critical).** Restyle the confirmation box as a prominent amber-bordered panel with corner ticks, the exact action text, and Allow / Decline; keep every existing rule (only the user answers, no "always allow"). Add the `confirm`/`deep` sounds here.
5. **Welcome screen as a boot sequence (small-medium).** Same steps and logic, shown as numbered `// 01 ... // 04` sections plus typed check lines (`> brain ........ OK`, `> voice ....... READY`), a progress bar for downloads, Skip setup kept. Add Support code + Copy diagnostics on failures.
6. **Home/HUD view (medium).** A third tab "Home" with a large orb, clock, time-of-day greeting, and three small panels: Today (reminders due, next reminder), Notes (latest), Status (brain, voice, last actions from the log). This is Sage's honest version of their dashboard; no revenue/agent widgets.
7. **Daily brief (medium).** One button or voice phrase: Sage lists reminders and recent notes in short beats, text first, optional speech later.
8. **Sound + toggle (small).** Web Audio blips as above, a `SND` toggle in the bar, remembered.
9. **Better voices (later, its own plan).** Sage already speaks replies with the PC's voices; a better offline voice is on the roadmap's Later list.
10. **Skills status list (small).** Settings or Home shows each skill with an `ACTIVE`/`ASK FIRST` tag, matching the README's table.
Out of scope: multi-agent roster, Slack, ad/revenue integrations, a developer agent, TV-wall mode (revisit later).

Constraints to keep: CSP stays strict (no remote assets, no inline script), nothing sent anywhere, no telemetry, accessible names on all controls, keyboard operable.

## Sources
- https://jarvis-agent.tech/ (home page)
- https://jarvis-agent.tech/assets/poster-demo.jpg (HUD on wall TV), poster-orb.jpg, poster-169.jpg, og.jpg (stock-style hologram panels, assets folder)
- https://jarvis-agent.tech/terms and /privacy (fetched, not analysed for UI)
- Web searches (standard mode, 2): found no reviews or screenshots of this product; unrelated hobby projects only (e.g. github.com/Ali120B/jarvis, github.com/jincocodev/openclaw-jarvis-ui), not used.
- Sage side: README.md, src/renderer/index.html, styles.css. See also [the similar-projects report](2026-11-15-similar-projects.md).

