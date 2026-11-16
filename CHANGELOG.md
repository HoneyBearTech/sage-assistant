# Changelog

All notable changes to Sage are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/HoneyBearTech/sage-assistant/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/HoneyBearTech/sage-assistant/releases/tag/v0.1.0
