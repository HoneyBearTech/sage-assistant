# Architecture

Sage is one Electron app written in TypeScript. There is no local web server and no background
service: the chat window talks only to the app's own main process, through a handful of typed calls.
Speech recognition runs in a small helper process that the main process starts when voice is first
used.

## Components

```text
+------------------------------- Sage (one Electron app) --------------------------------+
|                                                                                         |
|  Chat window (renderer)            Main process                                         |
|  sandboxed, no Node      IPC       +-----------------------------------------------+    |
|  chat, settings,    <----------->  | ipc.ts: validated handlers, sender checked     |    |
|  microphone, voices window.sage    | Assistant: one conversation, tool-call loop    |    |
|  (src/renderer)     (src/preload)  | SkillRegistry + ApprovalGate + action log      |    |
|                                    | Notes, reminders, scheduler, settings, keys    |    |
|                                    | Voice: speech file, its download, recordings   |    |
|                                    | Setup: the runner's status, a model download   |    |
|                                    +-----------------------------------------------+    |
|                                       |         |          |         |         |          |
|                                       |         |          |         |   Speech helper    |
|                                       |         |          |         |   (utility process,|
|                                       |         |          |         |   speech engine)   |
+---------------------------------------|---------|----------|---------|--------------------+
                                        v         v          v         v
                          Ollama on 127.0.0.1  online     DuckDuckGo  Hugging Face     confirmation box,
                          (local brain)        model      HTML page   (the speech      notifications,
                                               service    (search)    file, once,      apps and files
                                               (optional)             after asking)
```

| Part | Where | What it does |
| --- | --- | --- |
| Chat window | `src/renderer/` | Plain TypeScript, HTML and CSS. Shows the chat, the settings screen and, on first start, the Welcome screen. Runs sandboxed with no Node access; inserts text only with `textContent`. |
| Preload | `src/preload/preload.ts` | Exposes `window.sage` with twenty typed methods through `contextBridge`; nothing else. |
| IPC handlers | `src/main/ipc.ts` | One handler per channel. Validates every payload with zod; never sends the key to the window (only whether one is saved). Removes the saved key when the online address moves to a different service, saves a new key only when the address on screen is the saved one, and stops a turn in progress when the brain or the service changes. |
| Notifications | `src/main/notify.ts` | Shows a reminder as a desktop notification and waits up to 5 seconds for the system to confirm it. Reports whether it was confirmed; it never reports a guess. |
| Main wiring | `src/main/main.ts` | Creates the window, locks down the session (permissions, requests, navigation), supplies the native confirmation dialog, the Welcome screen's two boxes (before a model download and before opening the install guide), notifications, `shell.openPath`, `shell.openExternal` (used only for the install guide's fixed address), the app launcher and the encrypted key store. Checks the sender of every IPC call. |
| Window security | `src/main/security.ts` | The window options, the CSP and the URL and permission rules, as pure functions the tests check. |
| Assistant | `src/core/assistant.ts` | Sends the conversation and the skill list to the brain, runs the tool calls it returns through the registry, and stops after six tool calls or six rounds per message (three each for `add_note` and `add_reminder`). **New chat** abandons a turn in progress: it runs no further tool calls and writes nothing to the history. |
| Brain | `src/core/brain/` | `LocalBrain` (Ollama's `/api/chat` on `127.0.0.1:11434`) and `OnlineBrain` (`<base>/v1/chat/completions`). Settings pick one for each message. |
| Skills | `src/core/skills/` | The registry, the eleven built-in skills, the ask-first gate, the untrusted-text wrapper and the action log. |
| Data stores | `src/core/notes.ts`, `reminders.ts`, `settings.ts`, `keystore.ts` | JSON files written atomically, and the encrypted key file. |
| Scheduler | `src/core/scheduler.ts` | Checks reminders every 15 seconds and shows each one that is due, once. If the desktop notification isn't confirmed, the reminder goes to the notice board. It is marked as shown only when the desktop confirmed it or the window confirmed it is on screen; until then it stays due and comes back on the next check or the next start. Each reminder is handled on its own, and one that was shown but couldn't be recorded is never shown again. |
| Notices | `src/core/notices.ts` | Messages from Sage itself (reminders for the window, data files set aside), collected by the window every 5 seconds and shown in the chat. Each notice has an id; the window confirms the ids it has put in the chat once the Chat view is open and the window isn't hidden or minimised, and only that delivers a notice. One not yet confirmed is handed out again with the same id, so the window skips it if it already shows it. Deleting a reminder withdraws its notice, and a reminder that no longer exists is skipped. At most 50 wait at once (confirmed or not): the oldest are kept, and the window is told how many more are waiting. |
| Service keys | `src/core/keystore.ts` | The key is saved together with the service (origin) it was entered for, and each turn's online brain asks only for the key of its own service. |
| Search | `src/core/search/` | The `SearchProvider` interface and the DuckDuckGo HTML provider with its parser. |
| Voice | `src/core/voice/` | `model.ts`: the speech model's three files (pinned address, exact size, SHA-256). `download.ts`: the download (https only, at most five forwards, size cap, fingerprint check, 30-second stall limit, moved into place only when all match, leftovers deleted). `transcriber.ts`: starts the speech helper, one recording at a time, 60-second limit, a fresh helper after a crash. `helper-protocol.ts`: the validated messages between the two, and the helper's own logic. `voice.ts`: ties them together; the download only after the main process's own box says Download, and the files' fingerprints checked again once per run before first use. |
| Speech helper | `src/helper/voice-helper.ts` | Built as `dist/voice-helper.cjs` and run as Electron's utility process. The only code that loads the speech engine (`sherpa-onnx-node`); gets sound, sends back text. |
| Window voice | `src/renderer/voice-controls.ts`, `voice.ts`, `voice-text.ts` | Hold to talk (Ctrl+Space or the Talk button), recording with the standard recorder, turning it into 16 kHz mono sound, the download offer, and spoken replies with the window's own speech and the PC's installed voices. `renderer.ts` only finds the elements. |
| Runner client | `src/core/brain/runner.ts` | The local model runner's other requests on the same fixed `127.0.0.1` address as chat: the model list (`/api/tags`), a model download (`/api/pull`, progress read line by line, each line capped at 64 KB and checked, stopped after 2 minutes without a new line) and a model's details (`/api/show`, whether it can use tools). No redirects, short time limits for the quick requests, replies size-capped; the runner's own text is never shown or logged. |
| Setup | `src/core/setup.ts` | First-run setup: the runner's status for the saved local model and Sage's two models, one download at a time of one of those two (only after the main process's box says Download, stopped when Sage quits), saving it as the local model once it is there, the skills check, opening the install guide's one fixed address after asking, and marking setup done. |
| Window welcome | `src/renderer/welcome.ts`, `welcome-text.ts` | The Welcome screen's steps and texts: where Sage thinks, the runner, a model (with progress polled every half second) and Done. |
| Wiring for tests | `src/core/sage.ts` | Builds all of the above from injected parts; the tests use it with fakes. |

## Skills

| Skill | Risk | What it does |
| --- | --- | --- |
| `answer` | safe | Ends the turn with a plain reply. |
| `web_search` | safe | Searches DuckDuckGo's HTML page; results come back as untrusted text. |
| `list_notes`, `read_note` | safe | Lists or reads notes; their text comes back as untrusted. |
| `add_note` | safe | Saves a new note. |
| `list_reminders` | safe | Lists reminders that haven't gone off; their text comes back as untrusted. |
| `add_reminder` | safe | Saves a reminder for a time in ISO 8601 (local time if no zone), up to five years ahead. |
| `delete_note`, `delete_reminder` | confirm | Deletes one note or reminder by id. |
| `open_app` | confirm | Starts an app from the list in Settings, by name, with the fixed arguments stored there. |
| `open_file` | confirm | Opens a file inside an approved folder with its default app. |

## How a message flows

1. You type a message. The window calls `window.sage.send(text)`; the preload turns that into one IPC
   call. The main process checks that it came from Sage's own page in Sage's own window, and validates
   it.
2. The assistant builds the conversation: a system prompt (with the date, time and the rules about
   untrusted text), the last 20 messages, and yours. It reads the settings and picks the brain.
3. The brain replies with text, or with tool calls in its structured tool-call output. Each tool call
   gets a fresh id chosen by Sage, never one from the model. Text in the reply is never searched for
   commands.
4. For each tool call (at most six per message), the registry looks up the skill and validates the
   arguments against its strict schema (unknown fields are refused).
   - A **safe** skill runs. If its output comes from outside (web pages, notes), it is wrapped in a
     labelled `<<<UNTRUSTED ... UNTRUSTED>>>` block, with any markers inside it neutralised.
   - A **confirm** skill first runs its `prepare` step, which checks the call is allowed (the app is on
     the list, the file is in an approved folder, the note exists), works out the exact action (the
     program path and arguments, or the file's real path) and writes one clean sentence that says
     exactly what will happen. Then the main process shows a native dialog with that sentence and two
     buttons, **Don't allow** (the default) and **Allow**. Only **Allow** creates an approval, tied to
     that call id and a SHA-256 hash of the skill name, the arguments, the action and the sentence. The
     registry then uses the approval up (`consume`), runs `prepare` again (it must give the same hash),
     and runs the skill with the approved action. If the chat was cleared or the brain settings
     changed at any point between the box and the action, nothing runs. The decision and the outcome
     are appended to `action-log.jsonl`.
5. The results go back to the brain, which answers or asks for more tools. The final text is shown in
   the window.

## How voice works

1. You hold **Ctrl+Space** (while Sage's window is focused) or the **Hold to talk** button. If the speech
   file isn't there yet, the window offers the download instead (see below).
2. The window opens the microphone with `getUserMedia({ audio: true })`, the only permission it can be
   given, and records with the browser's standard `MediaRecorder`. A timer shows "Listening…". The
   microphone closes as soon as you let go, after 30 seconds, when the window loses focus or is hidden,
   or on **New chat** (which drops the recording). A tap under 0.4 seconds is ignored.
3. The window decodes the recording (`AudioContext.decodeAudioData`) and turns it into one channel of
   16,000 samples a second (`OfflineAudioContext`), as 16-bit samples, cut to 30 seconds. No worklets,
   workers or `blob:` addresses, and no change to the window's content rule.
4. It sends that once (`window.sage.transcribe`). The main process checks it is an `Int16Array` of 1 to
   480,000 samples, on a buffer no bigger than that, before reading it; one recording is worked out at a
   time.
5. The main process starts the speech helper on first use (Electron's utility process, a separate
   process with no window) and sends it the sound as 32-bit floats. The helper loads the engine and the
   model once and sends back the text. A helper that takes over 60 seconds is stopped; one that crashes
   gives a plain message, and the next recording starts a fresh one.
6. The words go **into the message box**, after anything already there. You check them and press Enter.
   A message counts as a voice message if any of its words came from talking.
7. Sage's final reply is read aloud with the window's `speechSynthesis` when **Read replies aloud** says
   so (after voice messages, always, or never), using only voices installed on the PC. **Stop
   speaking**, the talk key and **New chat** stop it.

**The speech file.** The model is Moonshine tiny, English, quantized for the engine (MIT licence), in
three files on Hugging Face (`csukuangfj2/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27`), pinned to
commit `d1e6c30921780b8508d04b492dfb3ce8a51605d4`. The window can only ask for the download; the main
process asks the user in its own box first. Each file is fetched with `redirect: "manual"`, following at
most five forwards, every one https; it is written to `models/.partial/` and stopped as soon as it is
larger than its exact size; its SHA-256 is checked; and the folder is moved into place as
`models/moonshine-tiny-en-quantized-2026-02-27/` only when all three match. A failure, a cancel or a
stall (30 seconds with no reply or no new bytes) deletes `.partial`, and so does every start of Sage. In
each run, before the first recording goes to the helper, `Voice` reads the three files again and checks
their SHA-256 (`verifyModel`); a mismatch deletes the model folder and the download is offered again.

## How first-run setup works

1. On start, the window loads the settings before it shows anything. If `setupDone` is false (a first
   start, or a settings file from before this setting existed), it shows the **Welcome screen**;
   otherwise Chat. Reminders and other notices are collected only from then on, and confirmed only while
   Chat is visible, so they wait while the Welcome screen is open. Ctrl+Space works only on Chat.
2. **Where should Sage think?** *On this computer* goes on to the runner. *An online service* marks setup
   as done and opens Settings, where the address, model and key are saved as before.
3. **The local model runner.** The main process asks the runner for its model list on `127.0.0.1:11434`
   and answers *not reachable* (not installed or not started: Sage can't tell them apart without running
   programs), *an answer Sage couldn't read*, *running without the saved model* or *ready*, and which of
   Sage's two models it has. **Open the install guide** asks in the main process's box first, then opens
   one fixed address, the "local model runner" section of `docs/installing.md` on GitHub, with
   `shell.openExternal`. Nothing the window sends is used; if no browser opens, the address is shown to
   copy.
4. **A model.** The window sends only `standard` or `smaller`; the main process maps them to `qwen3:4b`
   and `qwen3:1.7b`. A model the runner already has needs no download. Otherwise the main process asks
   in its own box (the size, and that it needs an internet connection and free disk space and that the
   runner downloads and checks the files), then asks the runner to download it (`/api/pull`, streamed).
   The window asks for the progress every half second. Cancel, Sage quitting, an error line or 2 minutes
   without a new line stop it, each with Sage's own message. Only once the model is there is it saved as
   the local model (with the brain set to local), and the runner is asked whether the model can use tools.
5. **Done** says which model Sage uses and how to talk to it; **Start chatting** marks setup as done.
   **Skip setup** does the same at any step, and stops a download in progress. **Set up Sage** in Settings
   opens the Welcome screen again.

`setupDone` is changed only by the Welcome screen's own request; a Settings save keeps the stored value.
Each of the Welcome screen's requests loads the settings, changes only its own fields and saves them
under the settings lock, so nothing else in the file changes.

## Where data is kept

Everything is in Electron's `userData` folder: `%APPDATA%\sage-assistant` on Windows and
`~/.config/sage-assistant` on Linux.

| File | Written by | Contents |
| --- | --- | --- |
| `settings.json` | `SettingsStore` | Brain switch, model names, online address, app list, approved folders, Read replies aloud, and whether setup is done. No secrets: the schema has no field for one and drops unknown fields. |
| `online-key.bin` | `EncryptedFileKeyStore` | The online key, encrypted with Electron `safeStorage` (DPAPI on Windows, the desktop keyring on Linux). |
| `notes.json` | `NotesStore` | Notes (id, title, text, times). |
| `reminders.json` | `RemindersStore` | Reminders (id, text, due time, when it fired). |
| `action-log.jsonl` | `ActionLog` | One JSON line per allowed or declined action: time, call id, skill, the sentence shown, decision, outcome. |
| `models/moonshine-tiny-en-quantized-2026-02-27/` | `downloadModel` | The speech model's three files (44 MB), each checked against its fingerprint. `models/.partial/` exists only during a download. |

JSON files are written atomically (a temporary file in the same folder, flushed, then renamed over the
old one). A file that can't be read is renamed to `<name>.invalid-<time>` and Sage starts with an empty
one (or the default settings), so nothing is lost silently, and the window shows a one-time notice
saying which file it was and where the old copy was kept. The chat history is kept in memory only and is gone when Sage closes.
Recordings and their words are never written to disk or logged.

## Technology

| What | Choice | Why |
| --- | --- | --- |
| App shell | Electron 45.3.2 | One language for the whole app, a sandboxed window, native dialogs, notifications and OS-backed key encryption on Windows and Linux. |
| Language | TypeScript, strict | Types across the IPC boundary and the skills. |
| Validation | zod 4.6.7 | Every model reply, IPC payload, setting and stored file. |
| Build | esbuild 0.28.2 | Bundles the main process and preload (CommonJS) and the window (one script). |
| Tests | Node's `node:test` through tsx | No extra test framework; fake servers on `127.0.0.1` for the brains. |
| Lint and format | Biome 2.6.8 | One fast tool for both. |
| Packaging | electron-builder 26.18.1 | Packs the app into an archive, sets the fuses and makes the one-click Windows installer (NSIS). A build tool only; nothing of it ships inside Sage. |
| Hardening | @electron/fuses 2.1.3 | The fuse names for `src/main/fuses-config.ts`; electron-builder sets them in the packaged app. |
| Speech engine | sherpa-onnx-node 2.0.1 (Apache-2.0) | Offline speech recognition, ready-built for Windows and Linux, with no install scripts. Sage's only run-time dependency, and its only native code. Loaded only in the speech helper. |
| Speech model | Moonshine tiny, English (MIT) | Small and fast; downloaded once, after asking. |

There are no vendor SDKs: both brains, the runner client, the search and the speech file download use
`fetch`. Spoken
replies use the window's built-in speech, with no package.

## Packaging

- `npm run build` writes everything the app needs into `dist/`: `main.cjs`, `preload.cjs`,
  `voice-helper.cjs` and `renderer/` (`index.html`, `styles.css`, `renderer.js`, which includes the
  Welcome screen). `package.json`'s `main`
  points at `dist/main.cjs`. zod is bundled into the bundles, so it is a dev dependency.
- **The one run-time dependency** is the speech engine, `sherpa-onnx-node`, marked external in
  `scripts/build.ts` so the helper loads it from `node_modules`. npm installs only the ready-built package
  for the PC it runs on (`sherpa-onnx-win-x64` on 64-bit Windows, `sherpa-onnx-linux-x64` on Linux), so
  **the Windows installer must be built on Windows**: `npm run dist:dir` on Linux makes a Windows app
  with the Linux engine, whose voice won't work. The app archive holds `dist/` (without source maps),
  `package.json` and the engine's JavaScript (`node_modules/sherpa-onnx-node`). The engine's native files
  (`sherpa-onnx.node` and its libraries: four `.dll` files on Windows, about 23 MB) are kept **unpacked
  next to the archive**, in `resources/app.asar.unpacked/node_modules/sherpa-onnx-<platform>-<arch>/`
  (`asarUnpack` in `electron-builder.json`), because the system can't load them from inside it. Unpacked
  files aren't covered by the archive's integrity check (see the assurance case, T6).
- `npm run dist` builds, then makes the Windows installer `out/Sage-Setup-<version>.exe` with
  electron-builder; it works only on Windows. `npm run dist:dir` makes the unpacked app in
  `out/win-unpacked/` instead, and also works on Linux, for checks. `out/` is not in git. The settings
  are in `electron-builder.json`, which electron-builder reads by default:
  - app id `com.honeybeartech.sage`, the same one `src/main/main.ts` gives Windows for notifications;
  - the name "Sage" for the installer, the shortcuts and `Sage.exe` (`productName`), set only in that
    file. The data folder comes from `package.json`'s `name`, `sage-assistant`, so the installed app and a
    copy run from source share `%APPDATA%\sage-assistant`. Never add `productName` to `package.json` or
    change the name through `extraMetadata`: that would move the data folder;
  - a one-click NSIS installer for the current user (no admin rights), with Start-menu and desktop
    shortcuts, that starts Sage when it finishes. Uninstalling keeps the data folder. No `.blockmap` or
    other update files are made; those are for automatic updates, which come later.
- **Fuses.** electron-builder sets the fuses from the `electronFuses` block in `electron-builder.json`
  on `Sage.exe` while packaging, after it has embedded the archive's integrity hash and before any
  signing. `src/main/fuses-config.ts` is the reviewed list: RunAsNode off, cookie encryption on,
  `NODE_OPTIONS` off, inspect arguments off, ASAR integrity validation on, load only from ASAR, and no
  extra privileges for `file://` pages. `test/security.test.ts` checks that the two lists match. To read
  them back from a build: `npx @electron/fuses read --app out/win-unpacked/Sage.exe`. Never flip fuses on
  `node_modules/electron`: "only load from ASAR" would stop `npm start` from working.
- **Releases** are built by a GitHub workflow on a version tag, with a checksum file and build
  provenance; see [releasing.md](releasing.md).
- Reminders fire only while Sage is running; the scheduler checks every 15 seconds and fires reminders
  missed while it was closed on the first check after it starts.
