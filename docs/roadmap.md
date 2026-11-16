# Roadmap

Sage is built in jobs, one pull request each. This page says what has shipped, what is next, what comes
later, and what Sage will not do.

## Shipped

**The foundation** (this job):

- [x] A text-chat Sage that runs from source on Windows and Linux (`npm install`, then `npm start`).
- [x] A switchable brain: a local model through Ollama on `127.0.0.1` (default), or an online model service
      with the chat-completions format and the user's own key. A plain-English message when the local
      runner isn't running.
- [x] Skills: answer, web search with no key, notes, reminders with desktop notifications, open an app from
      the user's list, open a file in an approved folder, delete a note or reminder.
- [x] The ask-first rule: every risky action shows a box that says exactly what will happen, each approval
      works once, no command skill, no "always allow", and a local action log.
- [x] Web and file text kept as untrusted data; tool calls capped per message.
- [x] The online key encrypted with the system's protection, and never written in plain text.
- [x] A locked-down window (sandbox, isolation, strict CSP, no navigation or pop-ups, microphone only) and
      the fuses script for the packaged app.
- [x] No telemetry.
- [x] Project files and `npm run verify`: lint and format, typecheck, tests with an 80% coverage floor, the
      public-repo checker and a secret scan.

## Next

- [x] **Open items from the foundation review** (see [the decisions log](decisions-log.md)):
  - [x] Save key must use the address on screen, or ask for Save settings first.
  - [x] A reminder shown in the window counts as shown only after the window confirms it.
  - [x] Deleting a reminder withdraws it from the window queue.
- [ ] **Minor:** re-collect window notices before showing them when Chat opens. This stops a just-deleted
      reminder from showing once (see the decisions log).
- [ ] **Maintainer setup on GitHub:**
  - [x] add the checks ([the GitHub checks](github-checks.md));
  - [x] turn on private vulnerability reporting (SECURITY.md relies on it);
  - [ ] run the [Windows checklist](windows-checklist.md) on a Windows PC.
- [x] **Dependency updates with Renovate** (`renovate.json`; see [the GitHub checks](github-checks.md)).
- [ ] **Owner:** check the settings listed under "Settings to check" in [the GitHub checks](github-checks.md),
      and compare the "Main" ruleset with the recommended branch rule there.
- [ ] **Owner, optional:** make the DCO check's bot exemption stricter. Check that the commit really comes
      from the bot (`.author.type == "Bot"`), not just its name.
- [ ] **Windows one-click installer.** A build that produces a checksummed installer on GitHub
      Releases, with the fuses set. It needs a GitHub workflow that the maintainer adds; the
      ready-to-paste text comes with the job. Starts with [the GitHub checks](github-checks.md).
      Also test the two fuses that `src/main/fuses-config.ts` doesn't set yet, and add them if the
      packaged app still works: `GrantFileProtocolExtraPrivileges` off (the window loads from
      `file://`, so check it still loads its script and styles) and `EnableCookieEncryption` on.
- [ ] **Voice.** Hold a key to talk, offline speech recognition, and spoken replies.
- [ ] **First-run setup.** Checks that the local model runner is installed, downloads a model, and lets the
      user add an online-service key.

## Later

- [ ] A wake word.
- [ ] Better voices.
- [ ] A code-signed installer, and updates that are signed and checked before they are applied.
- [ ] macOS.

## What Sage will not do

- **Run commands.** There is no skill that runs a shell command, a script or any program that isn't on
  your list, and there won't be one.
- **Act without asking.** Opening, starting, changing or deleting anything always asks first, every time.
  There will be no "always allow", "auto-approve" or bypass mode.
- **Take instructions from web pages or files.** What Sage reads is information, never a command.
- **Run a local server** that other programs or web pages could call.
- **Track you.** No telemetry, analytics, crash reporting or accounts.
- **Store your key in plain text**, or send it anywhere but the service you chose.
- **Load remote pages** in its window.
