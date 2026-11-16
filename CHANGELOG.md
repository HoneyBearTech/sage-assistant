# Changelog

All notable changes to Sage are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions will follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
