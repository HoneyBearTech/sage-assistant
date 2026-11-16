# Decisions log

Why past decisions were made, newest first.

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
