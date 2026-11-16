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
- [x] **Maintainer setup on GitHub:**
  - [x] add the checks ([the GitHub checks](github-checks.md));
  - [x] turn on private vulnerability reporting (SECURITY.md relies on it);
  - [x] run the [Windows checklist](windows-checklist.md) on a Windows PC (2026-11-16: everything worked).
- [x] **Dependency updates with Renovate** (`renovate.json`; see [the GitHub checks](github-checks.md)).
- [x] **Biome 2.6.8**, with Biome's new Markdown formatter turned off (replaces Renovate's #4).
- [x] **Owner:** check the settings listed under "Settings to check" in [the GitHub checks](github-checks.md),
      and compare the "Main" ruleset with the recommended branch rule there (2026-11-16: done, with
      Dependabot alerts on and Dependabot's own update pull requests off).
- [ ] **Owner, optional:** make the DCO check's bot exemption stricter. Check that the commit really comes
      from the bot (`.author.type == "Bot"`), not just its name.
- [x] **Windows one-click installer** (windows-installer): `npm run dist`, `electron-builder.json`, all
      seven fuses, and the release workflow as ready-to-paste text in [Releasing](releasing.md). The
      original item:
      A build that produces a checksummed installer on GitHub
      Releases, with the fuses set. It needs a GitHub workflow that the maintainer adds; the
      ready-to-paste text comes with the job. Starts with [the GitHub checks](github-checks.md).
      Also test the two fuses that `src/main/fuses-config.ts` doesn't set yet, and add them if the
      packaged app still works: `GrantFileProtocolExtraPrivileges` off (the window loads from
      `file://`, so check it still loads its script and styles) and `EnableCookieEncryption` on.
- [ ] **Owner:** add the release workflow from [Releasing](releasing.md), then make the first release
      (`v0.1.0`) and check its installer against the checksum. The version pull request for 0.1.0 is
      done (the changelog has its 0.1.0 heading), so what is left is adding the workflow and pushing
      the tag.
- [x] **A Sage icon** (sage-icon): a white sage leaf on a green tile, in Sage's colours, for the
      installer, `Sage.exe`, the shortcuts, the taskbar and the window. The drawing and the picture made
      from it are in `build/`. The original item: for the installer, the shortcuts and the window (the
      installer uses Electron's default icon for now).
- [ ] **Owner:** build the installer on Windows and check the icon on the installer, the shortcuts, the
      taskbar and the window ("Installed app" in [the Windows checklist](windows-checklist.md)), if not
      done before merging PR #14.
- [ ] **Public-repo checker:** also catch e-mail addresses written with JSON escapes (such as `@`
      for `@`) in JSON files. This gap is older than the installer job.
- [ ] **Track the minimatch advisory** (GHSA-g3hv-75wg-m249) in electron-builder's build tools, and
      take the electron-builder update that fixes it.
- [x] **Voice** (voice): hold Ctrl+Space or the Talk button to talk; offline speech recognition
      (sherpa-onnx with the Moonshine tiny English model, downloaded once after asking and checked by
      fingerprint); the words go into the message box to check before sending; spoken replies with the
      PC's own voices and a "Read replies aloud" setting. The original item: Hold a key to talk, offline
      speech recognition, and spoken replies.
- [ ] **Voice accuracy:** if the tiny model mishears too often, move to Moonshine base (about 3 times
      the size): new pinned addresses, sizes and fingerprints in `src/core/voice/model.ts`.
- [ ] **Test coverage counting:** each window test loads the window script again, and each load counts
      as a separate, partly covered file, so the total drifts toward the 80% floor as window tests are
      added (82.5% after the voice job). Count the window script once.
- [x] **First-run setup** (first-run-setup): a Welcome screen the first time Sage opens. It asks where
      Sage should think, checks the local model runner, opens Sage's install guide after asking,
      downloads Standard (`qwen3:4b`) or Smaller (`qwen3:1.7b`) through the runner after asking, and sends
      online users to Settings for the key. Skip setup, and **Set up Sage** in Settings to come back. The
      chat's runner messages now point there. The original item: Checks that the local model runner is
      installed, downloads a model, and lets the user add an online-service key.
- [ ] **Owner:** run the "First-run setup" section of [the Windows checklist](windows-checklist.md),
      including once with the runner stopped and once with a model not yet downloaded.
- [ ] **Later idea:** tell "not installed" from "installed but not started" without running anything
      (for example by looking for the runner's program files), if the single message proves confusing.

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
