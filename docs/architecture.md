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
|  home, chat,        <----------->  | ipc.ts: validated handlers, sender checked     |    |
|  settings, voices   window.sage    | Assistant: one conversation, tool-call loop    |    |
|  (src/renderer)     (src/preload)  | SkillRegistry + ApprovalGate + action log      |    |
|                                    | Notes, reminders, scheduler, settings, keys    |    |
|                                    | Home: a read-only summary, the brief's day     |    |
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
                          (local brain)        brain:     HTML page   (the speech      notifications,
                                               Anthropic, (search)    file, once,      apps and files
                                               OpenAI,                after asking)
                                               Google or
                                               another
                                               (optional)
```

| Part | Where | What it does |
| --- | --- | --- |
| Chat window | `src/renderer/` | Plain TypeScript, HTML and CSS. Shows Home, the chat, the settings screen and, on first start, the Welcome screen, in the dark "sage HUD" look or its light version (see [The window's look](#the-windows-look)). Runs sandboxed with no Node access; inserts text only with `textContent`. |
| Preload | `src/preload/preload.ts` | Exposes `window.sage` through `contextBridge`, and nothing else: twenty-six typed calls to the main process, and one listener, `onAsking`, for the main process's news about its asking box (one way; it passes on only the checked fields). |
| IPC handlers | `src/main/ipc.ts` | One handler per channel. Validates every payload with zod; never sends the key to the window (only whether one is saved). Removes the saved key when the online address moves to a different service, saves a new key only when the address on screen is the saved one, and stops a turn in progress when the brain, the service, the chosen brain's model or its key changes. |
| Notifications | `src/main/notify.ts` | Shows a reminder as a desktop notification and waits up to 5 seconds for the system to confirm it. Reports whether it was confirmed; it never reports a guess. |
| Main wiring | `src/main/main.ts` | Creates the window, locks down the session (permissions, requests, navigation), supplies the native confirmation dialog (wrapped so the window hears when it opens and closes), the Welcome screen's two boxes (before a model download and before opening the install guide), notifications, `shell.openPath`, `shell.openExternal` (used only for the install guide's fixed address), the app launcher and the encrypted key store. Checks the sender of every IPC call. |
| Window security | `src/main/security.ts` | The window options, the CSP and the URL and permission rules, as pure functions the tests check. |
| Asking news | `src/core/asking.ts` | Wraps the confirmation dialog: tells the window when it opens (with the sentence it shows) and when it closes (allowed or not). The answer comes only from the dialog. |
| Assistant | `src/core/assistant.ts` | Sends the conversation and the skill list to the brain, runs the tool calls it returns through the registry, and stops after six tool calls or six rounds per message (three each for `add_note` and `add_reminder`). **New chat** abandons a turn in progress: it runs no further tool calls and writes nothing to the history. |
| Brain | `src/core/brain/` | `LocalBrain` (Ollama's `/api/chat` on `127.0.0.1:11434`); `OnlineBrain` (chat-completions: `<base>/v1/chat/completions`, for another online service); `MessagesBrain` (`anthropic.ts`: Anthropic's Messages API, `https://api.anthropic.com/v1/messages`, skills as tools, skill results as `tool_result` blocks); `ResponsesBrain` (`responses.ts`: OpenAI's Responses API, `https://api.openai.com/v1/responses`, skills as function tools, results as `function_call_output` items, `store: false` with the reasoning sent back encrypted); `GeminiBrain` (`gemini.ts`: Google's `generateContent`, skills as function declarations, results as `functionResponse` parts with the call's id). The three company brains send each reply back exactly as it came within one message (`Replay`: thinking blocks, signatures, encrypted reasoning and the service's call ids), get the same tools for every request of a message with tool use switched off past the skill limit (`allowTools`), and turn a reply cut off at the token limit or a refusal into a plain sentence; the Messages brain retries once without thinking blocks if the service refuses a thinking signature. `services.ts` holds the three companies' fixed addresses, key pages and default models; `request.ts` is the shared request (redirects refused, one time limit, size cap); `errors.ts` turns a status and a few known error-type fields into a plain sentence. Settings pick one brain for each message. |
| Skills | `src/core/skills/` | The registry, the eleven built-in skills, the ask-first gate, the untrusted-text wrapper and the action log. |
| Data stores | `src/core/notes.ts`, `reminders.ts`, `settings.ts`, `keystore.ts` | JSON files written atomically, and the encrypted key files. |
| Scheduler | `src/core/scheduler.ts` | Checks reminders every 15 seconds and shows each one that is due, once. If the desktop notification isn't confirmed, the reminder goes to the notice board. It is marked as shown only when the desktop confirmed it or the window confirmed it is on screen; until then it stays due and comes back on the next check or the next start. Each reminder is handled on its own, and one that was shown but couldn't be recorded is never shown again. |
| Notices | `src/core/notices.ts` | Messages from Sage itself (reminders for the window, data files set aside), collected by the window every 5 seconds and shown in the chat. Each notice has an id; the window confirms the ids it has put in the chat once the Chat view is open and the window isn't hidden or minimised, and only that delivers a notice. One not yet confirmed is handed out again with the same id, so the window skips it if it already shows it. Deleting a reminder withdraws its notice, and a reminder that no longer exists is skipped. At most 50 wait at once (confirmed or not): the oldest are kept, and the window is told how many more are waiting. |
| Service keys | `src/core/keystore.ts` | One encrypted file per online brain. A company's key is saved with that company's fixed origin; another online service's key with the origin it was entered for. Every request asks `ServiceKeys.keyForRequest(brain, url)` for the key with the exact address it is about to call, and gets it only if that address's origin is the one the key was saved for (and, for a company, its fixed origin). |
| Online services | `src/core/online-services.ts` | **Load models**, **Test** and **Get a key** for the three companies: the window sends only the company's id; the main process lists the models (or tests the key with that free list) at the fixed address with the saved key, and opens the fixed key page after its own box. |
| Search | `src/core/search/` | The `SearchProvider` interface and the DuckDuckGo HTML provider with its parser. |
| Voice | `src/core/voice/` | `model.ts`: the speech model's three files (pinned address, exact size, SHA-256). `download.ts`: the download (https only, at most five forwards, size cap, fingerprint check, 30-second stall limit, moved into place only when all match, leftovers deleted). `transcriber.ts`: starts the speech helper, one recording at a time, 60-second limit, a fresh helper after a crash. `helper-protocol.ts`: the validated messages between the two, and the helper's own logic. `voice.ts`: ties them together; the download only after the main process's own box says Download, and the files' fingerprints checked again once per run before first use. |
| Speech helper | `src/helper/voice-helper.ts` | Built as `dist/voice-helper.cjs` and run as Electron's utility process. The only code that loads the speech engine (`sherpa-onnx-node`); gets sound, sends back text. |
| Window voice | `src/renderer/voice-controls.ts`, `voice.ts`, `voice-text.ts` | Hold to talk (Ctrl+Space or the Talk button), recording with the standard recorder, turning it into 16 kHz mono sound, the download offer, and spoken replies with the window's own speech and the PC's installed voices. `main.ts` is the entry the build bundles into `renderer.js`; it calls `startChatWindow()` from `renderer.ts`, which finds the elements and wires them up. |
| Runner client | `src/core/brain/runner.ts` | The local model runner's other requests on the same fixed `127.0.0.1` address as chat: the model list (`/api/tags`), a model download (`/api/pull`, progress read line by line, each line capped at 64 KB and checked, at most 1,000 layers, stopped after 2 minutes without real progress) and a model's details (`/api/show`, whether it can use tools). No redirects, short time limits for the quick requests, replies size-capped; the runner's own text is never shown or logged. |
| Setup | `src/core/setup.ts` | First-run setup: the runner's status for the saved local model and Sage's two models, one download at a time of one of those two (only after the main process's box says Download, stopped when Sage quits), saving it as the local model once it is there, the skills check, opening the install guide's one fixed address after asking, and marking setup done. |
| Home | `src/core/home.ts` | Home's summary for the window, read-only and bounded: the reminders due on the PC's own day (at most 10, the ones still to come first) and the missed ones not yet shown (at most 5, the newest, with a count of the rest), text cut to 200 characters, the next reminder after today when nothing more is to come today, the titles of the five most recently changed notes (cut to 80 characters, never the text), the brain, whether the speech file is there and the sound switch. Also the morning brief's once-a-day mark (`claimMorningBrief`), saved as `lastBrief` in the settings under the settings lock; the saved day never moves backwards. |
| Window home | `src/renderer/home.ts`, `home-text.ts` | Home: the clock (the PC's own time format, changed on the minute), the greeting (morning 05:00 to 11:59, afternoon 12:00 to 17:59, evening otherwise), the Today, Notes and Status panels, **Talk to Sage**, and the daily brief, built in `home-text.ts` from the summary in fixed words, typed out with `typing.ts` and read aloud through voice's speaker. |
| Window welcome | `src/renderer/welcome.ts`, `welcome-text.ts` | The Welcome screen's numbered steps and texts: 01 where Sage thinks, 02 the runner, 03 a model (with progress polled every half second) and 04 Ready; each step's typed check lines (built in DOM-free `welcome-text.ts` from the real answers), the support code of a failed check, and the Copy diagnostics box. |
| Support codes | `src/shared/support-codes.ts` | The one table of support codes (`SAGE-RUN-01` and so on), the runner states and step labels they go with; `docs/installing.md` has the same table for people (a test keeps the two the same). |
| Diagnostics | `src/core/diagnostics.ts` | Copy diagnostics: builds the text in the main process from a fixed list of fields, scrubs every value, keeps the text built last under an id, and puts exactly that on the clipboard when the window asks with the id. |
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
     are appended to `action-log.jsonl`. While the box is open, the chat shows the same sentence in an
     amber card, and afterwards whether it was allowed (see [the asking card](#the-windows-look)); the
     card is only news.
5. The results go back to the brain, which answers or asks for more tools. The final text is shown in
   the window.

## The window's look

The window is a calm heads-up display in green: a deep green-black ground with a faint grid and
scanlines, one sage-mint accent, amber for you and for anything waiting on you, hairline panels with
corner ticks, cut-corner main buttons, and monospace capitals for the chrome (tabs, labels, status,
headings) in the PC's own fonts; messages are in the system font at 16 px. Nothing is loaded from
outside the app: no fonts, images, video or sound files.

- **Theme.** Settings → Look → **Theme**: *Dark* (the default), *Light* or *Match system*. It is set as
  `data-theme` on the page, and every colour in `styles.css` is a token written once as
  `light-dark(<light>, <dark>)`, so the page's `color-scheme` picks the theme. `test/look.test.ts`
  checks the contrast of the main pairs in both themes (at least 4.5 to 1) and that no text is under
  12 px. The setting has a schema default, so a settings file from before it loads with *Dark*.
- **The orb.** Above the message box, and larger on Home, drawn as inline SVG in `index.html` and
  animated by `styles.css`; `orb.ts` keeps one state and sets it on both drawings as `data-state`, with
  a word underneath each. *Ready* (a slow
  breath), *Listening* (quick pulses and amber rings while the talk key or button is held), *Thinking*
  (the rings turn while a reply is on its way) and *Speaking* (an uneven pulse while a reply is read
  aloud). Your voice wins over Sage's, which wins over thinking. The drawing is hidden from screen
  readers; **Hold to talk** stays a real button. Its animation pauses while the window is hidden.
- **The transcript.** Each message is a row labelled `YOU` (amber) or `SAGE` (accent); the labels are
  drawn by the stylesheet (with "You:" and "Sage:" for screen readers), so the row's text is exactly
  the message. The newest reply types itself out (`typing.ts`: 12 ms a character, at most 1.2 s): the
  row holds the whole reply from the start and a copy laid over it grows, so screen readers get it at
  once and nothing moves; any click or key shows it all. Notices keep their dashed card.
- **The asking card.** `src/core/asking.ts` wraps the confirmation dialog in the main process. When the
  dialog opens, the main process sends the window `{ id, state: "open", text }` on the `sage:asking`
  event (`webContents.send`), with the sentence the dialog shows; when it closes,
  `{ id, state: "closed", allowed }`. The preload's `onAsking` listener checks the fields
  (`readAskingEvent`) and passes on only those, never the IPC event. The ids are the wrapper's own
  counter, not call ids. The chat shows an amber card with corner ticks, "Sage is asking: …", then
  **Allowed** or **Not allowed**. The card has no buttons, no channel takes anything back about it,
  and nothing the listener does changes the dialog's answer: the dialog stays the only way to answer.
  The Welcome screen's and voice's download boxes don't send this news; only the box before an action.
- **Sounds.** `sounds.ts` makes three short tones with Web Audio oscillators (no files): a blip when you
  send, two rising notes when you allow an action, a low tone when the asking card appears. They are
  off unless the **Sound** switch in the top bar is on; the switch saves only itself (`setSound`), so a
  Settings save neither changes it nor is needed for it. No audio context exists until the first sound
  is wanted while sound is on.
- **Home.** The first tab, and the view Sage opens on once set up. A large orb, a clock in the PC's
  own time format (`Intl` with the system's language, hours and minutes, changed on the minute and
  never animated), a greeting for the time of day, and three panels with corner ticks and monospace
  labels: **Today**, **Notes** and **Status**; empty panels say so in a dashed box. Missed reminders are
  amber. **Talk to Sage** opens Chat and puts the focus in the message box. Home asks the main process
  for its summary (`homeSummary`, see [How Home and the brief work](#how-home-and-the-brief-work))
  when it is shown, every minute while it is on screen, and when the notice collection brings a new
  notice (usually a reminder that fired); there is no new message from the main process.
- **Reduced motion.** With the system's "reduce motion" setting (Windows: Settings → Accessibility →
  Visual effects → Animation effects off), nothing moves: no breathing, turning, fading in or typing.
  The orb still shows its state, standing still.
- **Preview page.** `npm run preview` builds `out/preview/`, a page made from the real built window
  files with a stand-in for the main process (sample chat, asking cards) and a control strip, for
  review in a browser. It isn't part of Sage: `out/` isn't in git, and the installer packs only `dist/`.

## How Home and the brief work

1. **The summary.** `homeSummary` takes an empty object and nothing else, and returns only what Home
   shows (`src/core/home.ts`): reminders (id, text cut to 200 characters, due time, missed), soonest
   first: at most 10 due on the PC's own day (still to come or already shown, the ones still to come
   kept first) and, capped on their own, at most 5 missed ones (due and not shown yet, the newest),
   with `missedMore` counting the missed ones left out, so old missed reminders never hide what is
   still to come; the next
   reminder after today, only when nothing more is to come today; at most 5 note titles, cut to 80
   characters, newest first, never a note's text; and the brain, whether the speech file is there and
   the sound switch. It only reads the stores and the settings; it writes nothing.
2. **The brief.** **Brief me** asks for the summary again and builds the brief in the window
   (`briefText` in `src/renderer/home-text.ts`) in fixed words: "Good morning. It's Monday 16
   November.", today's reminders with their times ("Today: Dentist at 14:30; …") or "Nothing is due
   today." with the next one, the missed ones ("You missed: …"), the latest note titles ("Your latest
   notes: …") and "What would you like to start with?"; "and N more" ends the missed list when some
   were left out. It is never sent to the brain and never added to the conversation. It is shown in
   the Brief panel, typed out like a reply (`typing.ts`, with its skip and reduced-motion rules), and
   read aloud through voice's speaker (the PC's own voices) unless Read replies aloud is *Never*;
   never while the microphone is open. Each brief asked for has a number: after the summary arrives
   (and after the morning claim) it goes on only if it is still the newest, Home is still shown and the
   window is visible. Leaving Home or hiding the window drops a brief on its way, stops the brief being
   read (a reply being read goes on) and shows its text in full; sending a message or holding Talk
   also stops it. While the brief is read, the Brief panel has its own **Stop speaking** button (Chat's
   is hidden with Chat); voice's controls know whether what is read is the brief.
3. **The morning brief.** With **Brief me when Sage first opens each day** on (`morningBrief`, off by
   default), each time Home is shown, or the window comes back into view on Home, the window asks
   `claimMorningBrief`. The main process answers true only the first time on a new day (the PC's own
   day), and saves that day as `lastBrief` in the settings under the settings lock, so a reload or a
   restart the same day gets false. The saved day never moves backwards: a saved day later than today
   (the clock was moved back) waits, unless it is more than two days ahead, which is taken as a broken
   clock (today is claimed and saved). A Settings save keeps the saved day. The window then shows the
   brief; it is read aloud only when Read replies aloud is *Always*.
4. **The clock.** A fresh time formatter is made for each time shown, so a change of the PC's time
   zone shows at the next minute. The minute timer runs only while Home is on screen: it stops when
   Home is left or the window hidden, and restarts, with the clock redrawn and the panels loaded, when
   the window is shown again on Home.

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
   otherwise Home. Reminders and other notices are collected only from then on, and confirmed only while
   Chat is visible, so they wait while the Welcome screen (or Home) is open. Ctrl+Space works only on Chat.
2. **Where should Sage think?** *On this computer* goes on to the runner. *An online service (Claude,
   OpenAI, Gemini or another)* marks setup as done and opens Settings at the brain list, with a line on
   what to do there (pick one, save, then save its key; **Get a key** opens the company's key page). The
   step says that online brains are paid per use and that Sage can't cap spending.
3. **The local model runner.** The main process asks the runner for its model list on `127.0.0.1:11434`
   and answers *not reachable* (not installed or not started: Sage can't tell them apart without running
   programs), *an answer Sage couldn't read*, *running without the saved model* or *ready*, and which of
   Sage's two models it has. **Open the install guide** asks in the main process's box first, then opens
   one fixed address, the "local model runner" section of `docs/installing.md` on GitHub, with
   `shell.openExternal`. Nothing the window sends is used; if no browser opens, the address is shown to
   copy. When the runner answers for its models, the main process also asks for its version
   (`/api/version`, same fixed address, capped and checked); only a plain version number is kept
   (digits and dots, with a short suffix at most), anything else counts as not reported.
4. **A model.** The window sends only `standard` or `smaller`; the main process maps them to `qwen3:4b`
   and `qwen3:1.7b`. A model the runner already has needs no download. Otherwise the main process asks
   in its own box (the size, and that it needs an internet connection and free disk space and that the
   runner downloads and checks the files), then asks the runner to download it (`/api/pull`, streamed).
   The window asks for the progress every half second. Cancel, Sage quitting, an error line or 2 minutes
   without real progress (more bytes downloaded in all than ever before, a layer never seen before, or a
   status never seen before in this download; repeated or alternating lines and bytes with no end of
   line don't count) stop it, each with Sage's own message. Only once the model
   is there is it saved as the local model, with the brain set to local (the box and the model step say
   so), and the runner is asked whether the model can use tools. Switching the brain this way stops a
   turn running against the online service, as a Settings save does.
   **The commit point is the save starting.** Before it (asking the runner for its models, the box, the
   download, and the moment between the download ending and the save starting), Cancel, Skip and
   quitting cancel the request: it opens no box, starts no download and saves nothing. Once the
   download has finished and the save has started, a cancel no longer applies: a write in progress is
   never undone, Cancel answers "too late" and the window keeps the model as chosen, and Skip waits for
   the save to settle before it marks setup as done.
5. **Ready** says which model Sage uses and how to talk to it; **Start chatting** marks setup as done.
   **Skip setup** does the same at any step, and cancels a model request that hasn't reached its commit
   point. If setup can't be saved as done, the Welcome screen stays and says so. Afterwards, Settings
   updates only the fields setup saved, and only where the form still shows what it showed when the
   Welcome screen closed. **Set up Sage** in Settings opens the Welcome screen again.

**The start-up sequence.** The steps are numbered sections (01 Where Sage thinks, 02 Model runner,
03 Model, 04 Ready) in the panel style. Each step lists what Sage checked as short lines, built in
`welcome-text.ts` from an answer the window already has and nothing else: the runner's status (found
or not, its version, which of Sage's two models it has), the model request's result (ready, not
downloaded, cancelled or failed, and whether the model can use skills) and, on Ready, the voice status.
The lines type out one after another with the chat's typist (`typing.ts`); a click or a key shows them
all, and with reduced motion they appear at once. Each new set is read out once, in full, through one
polite status area (`welcome-checks-status`); the lists themselves aren't live regions.

**Support codes.** A failed check shows a short code next to its plain sentence, from the one table in
`src/shared/support-codes.ts`. Each code is a failure Sage can tell apart: the runner's two failed
states (`SAGE-RUN-01` not reachable, `SAGE-RUN-02` unreadable), each of the download's own messages
(`PULL_CODES` in `src/core/brain/runner.ts`: `SAGE-MOD-01` to `03`, `SAGE-NET-01` and `02`, and the
runner codes again when the runner stops answering mid-way), a second download (`SAGE-MOD-04`), a model
that couldn't be saved as the local model (`SAGE-SET-01`), and a request from the window that failed or
couldn't be read (`SAGE-APP-01`). The main process puts the code in a failed `PullResult`; the window
maps the runner's states itself. A declined or cancelled download is the user's own choice and gets no
code. `docs/installing.md` has the same codes with what to try; `test/support-codes.test.ts` checks
that the two lists match and that every code is used.

**Copy diagnostics.** A failed step (02 or 03) offers **Copy diagnostics…**. The window asks
`diagnostics` with the step, the code and whether it has reduced motion on (closed lists and a
yes or no, checked with zod), nothing else. The main process (`src/core/diagnostics.ts`) builds the
text from a fixed list of fields: Sage's version, the system and its version, the processor, the step
and code, the kind of brain (`local`, `claude`, `openai`, `gemini` or `other`), whether the runner
answered and its version, the model the failed step tried (kept in the main process
by `Setup` from the closed choice when a model request starts, marked when it downloaded but couldn't
be saved, cleared on success) and the saved local model, each named only if it is one of Sage's two,
with whether it is downloaded, the voice status, the theme and reduced motion. It never reads keys, addresses, apps, folders,
notes or reminders. As a second line of defence each value is scrubbed of the home folder, the user
name, e-mail addresses, web addresses other than loopback, and every key the redactor knows. Each build is numbered when it
starts, and the text is kept under that number (`diag-N`), replacing the one before; a build that
finishes after a newer one started is not kept and comes back marked stale, so the window drops it.
The kept text is returned for the window to show in
full in a read-only box. **Copy to clipboard** sends only that id (`copyDiagnostics`); the main process
writes the text it kept under that id to the clipboard (Electron's `clipboard`, main process only), or
says to build it again if the id isn't the latest. Nothing is sent anywhere, and nothing is logged.

`setupDone` is changed only by the Welcome screen's own request; a Settings save keeps the stored value.
Each of the Welcome screen's requests loads the settings, changes only its own fields and saves them
under the settings lock, so nothing else in the file changes.

## Where data is kept

Everything is in Electron's `userData` folder: `%APPDATA%\sage-assistant` on Windows and
`~/.config/sage-assistant` on Linux.

| File | Written by | Contents |
| --- | --- | --- |
| `settings.json` | `SettingsStore` | The brain (`local`, `claude`, `openai`, `gemini` or `other`; a 0.1.1 file's `online` loads as `other`), model names (one per company under `services`), another online service's address, app list, approved folders, Read replies aloud, whether setup is done, the theme, the sound switch, the morning brief switch and the day the morning brief was last shown (`lastBrief`). No secrets: the schema has no field for one and drops unknown fields. |
| `claude-key.bin`, `openai-key.bin`, `gemini-key.bin` | `EncryptedFileKeyStore` | Each company's key with its fixed origin, encrypted with Electron `safeStorage` (DPAPI on Windows, the desktop keyring on Linux). |
| `online-key.bin` | `EncryptedFileKeyStore` | Another online service's key with the origin it was entered for (the same file as in 0.1.1), encrypted the same way. |
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

There are no vendor SDKs: all four brains, the runner client, the search and the speech file download use
`fetch`. Spoken
replies use the window's built-in speech, with no package.

## Packaging

- `npm run build` writes everything the app needs into `dist/`: `main.cjs`, `preload.cjs`,
  `voice-helper.cjs`, `icon.png` (the window icon, copied from `build/icon.png`) and `renderer/`
  (`index.html`, `styles.css`, `renderer.js`, which includes the Welcome screen). `package.json`'s `main`
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
- **The icon** is drawn in `build/icon.svg`, and `build/icon.png` (512 by 512, made from the drawing;
  `build/README.md` has the command) is the one file used everywhere. `electron-builder.json` names it as
  `win.icon`, and electron-builder makes the Windows icon sizes from it for `Sage.exe`, the installer, the
  uninstaller and the shortcuts (the NSIS `installerIcon` and `uninstallerIcon` settings, which need
  `.ico` files, default to the app icon, so they aren't set). `build/` isn't in the `files` list: the
  window icon comes from `dist/icon.png`, which `scripts/build.ts` copies, and `windowOptions` in
  `src/main/security.ts` takes its path (from `main.ts`) as `icon`. No tray or notification icon.
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
