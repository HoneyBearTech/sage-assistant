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
- [x] **Minor:** re-collect window notices before showing them when Chat opens. This stops a just-deleted
      reminder from showing once (see the decisions log).
      Done: opening Chat and the window coming back into view collect first, then confirm what is held;
      one collection runs at a time, and a request made meanwhile gets one fresh collection after it.
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
- [x] **Owner:** add the release workflow from [Releasing](releasing.md), then make the first release
      (`v0.1.0`) and check its installer against the checksum. The workflow is added (#16, the same text
      as in Releasing). 0.1.0 was released on 2026-11-16 and its installer checked against the checksum
      and build record; 0.1.1's version pull request is done and waits for the owner's tag (step 6 of
      Releasing).
- [x] **A Sage icon** (sage-icon): a white sage leaf on a green tile, in Sage's colours, for the
      installer, `Sage.exe`, the shortcuts, the taskbar and the window. The drawing and the picture made
      from it are in `build/`. The original item: for the installer, the shortcuts and the window (the
      installer uses Electron's default icon for now).
- [ ] **Owner:** build the installer on Windows and check the icon on the installer, the shortcuts, the
      taskbar and the window ("Installed app" in [the Windows checklist](windows-checklist.md)), if not
      done before merging PR #14.
- [x] **Public-repo checker:** also catch e-mail addresses written with JSON escapes (such as `\u0040`
      for `@`) in JSON files. This gap is older than the installer job.
      Done: a line with `\u` and four hex digits or `\/` is also scanned decoded (an escaped backslash
      becomes one backslash), in every text file; a problem found only there is reported once, marked
      "(written with escapes)".
- [x] **Track the minimatch advisory** (GHSA-g3hv-75wg-m249) in electron-builder's build tools, and
      take the electron-builder update that fixes it.
      Done: no electron-builder release takes the fixed minimatch yet, so npm `overrides` entries move
      the two affected copies to minimatch 11.0.8; remove each when its parent asks for 11.0.1 or later
      (see CONTRIBUTING.md).
- [x] **Voice** (voice): hold Ctrl+Space or the Talk button to talk; offline speech recognition
      (sherpa-onnx with the Moonshine tiny English model, downloaded once after asking and checked by
      fingerprint); the words go into the message box to check before sending; spoken replies with the
      PC's own voices and a "Read replies aloud" setting. The original item: Hold a key to talk, offline
      speech recognition, and spoken replies.
- [ ] **Voice accuracy:** if the tiny model mishears too often, move to Moonshine base (about 3 times
      the size): new pinned addresses, sizes and fingerprints in `src/core/voice/model.ts`.
- [x] **Test coverage counting:** each window test loads the window script again, and each load counts
      as a separate, partly covered file, so the total drifts toward the 80% floor as window tests are
      added (82.5% after the voice job). Count the window script once.
      Done: the window script is now `startChatWindow()`, loaded once by the tests; `renderer.ts` went
      from 79.9% to 96.4% of lines, and the all-files total from 86.4% to 99.1%.
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
- [x] **A new look, part 1** (hud-look): a dark "HUD in green" theme (Dark, Light or Match system), an orb
      that shows when Sage is resting, listening, thinking or speaking, the chat as a YOU / SAGE
      transcript whose newest reply types itself out, an amber card in the chat while Sage's system box
      asks, short sound effects with a Sound switch (off at first), all motion off under reduced motion,
      and `npm run preview`, a review-only page of the look. See
      [the interface study](reports/2026-11-16-jarvis-look.md).
- [ ] **Owner:** run the "New look" section of [the Windows checklist](windows-checklist.md) after the
      next install.
- [ ] **A new look, part 2: a Home screen.** A large orb, a clock, a greeting for the time of day, and
      panels for today's reminders, recent notes and Sage's status; then a daily brief that reads them
      out. Also from part 1: small cards in the chat for actions Sage took without asking (they need a
      new one-way message to the window), and showing a question that is still open after the window
      reloads.
- [ ] **A new look, part 3: the Welcome screen as a start-up sequence.** The same steps as numbered
      sections with typed check lines, plus a support code and Copy diagnostics when something fails.
- [x] **More online brains** (brains-api): Claude, OpenAI and Gemini with the user's own API key, next
      to On this computer and Another online service. One key per company, kept in the system's protected
      storage and only ever sent to that company's own address; Load models, Test and Get a key (opened
      after Sage's asking box); plain messages for a wrong key, used-up credit, a retired model or a busy
      service; settings and the key from 0.1.1 carry over. Claude uses its Messages format, OpenAI its
      Responses format and Gemini its own format, each with Sage's skills.
- [ ] **Owner:** run the "Online brains" section of [the Windows checklist](windows-checklist.md) with a
      real key for each service you want, after setting a low spending limit on the company's website.
- [ ] **Move the Messages-format brain to the newer API version** (`anthropic-version` 2026-10-21; Sage
      sends 2023-06-01, which still works). Check what the newer version changes first.
- [ ] **Check against the real services** what the team could only take from the docs: OpenAI's encrypted
      reasoning with `store: false`, the shape of Google's daily-quota error, and Anthropic's "credit
      balance too low" error.
- [ ] **Minor:** in Settings, a Test or Load models still running when that company's key is saved or
      removed can show its old answer ("The key works" next to "No key saved"). Sage itself never reuses
      the old answer; only the window's display is stale. Clear pending results when the key changes.
- [x] **OpenSSF Best Practices badge** (openssf-badge): the badge for project 16810 under the README's
      title, explained in [the GitHub checks notes](github-checks.md).
- [ ] **Owner:** fill in the questionnaire at https://www.bestpractices.dev/projects/16810 (the badge
      shows "in progress" until then). A later job can draft suggested answers from the repo.
- [ ] **GitHub Copilot sign-in** with the user's subscription, after a trial that checks it can answer
      without using its own tools. Its own plan.

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
