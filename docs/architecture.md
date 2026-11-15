# Architecture

Sage is one Electron app written in TypeScript. There is no local web server and no background
service: the chat window talks only to the app's own main process, through a handful of typed calls.

## Components

```text
+------------------------------- Sage (one Electron app) --------------------------------+
|                                                                                         |
|  Chat window (renderer)            Main process                                         |
|  sandboxed, no Node      IPC       +-----------------------------------------------+    |
|  chat, settings     <----------->  | ipc.ts: validated handlers, sender checked     |    |
|  (src/renderer)   window.sage API  | Assistant: one conversation, tool-call loop    |    |
|                   (src/preload)    | SkillRegistry + ApprovalGate + action log      |    |
|                                    | Notes, reminders, scheduler, settings, keys    |    |
|                                    +-----------------------------------------------+    |
|                                       |            |              |            |         |
+---------------------------------------|------------|--------------|------------|---------+
                                        v            v              v            v
                          Ollama on 127.0.0.1   online model   DuckDuckGo    confirmation box,
                          (local brain)         service        HTML page     notifications,
                                                (optional)     (search)      apps and files
```

| Part | Where | What it does |
| --- | --- | --- |
| Chat window | `src/renderer/` | Plain TypeScript, HTML and CSS. Shows the chat and the settings screen. Runs sandboxed with no Node access; inserts text only with `textContent`. |
| Preload | `src/preload/preload.ts` | Exposes `window.sage` with nine typed methods through `contextBridge`; nothing else. |
| IPC handlers | `src/main/ipc.ts` | One handler per channel. Validates every payload with zod; never sends the key to the window (only whether one is saved). Removes the saved key when the online address moves to a different service, and stops a turn in progress when the brain or the service changes. |
| Notifications | `src/main/notify.ts` | Shows a reminder as a desktop notification and waits up to 5 seconds for the system to confirm it. Reports whether it was confirmed; it never reports a guess. |
| Main wiring | `src/main/main.ts` | Creates the window, locks down the session (permissions, requests, navigation), supplies the native confirmation dialog, notifications, `shell.openPath`, the app launcher and the encrypted key store. Checks the sender of every IPC call. |
| Window security | `src/main/security.ts` | The window options, the CSP and the URL and permission rules, as pure functions the tests check. |
| Assistant | `src/core/assistant.ts` | Sends the conversation and the skill list to the brain, runs the tool calls it returns through the registry, and stops after six tool calls or six rounds per message (three each for `add_note` and `add_reminder`). **New chat** abandons a turn in progress: it runs no further tool calls and writes nothing to the history. |
| Brain | `src/core/brain/` | `LocalBrain` (Ollama's `/api/chat` on `127.0.0.1:11434`) and `OnlineBrain` (`<base>/v1/chat/completions`). Settings pick one for each message. |
| Skills | `src/core/skills/` | The registry, the eleven built-in skills, the ask-first gate, the untrusted-text wrapper and the action log. |
| Data stores | `src/core/notes.ts`, `reminders.ts`, `settings.ts`, `keystore.ts` | JSON files written atomically, and the encrypted key file. |
| Scheduler | `src/core/scheduler.ts` | Checks reminders every 15 seconds and shows each one that is due, once. If the desktop notification isn't confirmed, the reminder goes to the notice board. It is marked as shown only when the desktop confirmed it or the window collected it; until then it stays due and comes back on the next check or the next start. Each reminder is handled on its own, and one that was shown but couldn't be recorded is never shown again. |
| Notices | `src/core/notices.ts` | Messages from Sage itself (reminders for the window, data files set aside), collected by the window every 5 seconds and shown in the chat. Collecting a notice is what delivers it. At most 50 wait at once: the oldest are kept, and the window is told how many more are waiting. |
| Service keys | `src/core/keystore.ts` | The key is saved together with the service (origin) it was entered for, and each turn's online brain asks only for the key of its own service. |
| Search | `src/core/search/` | The `SearchProvider` interface and the DuckDuckGo HTML provider with its parser. |
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

## Where data is kept

Everything is in Electron's `userData` folder: `%APPDATA%\sage-assistant` on Windows and
`~/.config/sage-assistant` on Linux.

| File | Written by | Contents |
| --- | --- | --- |
| `settings.json` | `SettingsStore` | Brain switch, model names, online address, app list, approved folders. No secrets: the schema has no field for one and drops unknown fields. |
| `online-key.bin` | `EncryptedFileKeyStore` | The online key, encrypted with Electron `safeStorage` (DPAPI on Windows, the desktop keyring on Linux). |
| `notes.json` | `NotesStore` | Notes (id, title, text, times). |
| `reminders.json` | `RemindersStore` | Reminders (id, text, due time, when it fired). |
| `action-log.jsonl` | `ActionLog` | One JSON line per allowed or declined action: time, call id, skill, the sentence shown, decision, outcome. |

JSON files are written atomically (a temporary file in the same folder, flushed, then renamed over the
old one). A file that can't be read is renamed to `<name>.invalid-<time>` and Sage starts with an empty
one (or the default settings), so nothing is lost silently, and the window shows a one-time notice
saying which file it was and where the old copy was kept. The chat history is kept in memory only and is gone when Sage closes.

## Technology

| What | Choice | Why |
| --- | --- | --- |
| App shell | Electron 45.3.2 | One language for the whole app, a sandboxed window, native dialogs, notifications and OS-backed key encryption on Windows and Linux. |
| Language | TypeScript, strict | Types across the IPC boundary and the skills. |
| Validation | zod 4.6.7 | Every model reply, IPC payload, setting and stored file. |
| Build | esbuild 0.28.2 | Bundles the main process and preload (CommonJS) and the window (one script). |
| Tests | Node's `node:test` through tsx | No extra test framework; fake servers on `127.0.0.1` for the brains. |
| Lint and format | Biome 2.5.15 | One fast tool for both. |
| Hardening | @electron/fuses 2.1.3 | Switches off Node entry points in the packaged app. |

There are no vendor SDKs: both brains and the search use `fetch`.

## Packaging notes (for the installer job)

- `npm run build` writes everything the app needs into `dist/`: `main.cjs`, `preload.cjs` and
  `renderer/` (`index.html`, `styles.css`, `renderer.js`). `package.json`'s `main` points at
  `dist/main.cjs`. The packaged app needs `dist/` and `package.json`, and zod is bundled into
  `main.cjs`, so no `node_modules` are needed at run time.
- After packaging the app into an ASAR archive, run `npm run fuses -- <path to the packaged Sage
  executable>` to set the fuses in `src/main/fuses-config.ts` (RunAsNode off, `NODE_OPTIONS` off,
  inspect arguments off, ASAR integrity validation on, load only from ASAR). The ASAR integrity hash must
  be embedded by the packager for the integrity fuse to pass. Never run the script on
  `node_modules/electron`: the script refuses that path, because "only load from ASAR" would stop
  `npm start` from working.
- Reminders fire only while Sage is running; the scheduler checks every 15 seconds and fires reminders
  missed while it was closed on the first check after it starts.
