# sage-assistant: project guidelines

## Purpose

Sage (S.A.G.E., System for Assistance, Guidance & Execution) is a desktop assistant that runs on the
owner's own computer: an Electron app with a text chat, a switchable brain (a local model runner on
`127.0.0.1`, or an online service with the chat-completions format), a few skills, and an ask-first rule
for anything that opens or deletes something. It installs on Windows (installer planned) and runs from
source on Linux. Safety and privacy are the point of the project: no local server, no command skill, no
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
- `npm run build`: build only (esbuild: main and preload as CommonJS, the window as one script).
- `npm test`: the tests (node:test through tsx); `npm run test:coverage` adds the 80% line floor.
- `npm run typecheck`: both TypeScript configs (`tsconfig.json` and `src/renderer/tsconfig.json`).
- `npm run check`: Biome lint and format check; `npm run format` rewrites.
- `npm run check:public`: the public-repo checker; `npm run secret-scan`: gitleaks (skipped if missing).
- `npm run verify`: all of the above; it must pass before any pull request.
- `npm run fuses -- <packaged binary>`: Electron's hardening fuses, for the installer job only.

## Architecture

| Path | What it is |
| --- | --- |
| `src/core/brain/` | The `Brain` interface, `LocalBrain` (fixed to `127.0.0.1:11434`, `/api/chat`) and `OnlineBrain` (`<base>/v1/chat/completions`). Replies validated with zod. |
| `src/core/skills/` | The skill registry, the built-in skills, the ask-first `ApprovalGate`, the untrusted-text wrapper and the JSONL action log. |
| `src/core/assistant.ts` | One conversation: sends messages to the brain, runs tool calls through the registry, caps calls per turn. |
| `src/core/notes.ts`, `reminders.ts`, `scheduler.ts` | Notes and reminders as atomic JSON files in `userData`; the reminder scheduler with an injectable clock, which marks a reminder shown only after the notifier confirms it. |
| `src/core/notices.ts`, `src/main/notify.ts` | Messages from Sage itself for the window (reminders, data files set aside), delivered only when the window confirms it has shown them (`ackNotices`); the desktop notification, which reports only a confirmed show. |
| `src/core/search/` | `SearchProvider` and the DuckDuckGo HTML provider with a small dependency-free parser. |
| `src/core/settings.ts`, `keystore.ts` | Settings JSON (no secrets) and the `KeyStore` (encrypted file via an `Encryptor`). |
| `src/core/sage.ts` | Wires everything together from injected dependencies; tests use it with fakes. |
| `src/main/` | The Electron main process: `main.ts` (thin wiring), `security.ts` (window options, CSP, URL and permission rules), `ipc.ts` (validated handlers), `fuses-config.ts`. |
| `src/preload/preload.ts` | Exposes the typed `window.sage` API through `contextBridge`; nothing else. |
| `src/renderer/` | The chat window: plain TypeScript, HTML and CSS, no framework. |
| `scripts/` | Build, public-repo checker, secret scan, fuses. |
| `test/` | Tests and saved search pages (`test/fixtures/`). |

## Rules

- **Ask first, every time.** Any skill that opens, starts, changes or deletes something is
  `risk: "confirm"`. It runs only after the main-process dialog returns Allow for that exact call (call id
  plus a hash of the arguments, the exact action from `prepare` and the sentence shown), and each approval
  is used once. `run` acts only on the approved action and never looks anything up again. Never add an
  "always allow", a bypass, or a skill that runs commands.
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
- **Tests never use the real network**, real settings or real user data: fake servers on `127.0.0.1`,
  temporary folders, fake key store, fake clock.
- **Logic in `src/core/`** where tests reach it; keep `src/main/main.ts` thin.
- **Dependencies**: exact versions, few, permissive licences, no vendor SDKs (plain `fetch`).
- **Public repository**: no private IP addresses, LAN host names, home paths or personal e-mail
  addresses; `npm run check:public` enforces it. Product docs may name the local model runner.
- **Checks run locally** with `npm run verify`. GitHub runs nothing yet; never claim it does. The
  ready-to-paste workflows are in `docs/github-checks-to-add.md`, for the owner to add.
- One change per pull request; every commit signed off (DCO). Never push to `main`.

## Context

- Owner: HoneyBearTech. Licence: MIT.
- Node 24 for tooling; Electron 45.3.2; TypeScript strict; Biome 2.5.15; zod 4 for validation.
- Sage's data lives in Electron's `userData` folder (`%APPDATA%\sage-assistant` on Windows,
  `~/.config/sage-assistant` on Linux).
- Planned jobs, one pull request each: Windows installer, voice, first-run setup; later wake word,
  better voices, signing and updates, macOS. See `docs/roadmap.md`.
- The review machine runs Linux without a display, so Electron itself isn't started in the tests;
  `docs/windows-checklist.md` lists the manual checks to run on Windows.
