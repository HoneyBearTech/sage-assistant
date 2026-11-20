# Changelog

All notable changes to Sage are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Renovate now merges its own update pull requests (majors included, squash) once every required check passes, after a three-day wait for new versions. Electron major updates, esbuild, electron-builder, the sherpa-onnx speech engine and Biome stay manual.

### Fixed

- Web search now treats only duckduckgo.com and its own subdomains as DuckDuckGo, so a look-alike name is no longer taken for its redirect.

## [0.2.0] - 2026-11-16

### Added

- **The Welcome screen as a start-up sequence.** Its four steps are numbered sections in the new look
  (01 Where Sage thinks, 02 Model runner, 03 Model, 04 Ready), and each one lists what Sage checked as
  short typed lines, such as "Looking for the local model runner... found", "Runner version 0.12.3...
  ok", "Model qwen3:4b... ready" or "Voice... not downloaded". Every line comes from a real answer
  (the runner's status and version, the model download's result, the voice status), never made-up
  progress. A click or a key shows them all; with reduced motion they appear at once; screen readers
  hear each set once, through one polite status area. Sage now asks the local model runner for its
  version, and keeps it only if it is a plain version number.
- **Support codes.** A failed check shows a short code next to its plain sentence, such as
  `SAGE-RUN-01` (the local model runner didn't answer) or `SAGE-MOD-02` (not enough disk space). The new
  [Support codes](docs/installing.md#support-codes) table under Troubleshooting says what each means
  and what to try.
- **Copy diagnostics.** A failed step offers **Copy diagnostics…**: Sage puts together a short text on
  your PC (its version, the system, the processor, the step and code, the kind of brain, whether the
  runner answered and its version, the model tried and the saved one and whether each is
  downloaded, the voice status, the theme and
  reduced motion), shows all of it in a read-only box, and **Copy to clipboard** asks Sage to copy exactly
  that text (up to 3 times, within 2 minutes; the window can't choose the text).
  It never holds a key, a web or e-mail address, your user name, a folder path, notes or reminders,
  and Sage sends it nowhere.
- **A Home screen, first in the tab bar (Home, Chat, Settings).** Sage now opens on Home (the Welcome
  screen still comes first until setup is done). Home has a large orb that shows the same state as the
  chat's, a clock in your PC's own time format (it changes on the minute), a greeting for the time of
  day, and three panels: **Today** (reminders due today and up to five missed ones, the newest, with
  their times; missed ones are marked, and "N more missed" counts the rest, so old missed reminders
  never hide what is still to come today), **Notes** (the titles of your five most recently changed notes) and **Status** (the brain
  in use, whether voice is ready, whether sound is on, and the next reminder). Empty panels say so
  plainly. **Talk to Sage** opens Chat with the message box ready.
- **A daily brief.** **Brief me** on Home puts together a short brief from the same summary, in fixed
  words: the greeting and the date, today's reminders (or that nothing is due, and the next one), missed
  ones ("and N more" when some were left out), your latest note titles, then "What would you like to
  start with?". It is made on your PC and never sent to the brain, so it works offline and costs
  nothing with an online brain. It types itself out like a reply and is read aloud unless Read replies
  aloud is set to *Never*. The Brief panel has its own **Stop speaking** button while it is read aloud;
  leaving Home, hiding the window, sending a message or holding Talk also stops it, and a brief that
  arrives after you have left Home is dropped.
- **Settings → Home → Brief me when Sage first opens each day** (off by default). When it is on, the
  first time Sage's window opens on a new day, Home shows the brief; it is read aloud only when Read
  replies aloud is set to *Always*. Moving the PC's clock back a day doesn't bring a second brief.
  Settings files from 0.1.1 and from the online brains change load
  unchanged, with it off.
- **More online brains, with your own keys.** Settings → Brain is now a list: *On this computer* (still
  the default), *Claude* (an Anthropic key), *OpenAI* (an OpenAI key), *Gemini* (a Google AI Studio key)
  and *Another online service* (an address and a key, as before). Each choice has a one-line note on
  what it costs, that its key is kept in your system's protected storage, and that what you type and
  the results of Sage's skills go to that company. When you pick an online brain (and when you save
  it), Sage says the same in one line. Sage's skills and its ask-first rule are unchanged: the services only
  answer, or ask to use one of Sage's skills.
- **Claude through Anthropic's Messages API**, **OpenAI through its Responses API** (its current models
  take tools only there; Sage asks OpenAI not to keep the conversation for later use with `store: false`,
  while each company may still keep requests for a time under its own data policies) and **Gemini through Google's own API**, each with
  Sage's skills as tools. Within one message, each reply goes back to its service exactly as it came
  (thinking blocks, signatures and encrypted reasoning included), the tools list never changes (tool
  use is switched off past the skill limit), and a refused thinking signature is retried once without
  thinking. Replies may use up to 16,000 tokens and three minutes, since thinking counts toward both;
  a reply cut off at the limit keeps its text and says so. No new packages.
- **One key per company,** each encrypted on its own and sent only to its company's fixed address,
  checked at the moment of each request. Switching brains never mixes keys; removing one keeps the
  others. On Linux, keys are still refused without a real keyring.
- **Load models** asks the company for its current models to pick from (the model box stays editable),
  **Test** checks a saved key with one free request, and **Get a key** opens the company's key page in
  your web browser, after Sage's own asking box, at a fixed address.
- **Clear errors** for a wrong or revoked key, credit or quota used up (including prepaid credit and a
  daily free-tier quota), a model that doesn't exist or was retired, a busy service, a time-out and no
  network. The service's own error text is never shown or saved.
- **Load models and Test** run one at a time per company, and reuse an answer for a few seconds.
- Changing the chosen brain's model or key stops an answer in progress, as switching brains does. A key
  may hold only printable ASCII characters.
- **Theme setting:** Settings → Look → Theme: *Dark* (the default), *Light* or *Match system*. Older
  settings files load with *Dark*.
- **The orb:** a glowing ring above the message box that shows what Sage is doing: ready, listening
  while you hold the talk key or button, thinking while a reply is on its way, and speaking while a
  reply is read aloud. **Hold to talk** stays a button.
- **The asking card:** while Sage's box asks before an action, the chat shows the same question in an
  amber card, then whether you allowed it. You still answer in the box, and only there.
- **Sound effects,** made by the window itself: a blip when you send, two rising notes when you allow
  an action, a low tone when Sage asks. Off until you switch on **Sound** in the top bar; remembered.
- **A preview page for review** (`npm run preview`, into `out/preview/`): the real window with sample
  data and a control strip. Not part of Sage.

### Changed

- **Settings files from 0.1.1 move over unchanged.** The online service becomes *Another online
  service*, with the same address, model and key; a local brain stays local.
- **The privacy note:** "nothing you type leaves your computer" now says it holds for *On this computer*
  only, and the README says what each online brain sends where. Online brains cost money per use, and
  Sage can't cap spending: the README, the Welcome screen and Settings point to each company's own
  spending limits.
- **A new look: a calm heads-up display in green.** The window is dark by default: a deep green-black
  ground with a faint grid, one sage-mint accent, amber for you and for anything waiting on you,
  hairline panels with corner ticks, cut-corner main buttons, and small monospace capitals for tabs,
  labels and status, all in the PC's own fonts. Messages stay in the system font, larger (16 px). No
  text is smaller than 12 px, and the main colours keep at least 4.5 to 1 contrast in both themes.
- **The chat is a transcript.** Rows labelled `YOU` and `SAGE` instead of bubbles; Sage's newest reply
  types itself out in about a second at most, and a click or any key shows it all at once. Notices
  keep their own dashed card.
- **Reduced motion is honoured.** With the system's "reduce motion" setting on, nothing in the window
  moves and replies appear at once.

## [0.1.1] - 2026-11-16

### Changed

- **The chat window's script is now a function, `startChatWindow()`, so the coverage report counts it
  once.** Each window test used to load the script again and every load was counted as a separate,
  partly covered file. `src/renderer/main.ts` calls the function and the build bundles it into the same
  `renderer.js`. The window code is reorganised, not changed: Sage behaves the same.

### Fixed

- **The installer build tools use a fixed minimatch** (GHSA-g3hv-75wg-m249, a denial of service in a
  file-pattern matcher). An npm `overrides` entry moves the two affected copies to minimatch 11; the
  packaged app has the same files as before. `npm audit` now reports no findings.
- **The public-repo checker also reads text written with escapes.** An e-mail address, private address,
  LAN host name or home folder written with JSON escapes is now decoded and checked too, and reported once, marked "(written with
  escapes)". The escapes decoded are `\u` with four hex digits, an escaped backslash (two backslashes)
  and `\/`; nothing else.
- **A deleted reminder can no longer show once in the chat.** Opening Chat, or bringing the window back
  into view, now collects Sage's notices again before confirming the ones held, so a notice whose
  reminder was just deleted is removed instead of appearing.

## [0.1.0] - 2026-11-16

### Added

- **A Sage icon:** a white leaf on a sage-green tile, for the installer, `Sage.exe`, the Start-menu and
  desktop shortcuts, the taskbar and the window (also when run from source). The drawing is
  `build/icon.svg`.
- **First-run setup: a Welcome screen.** The first time Sage starts, a Welcome screen in its window sets
  it up step by step: where Sage thinks (on this computer, or an online service, which opens Settings);
  whether the local model runner is running, with **Check again**, short install steps and **Open the
  install guide**; a model, **Standard** (`qwen3:4b`, about 2.5 GB) or **Smaller** (`qwen3:1.7b`, about
  1.4 GB), with already-downloaded models marked; and Done. **Skip setup** is always there, and
  **Settings → Set up Sage** opens the screen again. Settings files from earlier versions load unchanged
  and show the Welcome screen once; skipping or finishing changes nothing else.
- **A model download through the local model runner**, only after you agree in Sage's own box
  ("Download the Standard model (about 2.5 GB)?"), with progress, **Cancel** and **Try again**. The runner
  downloads the model and checks its files; Sage shows only its own messages (offline, not enough disk
  space, model not found, or another error), stops a download that makes no progress for 2 minutes, and
  saves the model as the local model, and switches the brain to this computer, only once it is there
  (the box and the Welcome screen say so). Afterwards Sage asks the runner whether the model can use
  its skills and says so if not.
- **Sage's first link out:** **Open the install guide** asks first ("Open Sage's install guide in your
  web browser?"), then opens one fixed address, the local model runner section of Sage's own install
  guide on GitHub. If no browser opens, Sage shows the address to copy. Nothing else can be opened.

- **Voice: hold to talk.** Hold Ctrl+Space while Sage's window is focused, or press and hold the new
  **Hold to talk** button, and speak (up to 30 seconds). Sage works out what you said on your PC, with the
  sherpa-onnx speech engine and the Moonshine tiny English model, and puts the words in the message box
  for you to check: they are never sent by themselves. The microphone is on only while you hold, and
  turns off if the window loses focus or you start a New chat. The sound is never saved or logged.
  Plain messages if the microphone is blocked (with where to allow it in Windows) or missing, or if
  nothing was heard.
- **A one-time speech file download**, only after you agree in Sage's own box ("Voice needs a 44 MB
  speech file from Hugging Face. Download it now?"), with progress, Cancel and Try again. The three
  files come from fixed addresses pinned to one version, over https only, and are used only if their
  size and SHA-256 fingerprint match. It is the only thing Sage downloads by itself; none of your
  speech or text is sent with it (it is an ordinary file download from Hugging Face). Sage checks the
  files' fingerprints again before first use in each run, and stops a download that stalls for 30
  seconds. Voice works offline after that.
- **Spoken replies** with a voice installed on your PC, and a new setting, **Read replies aloud**:
  after voice messages (the default), always, or never. **Stop speaking**, the talk key and New chat
  stop it. Settings says so if the PC has no voice. Settings files from earlier versions load unchanged.
- **Sage's first run-time dependency**, the speech engine `sherpa-onnx-node` 2.0.1 (Apache-2.0, no install
  scripts), loaded only in a separate helper process, so a slow or crashing recognition can't freeze or
  close the window. Its native files are kept unpacked next to the app archive; build the Windows
  installer on Windows. Renovate updates the engine's packages together.

- **A one-click Windows installer**, `Sage-Setup-<version>.exe`: it installs for your account only,
  without admin rights, adds Start-menu and desktop shortcuts, and starts Sage. The installed app uses the
  same data folder as a copy run from source, and uninstalling keeps your data. `npm run dist` builds it
  on Windows; `npm run dist:dir` builds the unpacked app, also on Linux. It isn't code-signed yet.
- **Two more hardening fuses** in the packaged app: pages loaded from files get no extra privileges, and
  cookies are encrypted. electron-builder sets all the fuses while packaging, and a test keeps its
  settings and `src/main/fuses-config.ts` the same.
- **A release workflow, ready for the owner to add** ([docs/releasing.md](docs/releasing.md)): on a
  version tag it builds the installer on GitHub and publishes it with a `SHA256SUMS.txt` checksum and a
  signed build provenance. The install guide explains how to check both, and releases now follow
  Semantic Versioning with only the latest supported.

- **Biome 2.6.8** for linting and formatting; its Markdown formatter is turned off so the hand-written docs stay as written.
- **Renovate** keeps the npm dependencies and the pinned GitHub Actions current, in weekly pull requests
  that go through every check; the docs now describe the checks that run on GitHub.
- **A text-chat assistant that runs from source** on Windows and Linux: `npm install`, then `npm start`.
- **A switchable brain**: a local model through Ollama on `127.0.0.1` (the default), or an online model
  service that offers the chat-completions format, with your own key. If Ollama isn't running, Sage says so
  in plain words.
- **Skills**: answer, web search (DuckDuckGo's HTML page, no key), notes (list, read, add), reminders (list,
  add, with a desktop notification when due, or a message in the window if a notification can't be shown; a
  reminder counts as seen only once it is in the chat with the Chat view open, and one that wasn't seen comes back
  on the next check or start, once; a deleted reminder is taken out of the window's queue and never appears),
  open an app from your list, open a document, picture, sound or video file in an approved folder, and
  delete a note or reminder.
- **Plain-English notices in the window** when a settings, notes or reminders file couldn't be read: the
  old file is kept, and the notice says where.
- **The ask-first rule**: opening an app or a file and deleting a note or reminder always show a
  confirmation box that says exactly what will happen, on one clean line. Each approval works once, for that
  exact action: the approved program or file is what runs, and a change while the box is open blocks it.
  **New chat** drops a reply still in progress, including any action waiting for the box, and Send works
  again at once. Text in the box is quoted and cleaned of invisible look-alike characters. On Windows, file
  names with `:` (alternate data streams) are refused.
  There is no run-a-command skill and no "always allow" mode. Every action you allow or decline is written
  to a local action log.
- **Untrusted text stays data**: web results and notes go back to the model labelled as untrusted, and skills
  run only from the model's own tool calls, at most six per message (and at most three new notes and three
  new reminders).
- **The online key is encrypted** with the operating system's protection (Electron safeStorage) and never
  written to settings, logs, the action log or the chat. A key repeated in a service's reply is replaced
  with `[redacted]`. The key is tied to the service it was entered for and only ever sent there: changing
  the service's address removes it, and a reply still in progress for the old service is stopped. **Save key**
  works only for the address that is saved: with a new address typed but not saved, it asks you to save the
  settings first.
- **A locked-down window**: sandboxed, context-isolated, no Node access, a strict Content-Security-Policy,
  only local files, no navigation or pop-ups, and the microphone as the only permission it can be given.
- **No telemetry** or analytics of any kind.
- **Project files and checks**: licence, security policy, contribution guide, governance, code of conduct,
  support policy, issue and pull request templates, and `npm run verify` (lint and format, typecheck, tests
  with an 80% coverage floor, a public-repo checker and a secret scan).

### Changed

- When the local model runner can't be reached, or the model isn't downloaded, the chat message points
  to **Settings → Set up Sage** instead of a command to type.
- The talk key (Ctrl+Space) works only while the chat is shown, and Sage's window starts with the chat
  hidden until it knows whether to show the Welcome screen.

[Unreleased]: https://github.com/HoneyBearTech/sage-assistant/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/HoneyBearTech/sage-assistant/releases/tag/v0.2.0
[0.1.1]: https://github.com/HoneyBearTech/sage-assistant/releases/tag/v0.1.1
[0.1.0]: https://github.com/HoneyBearTech/sage-assistant/releases/tag/v0.1.0
