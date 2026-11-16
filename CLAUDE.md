# sage-assistant: project guidelines

## Purpose

Sage (S.A.G.E., System for Assistance, Guidance & Execution) is a desktop assistant that runs on the
owner's own computer: an Electron app with a text chat, hold-to-talk voice recognised on the PC, a
switchable brain (a local model runner on `127.0.0.1`, or an online service with the chat-completions
format), a few skills, and an ask-first rule for anything that opens or deletes something. It installs on Windows (a one-click installer, see
`docs/releasing.md`) and runs from source on Windows and Linux. Safety and privacy are the point of the project: no local server, no command skill, no
bypass mode, no telemetry, and the online key encrypted by the operating system.

## Before structural changes

Read the notes first. They live in this repo's `docs/` folder:

- `docs/roadmap.md`: what has shipped, what is next, what is later, and what Sage will not do.
- `docs/decisions-log.md`: dated log of why past decisions were made (newest first).
- `docs/pass-map.md`: which change shipped in which pull request.

Also read `docs/architecture.md` and `docs/assurance-case.md` before touching skills, the gate, the key
store, the window's security settings or IPC. Update the notes as work lands; never delete items, tick or
strike them through with a reason.

## Commands

- `fnm use 24`: the tooling runs on Node 24.
- `npm install`: install dependencies (exact versions, `package-lock.json` is committed).
- `npm start`: build into `dist/` and open Sage's window.
- `npm run build`: build only (esbuild: main, preload and the speech helper as CommonJS, the window as
  one script; `sherpa-onnx-node` stays external).
- `npm test`: the tests (node:test through tsx); `npm run test:coverage` adds the 80% line floor.
- `npm run typecheck`: both TypeScript configs (`tsconfig.json` and `src/renderer/tsconfig.json`).
- `npm run check`: Biome lint and format check; `npm run format` rewrites.
- `npm run check:public`: the public-repo checker; `npm run secret-scan`: gitleaks (skipped if missing).
- `npm run verify`: all of the above; it must pass before any pull request.
- `npm run dist`: build, then make the Windows installer `out/Sage-Setup-<version>.exe` (Windows only).
- `npm run dist:dir`: build, then make the unpacked Windows app in `out/win-unpacked/` (also on Linux;
  read the fuses back with `npx @electron/fuses read --app out/win-unpacked/Sage.exe`). Built on Linux it
  carries the Linux speech engine, so voice works only in a Windows build made on Windows.

## Architecture

| Path | What it is |
| --- | --- |
| `src/core/brain/` | The `Brain` interface, `LocalBrain` (fixed to `127.0.0.1:11434`, `/api/chat`) and `OnlineBrain` (`<base>/v1/chat/completions`). Replies validated with zod. `runner.ts`: the runner's model list, model download (streamed, line-capped, 2-minute stall limit) and model details, on the same fixed address. |
| `src/core/setup.ts` | First-run setup: the runner's status, downloading one of Sage's two models through the runner (after the main process's box), the install guide's one fixed address (after its box), and `setupDone`. |
| `src/core/skills/` | The skill registry, the built-in skills, the ask-first `ApprovalGate`, the untrusted-text wrapper and the JSONL action log. |
| `src/core/assistant.ts` | One conversation: sends messages to the brain, runs tool calls through the registry, caps calls per turn. |
| `src/core/notes.ts`, `reminders.ts`, `scheduler.ts` | Notes and reminders as atomic JSON files in `userData`; the reminder scheduler with an injectable clock, which marks a reminder shown only after the notifier confirms it. |
| `src/core/notices.ts`, `src/main/notify.ts` | Messages from Sage itself for the window (reminders, data files set aside), delivered only when the window confirms it has shown them (`ackNotices`); the desktop notification, which reports only a confirmed show. |
| `src/core/search/` | `SearchProvider` and the DuckDuckGo HTML provider with a small dependency-free parser. |
| `src/core/settings.ts`, `keystore.ts` | Settings JSON (no secrets) and the `KeyStore` (encrypted file via an `Encryptor`). |
| `src/core/voice/` | Voice in the main process: the pinned speech model (`model.ts`), its download (`download.ts`), the speech helper's manager (`transcriber.ts`) and messages (`helper-protocol.ts`), and `Voice` (`voice.ts`), which asks in the main process's own box before downloading. |
| `src/helper/voice-helper.ts` | The speech helper, built as `dist/voice-helper.cjs` and run as Electron's utility process; the only code that loads `sherpa-onnx-node`. Keep it small: its logic is in `src/core/voice/helper-protocol.ts`. |
| `src/core/sage.ts` | Wires everything together from injected dependencies; tests use it with fakes. |
| `src/main/` | The Electron main process: `main.ts` (thin wiring), `security.ts` (window options, CSP, URL and permission rules), `ipc.ts` (validated handlers), `fuses-config.ts`. |
| `src/preload/preload.ts` | Exposes the typed `window.sage` API through `contextBridge`; nothing else. |
| `src/renderer/` | The chat window: plain TypeScript, HTML and CSS, no framework. Voice is in `voice-controls.ts` (hold to talk, the download offer, spoken replies), `voice.ts` (recorder, 16 kHz conversion, speech) and `voice-text.ts`; the Welcome screen is in `welcome.ts` and `welcome-text.ts`; the look's parts are `look.ts` (theme, reduced motion), `orb.ts`, `typing.ts`, `asking-cards.ts` and `sounds.ts` (with DOM-free `orb-state.ts`, `typing-time.ts` and `asking-text.ts` for the tests); `main.ts` is the entry the build bundles into `renderer.js`; it calls `startChatWindow()` from `renderer.ts`, which finds the elements and wires them up. Colours are `light-dark()` tokens in `styles.css` (`test/look.test.ts` checks contrast). |
| `scripts/` | Build, public-repo checker, secret scan, and the preview page (`npm run preview` into `out/preview/`, review only, never packed). |
| `build/` | The icon: `icon.svg` (the drawing) and `icon.png` (512 by 512, made from it; `build/README.md` says how). `electron-builder.json` names it for `Sage.exe` and the installer, and `npm run build` copies it to `dist/icon.png` for the window. |
| `electron-builder.json` | The installer settings: app id, the name "Sage" (only here; never `productName` in `package.json`, which would move the data folder), the NSIS installer, `asarUnpack` for the speech engine's native files, and the fuses, which must match `src/main/fuses-config.ts` (a test checks). |
| `test/` | Tests and saved search pages (`test/fixtures/`). `test/window.ts` starts the real window script on the fake DOM (`fake-dom.ts`) with stand-ins for the microphone, recorder, audio and speech (`fake-media.ts`). |

## Rules

- **Ask first, every time.** Any skill that opens, starts, changes or deletes something is
  `risk: "confirm"`. It runs only after the main-process dialog returns Allow for that exact call (call id
  plus a hash of the arguments, the exact action from `prepare` and the sentence shown), and each approval
  is used once. `run` acts only on the approved action and never looks anything up again. Never add an
  "always allow", a bypass, or a skill that runs commands. The chat's asking card is one-way news from
  `src/core/asking.ts` (the `sage:asking` event); never give the window a way to answer the box.
- **Skills that write without asking are capped per message** (`PER_TURN_SKILL_LIMITS` in
  `src/core/assistant.ts`); a new safe skill that writes something gets a cap too.
- **Skills come only from the model's tool-call output.** Text in replies, web pages, notes and files is
  never parsed for commands, and outside text goes back to the model wrapped as untrusted.
- **Apps only from the list in Settings**, launched with an argument array and `shell: false`. **Files
  only inside approved folders**, checked after `realpath`, only types on the allowlist in
  `src/core/files.ts` (documents, pictures, sound, video), opened with `shell.openPath`.
- **The online key never leaves the key store**: not in settings, logs, the action log, the chat, the
  window or error messages. It is tied to the service (origin) it was entered for and handed out only
  for that one (`ServiceKeys.keyFor`). Keep `test/key-leak.test.ts` and `test/key-binding.test.ts`
  passing and extend them for new writers.
- **Tests never sleep or use real timeouts or free-port tricks**: mocked timers, `FakeClock` or events
  (see CONTRIBUTING.md; `test/test-rules.test.ts` checks it).
- **The window stays locked down**: `contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity`,
  the strict CSP, local files only, no navigation, no pop-ups, no permissions except the microphone, the
  sender checked on every IPC handler. Change `src/main/security.ts` and its tests together.
- **No telemetry, analytics or crash reporting**, and no network calls from the window.
- **Voice.** The microphone is open only while the talk key or button is held (closed on release, after
  30 seconds, on blur, hidden window or New chat); sound and words are never saved or logged. The words
  go into the message box, never sent by themselves (Enter sends only on a fresh press, not a repeat or
  while the key that started a recording is held). The window needs no new permission, worklet, worker,
  `blob:` address or CSP change. The speech file is downloaded only by the main process, only after its
  own box returns Download, from the pinned addresses in `src/core/voice/model.ts`, https only, checked
  by size and SHA-256; it is the only thing Sage downloads by itself. Spoken replies use only voices
  installed on the PC (`localService`). The speech engine is loaded only in the speech helper.
- **The speech engine** (`sherpa-onnx-node` and its `sherpa-onnx-<platform>-<arch>` packages) is updated
  as one Renovate pull request: check install scripts again, keep its native files unpacked, and run the
  Voice section of `docs/windows-checklist.md` before merging.
- **First-run setup.** The window names only `standard` or `smaller`, never a model name; a model is
  downloaded by the local model runner, not by Sage, only after the main process's own box returns
  Download, and saved as the local model only once it is there. The runner's replies are capped and
  checked, and its text is never shown or logged. Sage opens exactly one web address, the install
  guide (`INSTALL_GUIDE_URL` in `src/core/setup.ts`), only from the main process and only after its box
  returns Open; never add another, or take an address from the window, a reply or a page. `setupDone`
  is changed only by `finishSetup`; a Settings save keeps it, and setup requests change only their own
  fields through `SettingsStore.update`. Notices are confirmed and Ctrl+Space works only while Chat is
  visible.
- **Tests never use the real network**, real settings or real user data: fake servers on `127.0.0.1`,
  temporary folders, fake key store, fake clock.
- **Logic in `src/core/`** where tests reach it; keep `src/main/main.ts` thin.
- **Dependencies**: exact versions, few, permissive licences, no vendor SDKs (plain `fetch`).
- **Public repository**: no private IP addresses, LAN host names, home paths or personal e-mail
  addresses, also when written with the JSON escapes `\u` plus four hex digits, `\\` or `\/`; `npm run check:public` enforces it. Product docs may name the local model runner.
- **Checks run locally** with `npm run verify`. On GitHub every pull request also gets CI (the same
  command on Ubuntu and Windows), the DCO check, a secret scan, CodeQL and dependency review; Scorecard
  runs on `main`. The record is `docs/github-checks.md`; the workflows are in `.github/workflows/`.
- One change per pull request; every commit signed off (DCO). Never push to `main`.

## Context

- Owner: HoneyBearTech. Licence: MIT.
- Node 24 for tooling; Electron 45.3.2; TypeScript strict; Biome 2.6.8; zod 4 for validation;
  sherpa-onnx-node 2.0.1 (the one run-time dependency) with the Moonshine tiny English model.
- Sage's data lives in Electron's `userData` folder (`%APPDATA%\sage-assistant` on Windows,
  `~/.config/sage-assistant` on Linux).
- Planned jobs, one pull request each: wake word, better voices, signing and updates, macOS. See
  `docs/roadmap.md`.
- The review machine runs Linux without a display, so Electron itself isn't started in the tests;
  `docs/windows-checklist.md` lists the manual checks to run on Windows.
