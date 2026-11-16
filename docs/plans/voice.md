# Plan: voice

## What the owner asked for

"Start the voice job": the next roadmap item, "Hold a key to talk, offline speech recognition, and spoken
replies."

## What we found

- Sage's window may already use the microphone (and nothing else), but nothing uses it yet. The window
  has no network access and a strict content rule (CSP), and that should stay as it is.
- Chromium's own speech recognition isn't offline: it sends the audio to an online service, and in
  Electron it doesn't work at all. So Sage needs its own speech engine.
- The best fit is **sherpa-onnx** (`sherpa-onnx-node` 2.0.1, Apache-2.0 licence). It runs on the PC
  with no internet, comes ready-built for Windows and Linux, and has no install scripts (setup code that
  runs during `npm install`). Its Windows part adds about 23 MB to the installer. It is Sage's first
  native code (code built for one kind of computer, not plain JavaScript) and the first package the
  installed app loads at run time; today everything is bundled into Sage's own files.
- The speech model: **Moonshine tiny, English** (MIT licence), about 44 MB in three files, published as
  plain files on Hugging Face. Each file can be pinned to an exact version and checked with a SHA-256
  fingerprint.
- Spoken replies can use the voices that already come with Windows (through the window's built-in
  speech, which works offline), with no new package. On Linux it needs the system's speech service,
  and may have no voice.
- A key held down anywhere on the PC can't be detected without a system-wide keyboard hook (the same
  kind of code a keylogger uses), so the talk key works while Sage's window is focused.

## What we'll change

1. **Add the speech engine.** `sherpa-onnx-node` 2.0.1, exact version, as Sage's first run-time
   dependency. Its JavaScript part goes into the app's archive as usual. Its ready-built native files
   (`sherpa-onnx.node` and four `.dll` files on Windows) are kept unpacked next to the archive
   (`asarUnpack` in `electron-builder.json`), because Windows can't load them from inside it. Only the
   package for the PC being built for is installed, so the Windows installer is built on Windows.
   Renovate keeps the engine's packages in one update, with a note to re-check install scripts and run
   the voice checklist.

   *Check:* `npm install-scripts ls` shows no new setup code; `npm audit --audit-level=high` passes; a
   Linux test build on the review machine shows the native files unpacked next to the archive; the
   owner's Windows run (step 7) checks the Windows files.
2. **The speech model is downloaded the first time voice is used, after asking.** Sage shows a box:
   "Voice needs a 44 MB speech file from Hugging Face. Download it now?" Only on Download does it fetch
   the three files:
   - from fixed addresses written in Sage's code (pinned to one exact version of the model), only over
     HTTPS, by the main part of Sage, never by the window. Hugging Face forwards each address to its
     download servers, so Sage follows at most five forwards, each of which must also be HTTPS;
   - each with a size limit, checked against its SHA-256 fingerprint before it is used, and moved into
     Sage's data folder (`models/`) only if all three match. Half-finished files are deleted after a
     failure, a cancel or a crash;
   - with a plain message and a Try again button if it fails or the PC is offline, and a Cancel button
     while it runs.

   Nothing else is ever downloaded, and nothing is sent: these are plain file downloads. A copy run
   from source uses the same path, so there is no separate setup. The test that lists every web
   address in Sage's code gets these three addresses added.

   *Check:* tests with a fake download server on `127.0.0.1` (a correct file, a forward, a forward to
   plain HTTP, a wrong fingerprint, a file that is too big, a failed connection, a cancel, leftovers
   cleaned up); and one real download and transcription on the review machine, outside the tests,
   reported in the pull request.
3. **Speech to text, in its own background helper.** Recognition runs in a separate helper process
   that Sage starts (Electron's "utility process"), so a slow or crashing recognition can't freeze or
   close Sage's window. The build makes the helper's own file, and the engine is loaded only there. If
   the helper crashes or takes over 60 seconds, Sage says so and starts a fresh one next time. The logic
   (limits, one recording at a time, errors, the download) lives in `src/core/`, where the tests use a
   stand-in engine; the files that touch the real engine stay small.

   *Check:* tests of the logic with the stand-in engine (including a crash and a timeout); the
   real-engine check from step 2.
4. **Hold to talk, in the window.**
   - Hold **Ctrl+Space** while Sage's window is focused, or press and hold the new microphone button.
     Releasing either key stops it. A quick tap that records almost nothing is ignored.
   - While you hold it, Sage shows "Listening…" with a timer; then "Working out what you said…".
   - At most 30 seconds per recording.
   - The microphone is open only while you hold. It closes on release, and also if the window loses
     focus or you start a New chat, so it can never be left on.
   - How the sound gets to the helper: the window records with the browser's standard recorder, turns
     the recording into plain speech-quality sound (one channel, 16,000 samples a second) and sends it
     once, on release. This uses no extra window permissions, no background scripts in the window and
     no changes to its content rule.
   - The window gets four new requests to the main part of Sage, each checked the same way as today's:
     *voice status* (is the speech file there; is a download running), *download the speech file* (the
     main part asks first, with its own box), *cancel the download*, and *turn this sound into text*.
     The sound is refused, before it is read, if it is over 30 seconds, empty or malformed.
   - **The words you said are put in the message box, not sent.** You check them and press Enter, so a
     misheard word never goes to Sage unseen. Anything already in the box is kept.
   - Plain messages if the microphone is blocked (with where to allow it in Windows settings), missing,
     or nothing was heard.
   - The audio is never saved to disk or logged, and neither are the words, beyond what already happens
     to typed messages.

   *Check:* tests for the key and button handling (repeat presses ignored, release, quick taps, losing
   focus, New chat, the 30-second cap), the microphone errors, the download prompts, the four requests'
   checks (size, type, one at a time), and that the window's security settings and content rule are
   unchanged.
5. **Spoken replies.** Sage reads a reply aloud using a voice installed on the PC, with no new package.
   - A new setting, "Read replies aloud": **after voice messages** (the default), **always**, or
     **never**. A message counts as a voice message if any of its words came from talking, even if you
     edited them before pressing Enter.
   - Only Sage's final reply is spoken, never web pages, notes or reminders on their own.
   - A "Stop speaking" button; pressing the talk key or starting a New chat stops the speech, so Sage
     never hears itself.
   - If the PC has no voice (possible on Linux), Settings says so and replies stay as text. Sage waits
     for the PC's voice list to load before deciding there is none.
   - The setting is added to the existing settings file without changing its version, so settings
     saved by today's Sage still load as they are.

   *Check:* tests with a stand-in speech object (which replies are spoken, stop, no voice, a late voice
   list) and that an existing settings file loads unchanged with the new setting at its default.
6. **Docs.** The README (what voice does, the one-time download and that it is the only thing Sage
   downloads by itself), `docs/installing.md` (Windows's microphone privacy setting), a "Voice" section in
   `docs/windows-checklist.md` (the microphone prompt, a recording, offline with the network off,
   spoken replies, and the installed app), `docs/architecture.md`, `docs/assurance-case.md` (the
   microphone, the download, the native code, the helper process), the repo's guidelines,
   `CHANGELOG.md`, and the notes.

   *Check:* `npm run verify` (including the 80% test coverage floor), and a plain-English read before
   final approval.
7. **The owner's check on Windows** before final approval: run the "Voice" section of the checklist
   from source and in the installed app.

## Who's on it

Researcher (done), Plan Checker (done), Engineer, QA, Security Officer, Second Security Reviewer,
Auditor, and a Plain-English Reader before final approval. The CEO keeps the notes.

## Risks

- **First native code and first download.** Native code runs with Sage's full rights and sits outside
  the archive's integrity check. Kept small by: one well-known package at an exact version with no
  install scripts, run in its own helper process; the model checked by fingerprint.
- **Accuracy.** The tiny model is fast but can mishear names. That's why the words go into the box
  first. A larger model (Moonshine base, about 3 times the size) is a small change later if needed.
- **Can't be fully tested here.** The review machine has no screen or microphone. The engine and model
  are tested for real outside Electron; the microphone, voices and installed app are checked by the
  owner on Windows (step 7).
- **The window's built-in voices** on Windows are expected to work offline, but this is only confirmed
  by the owner's test. If they don't, spoken replies are switched off by default and the cause is
  recorded.
- **Hugging Face** could remove or move the files. The fingerprints stop a changed file being used; a
  missing file shows a plain error, and the addresses are one place to change.
- **Test coverage.** A lot of the new code is in the window. The tests' stand-in window gets a
  stand-in microphone, recorder and speech object so the 80% floor still holds.

## Out of scope

- A wake word, a talk key that works when Sage isn't focused, and sending speech without checking it
  (later items).
- Better voices (Sage's own voice model), and languages other than English.
- The first-run setup job (the local model runner and its model).
