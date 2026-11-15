# Decisions log

Why past decisions were made, newest first.

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
- **No GitHub workflows from the team:** the checks run locally with `npm run verify`. Ready-to-paste
  workflow text is in `docs/github-checks-to-add.md`.
- **Order of the next jobs:** Windows installer, then voice, then first-run setup.

**Review:**
- There were three review rounds, plus a fix for tests that failed on a busy machine.
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

**Open at final review** (the two fix rounds were used up):
1. **Save key uses the saved address, not the one on screen.** Typing a new service address and key,
   then pressing Save key before Save settings, ties the key to the old saved service.
2. **A fallback reminder can be lost when collected.** A reminder shown in the window is recorded as
   shown while the window is still collecting it. If Sage closes in that moment, it is lost.
3. **A deleted reminder can still show.** Deleting a reminder that is waiting to show in the window
   doesn't withdraw it.
