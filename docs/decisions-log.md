# Decisions log

Why past decisions were made, newest first.

## 2026-11-16 - voice

**Context:** the owner asked to "start the voice job", the roadmap item "Hold a key to talk, offline
speech recognition, and spoken replies", after the Windows installer shipped.

**Decisions:**
- **sherpa-onnx (`sherpa-onnx-node` 2.0.1, Apache-2.0) for speech recognition**, Sage's first run-time
  dependency and first native code. It has ready-built files for Windows and Linux and no install
  scripts. Its native files are kept unpacked next to the app's archive, because Windows can't load them
  from inside it.
  - *Rejected:* Chromium's built-in speech recognition (it sends audio to an online service, and doesn't
    work in Electron); Whisper in the window (it needs the content rule loosened for WebAssembly and
    fetches models from the window); whisper.cpp add-ons (a release candidate with a setup script, or
    built on the user's PC); Vosk (unmaintained).
- **The Moonshine tiny English model (MIT), downloaded once after asking.** About 44 MB in three files
  from Hugging Face, pinned to one commit, each checked by exact size and SHA-256 before use, and checked
  again once per run before its first use. Redirects are followed by hand, at most five, each over HTTPS.
  A download that stalls for 30 seconds stops. The owner kept this choice at plan approval.
  - *Rejected:* bundling the model in the installer (44 MB bigger, and the copy run from source would
    still need its own download); a file the user copies in by hand.
- **Recognition runs in its own helper process** (Electron's utility process), so a crash or a hang
  can't freeze or close Sage's window; a 60-second limit, and a fresh helper after a crash.
- **Hold to talk only while Sage's window is focused** (Ctrl+Space, or the Talk button). A key held
  anywhere on the PC needs a system-wide keyboard hook, the kind of code a keylogger uses.
- **The words go into the message box, never sent on their own**, so a misheard word is never sent
  unseen. A held or repeating Enter can't send them either: sending needs a fresh press.
- **The window records with the browser's standard recorder** and converts the sound itself, with no
  worklets, workers or `blob:` addresses, so the window's security settings and content rule are
  unchanged. The audio is checked by size and type before the main part reads it, and is never saved or
  logged.
- **Spoken replies with the PC's own voices** (only voices that run on the PC), with a "Read replies
  aloud" setting: after voice messages (the default), always or never. A message counts as a voice
  message while any dictated words stay in it. Only the final reply is read. The setting was added
  without changing the settings file's version, so older settings files load unchanged.
  - *Rejected for now:* sherpa-onnx's own voices (a second download and more code); that is the later
    "Better voices" job.

**Review:** a plan check before Gate A, then QA (pass), the Security Officer, a second security review
(clear) and the Auditor, with two fix rounds and a re-check after each. The engine and the real model
were run on the review machine outside Electron (a real download and a correct transcription). The
microphone, the helper process inside the installed app and the PC's voices can only be checked on
Windows, so the owner runs the checklist's Voice section before final approval.

**Fixed after review:** releasing a keyboard-held Talk button after focus moved didn't stop the
recording; a held Enter could send dictated words without a fresh press; a transcript could push the
message past 8,000 characters; a status line could stay after New chat; a stalled download waited
forever; the model was re-checked only by size; the download box said "Nothing is sent" (now: none of
your speech or text is sent).

**Rejected or deferred findings:**
- *Clear the voice mark on New chat* (a fix-round request). Reversed: New chat keeps the words in the
  box, and the plan says a message with dictated words counts as a voice message.
- *A model file changed while Sage is running isn't caught* (Security Officer, informational). Accepted:
  it needs write access to Sage's data folder, which already allows worse; the assurance case says so.
- *Line coverage drifts toward the floor* (Engineer). Real, caused by how window tests are counted;
  added to the roadmap.

## 2026-11-16 - windows-installer

**Context:** the owner asked to "start the installer job", the next roadmap item, after running the
Windows checklist (everything worked) and checking the GitHub settings (Dependabot alerts on, Dependabot's
own update pull requests off).

**Decisions:**
- **electron-builder 26.18.1 with a one-click NSIS installer**, per user, with no admin rights, shortcuts,
  and Sage starting when it's installed. Uninstalling keeps Sage's data.
  - *Rejected:* Electron Forge with Squirrel or an MSI. It would mean reorganising the build around
    Forge, and MSI isn't one-click. electron-builder's own docs mark its Squirrel target as deprecated.
- **The data folder stays `%APPDATA%\sage-assistant`.** "Sage" is set as the product name only in
  `electron-builder.json`, never in `package.json`, because Electron names the data folder after the
  archive's `package.json`. A test checks this.
- **Settings in JSON** (`electron-builder.json`), so the fuse drift test reads them with no extra package.
- **All seven fuses are set by electron-builder** right before any signing step. A test keeps
  `electron-builder.json` and `src/main/fuses-config.ts` the same. The old `npm run fuses` script is
  removed. The two new fuses (`GrantFileProtocolExtraPrivileges` off, `EnableCookieEncryption` on) stay
  only if the owner's Windows test shows the window still loads.
- **zod moved to the dev dependencies.** It is bundled into `main.cjs`, so the archive holds no
  `node_modules`.
- **`electron-winstaller`'s install script is off** (`allowScripts`). It only copies a 7-Zip file for
  Squirrel, which NSIS doesn't use. Renovate notes on electron-builder updates say to check its version.
- **The release workflow is ready-to-paste text** in `docs/releasing.md`, because the team doesn't add
  workflows. It builds only tags on `main`, uses no shared cache, checks the tag against
  `package.json`, writes `SHA256SUMS.txt` and a build provenance record, and publishes exactly three
  files. Only the publishing job can write to the repo. It also finishes an empty draft that an earlier
  run left behind.
- **The public-repo checker** skips e-mail addresses on a `package-lock.json` line only when the whole
  line is npm's copied `"deprecated"` notice (one such notice names a package author's public address).
- **No icon yet, no signing yet.** The installer uses Electron's default icon, and SmartScreen warns about
  the unsigned installer; the docs explain how to check the checksum and continue.

**Review:** a plan check before Gate A, then QA, the Security Officer, a second security review and the
Auditor, with one fix round and a re-check. The real installer can only be built on Windows, so the
owner builds and installs it from the branch, with the checklist's "Installed app" section, before
final approval.

**Rejected or deferred findings:**
- *`npm audit` must be clean (Auditor, must-fix).* Rejected for this job. The one advisory
  (GHSA-g3hv-75wg-m249, minimatch, moderate) is in electron-builder's build tools, and the fixed
  minimatch is a major version electron-builder 26.18.1 doesn't accept; `npm audit fix --force` would
  drop to electron-builder 25. The code runs only at build time, on file patterns the repo writes, and
  both security reviews found it unreachable from untrusted input. Tracked on the roadmap.
- *The Dependency review check will fail on that advisory and on one WTFPL-licensed package (both
  security reviews).* Not so: the check passed on the pull request, so the owner didn't need to change it.
- *The public-repo checker misses e-mail addresses written with JSON escapes.* Real, but older than this
  job. Deferred to the roadmap.

## 2026-11-16 - biome-2-6-8

**Context:** the owner asked to "fix the Biome PR". Renovate's pull request #4 moves Biome from 2.5.15
to 2.6, and its checks failed. Biome 2.6 started formatting Markdown files, so every doc failed the
format check (it wanted to pad tables with spaces and change the italics style). The code itself passed.
The `$schema` line in `biome.jsonc` also needed the new version number. The team can't push to
Renovate's own branch, so the update was made in this job's pull request instead.

**Decisions:**
- **Biome 2.6.8, exact version**, the same as Renovate's update. The lockfile changes only Biome's own
  packages. Two new optional packages for Android are listed by Biome 2.6.8 itself, and are never
  installed on Windows or Linux. None of the changed packages runs an install script.
- **Biome's Markdown formatter is off** (`"markdown": { "formatter": { "enabled": false } }` in
  `biome.jsonc`, with a comment). The docs are hand-written prose, wrapped by hand and reviewed in pull
  requests. The linter and the formatters for code and JSON are unchanged.
  - *Rejected:* letting Biome reformat every doc. It is a large change with no gain for readers, and it
    would make the docs' history harder to follow.
  - *Rejected:* leaving `.md` files out of Biome's file list. Turning off only the Markdown formatter is
    narrower, and keeps any future Markdown checks Biome adds.
- **Docs that name the Biome version** (the repo's guidelines, CONTRIBUTING and the architecture page)
  now say 2.6.8.

**Review:** the Security Officer, a second security review and the Auditor all found nothing to fix.
`npm audit` found no vulnerabilities, and the registry signatures were verified. QA and the plan check
were skipped because the change is small. No fix rounds were needed.

**Follow-up:** Renovate's #4 is replaced by this pull request. Renovate should close it on its next run
after this one is merged; if it doesn't, the owner can close it by hand.

## 2026-11-16 - renovate

**Context:** the owner asked: "This will use Renovate instead of Dependabot." By then the owner had added
the GitHub workflows, CODEOWNERS, private vulnerability reporting and a branch ruleset ("Main"). They
had also installed the Renovate app and merged its starter config. That config failed the Biome format
check, so CI on `main` was red until this job.

**Decisions:**
- **Scope:** Renovate for npm and GitHub Actions only (`enabledManagers`).
- **Schedule:** weekly, before 6am on Monday, US Central time. Security fixes come at any time, with a
  `security` label. The lockfile is refreshed monthly.
- **Exact versions:** kept with the `:pinAllExceptPeerDependencies` preset.
  *Rejected:* a global `rangeStrategy: "pin"`. It would also pin `engines.node` to one exact Node release.
- **Actions:** stay pinned to a full SHA (`helpers:pinGitHubActionDigests`). Minor, patch and digest
  updates of actions are grouped, and the CodeQL actions always move together.
- **A 3-day wait** before a new npm release is proposed, as a guard against a just-published bad release.
  - Vulnerability-alert pull requests are exempt: that is Renovate's default.
  - The monthly lockfile refresh is exempt too, because it has no release date. Without the exemption its
    check would stay pending forever.
- **Electron:** major versions come in their own pull request, with a note pointing to the Windows
  checklist.
- **Manual follow-ups:** esbuild and Biome updates carry notes about the change a person has to make on
  the same pull request (`allowScripts`, the `biome.jsonc` schema line).
- **No auto-merge.** Renovate never merges its own pull requests.
- **The checks page:** `docs/github-checks-to-add.md` became `docs/github-checks.md`, a short record with
  links to the workflow files instead of copies of them. Settings the team can't read (secret scanning and
  push protection, Dependabot alerts on, Dependabot's own update pull requests off) are listed for the
  owner to check.

**Review:** QA, the Security Officer, a second security review and the Auditor, with two fix rounds. The
install-script finding was raised by both security reviews, so it counted as confirmed. The checklist now
covers any package that adds an install script, not only esbuild.

**Windows test fix:** with `main`'s format error gone, CI ran the tests on Windows for the first time.
Three file-opening tests failed there. The runner's temp folder has a short 8.3 name, while Sage
correctly reports real (long) paths. The test helper now returns the real path. This was test-only; the
app was right.

**Rejected or deferred findings:**
- *"Renovate is installed" can't be shown from the repo.* Rejected: the onboarding pull request (#2) was
  merged, and Renovate has opened update pull requests.
- *The DCO check's bot exemption trusts the commit author, which a contributor could fake.* Deferred: it
  needs a workflow change, which is the owner's to make. The risk is low, since the owner reviews every
  pull request.

## 2026-11-15 - sage-foundation

**Context:** the first job for S.A.G.E. (System for Assistance, Guidance & Execution). The owner wants a
desktop assistant that runs on a Windows PC, installs as its own app, and runs from source on Linux.

**Decisions (owner):**
- Name: S.A.G.E., "Sage" for short.
- Target: a Windows PC first; Linux runs from source.
- Brain: switchable. A local model runner on the same PC by default, or an online model service with the
  owner's own key.
- v1: a chat window, then hold-a-key voice; a wake word later.
- v1 skills: answer questions, open apps and files, web search, notes and reminders. Anything that
  changes the computer asks first.
- Packaging: its own desktop app built with Electron, with a one-click installer on Windows.
- This repo's code and docs may name the model runner Sage talks to and describe Sage as an assistant.
  Nothing says who or what wrote the code.

**Decisions (plan, approved on PR #1):**
- **One language: Electron with TypeScript, and no local server.** The window talks only to the app's own
  main process.
  *Rejected:* Python with a Qt window (no Electron installer); Python with a local web server (an open
  port is the most common hole in similar projects); Tauri or Electron with a Python helper (two
  toolchains).
- **Local brain:** the local model runner's HTTP API, fixed to `127.0.0.1`, with redirects refused.
- **Online brain:** any service that speaks the common chat-completions format, so no vendor library is
  needed. HTTPS is required, except to loopback.
- **The online key:** encrypted with the system's protection (Electron safeStorage) and tied to the
  service address it was entered for. Changing the service removes the key, and a turn already running
  stops.
- **Ask first:** opening an app or a file and deleting a note or reminder always ask. The box is a native
  main-process box with "Don't allow" as the default. An approval is single-use and bound to the exact
  program, file or item. There is no run-command skill and no "always allow" mode.
- **Notes and reminders:** adding them is safe, because they are Sage's own data. They are capped at 3 per
  message because web text could try to make the model add them.
- **Opening files:** only document, picture, sound and video types, and only inside approved folders.
- **Licence:** MIT.
- **Search:** DuckDuckGo's HTML page, with no key. The source can be swapped, and results are untrusted
  text.
- **No GitHub workflows from the team:** the checks ran locally with `npm run verify`, and the job handed
  over ready-to-paste workflow text. The owner has since added the workflows; `docs/github-checks.md`
  now records what is in place.
- **Order of the next jobs:** Windows installer, then voice, then first-run setup.

**Review:**
- There were three review rounds, plus a fix for tests that failed on a busy machine. Then came the
  owner's feedback round, with re-checks.
- The second security review was skipped because it couldn't be started on the build machine.
- Every file and commit message was scanned for wording the repo's rules forbid before review. The scan
  was clean.

**Rejected or deferred findings:**
- *Remove the list of roles from the plan file.* Rejected: plans name roles by design, and that says
  nothing about who wrote the code.
- *A reminder can appear twice if Windows confirms the notification after 5 seconds.* Accepted as a
  residual risk; see the assurance case.
- *A reminder can be lost if the window crashes in the instant between receiving it and showing it.*
  Judged too rare to handle in this job.

**Owner's feedback at final review ("fix"):** three items that were open after the two fix rounds are
now fixed:
- **Save key** is refused unless the address on screen is the saved one.
- **A reminder shown in the window** counts as shown only after the window confirms it is on screen. It
  isn't confirmed while Settings is open or Sage is minimised, and it comes back after a restart.
- **Deleting a reminder** withdraws it from the window queue.

Each re-check found a narrow follow-on case in the new window code. Two of them were fixed in small extra
rounds, so the work went past the usual limit of fix rounds, because those bugs came from the fixes
themselves.

**Still open (minor):**
- **A deleted reminder can show once.** The sequence: a delete is waiting for Allow while Settings is open,
  the reminder comes due, the user allows the delete, then goes back to Chat within the 5-second refresh.
  The deleted reminder can then appear once.
- It needs Settings open while the confirm box is waiting. The box is modal, so this is probably
  unreachable in the real app.
- Nothing is lost or exposed. Fix: re-collect notices before showing them when Chat opens.
