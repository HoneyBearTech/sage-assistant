# Plan: sage-foundation

## What Sean asked for

"I'd like to create a Jarvis like application that will act as an AI assistant that runs on my computer."
It is called **S.A.G.E.** (System for Assistance, Guidance & Execution), "Sage" for short. It installs as
its own desktop app: a one-click installer on Windows, and on Linux it runs from the included source.

## What we found

- The repo is new and holds only a README. Sean's other public repos give the house style: a guidelines
  file, security and contribution files, notes in `docs/`, signed-off commits, an 80% test-coverage floor.
- Similar projects (see `docs/reports/2026-11-15-similar-projects.md`) share the same weak spots: local
  servers with no login, shell commands run without asking, "bypass" modes, API keys in plain text files,
  and tracking switched on by default. Sage is designed to avoid each of these.
- Electron in a single language (TypeScript) is the simplest fit. There is no hidden local server: the
  window talks to the app's own main process only.
- Some things can't be tried on the review machine, which runs Linux: the Windows installer, the
  push-to-talk key and the Windows voices. Those come in later jobs, each with a short checklist for Sean
  to run on his PC.

## The plan: Sage is built in a few jobs

This job is the **foundation**: a working text-chat Sage with all four v1 skills and the ask-first rule.
It runs from source on Windows and Linux (`npm install`, then `npm start`). Later jobs, one PR each:

1. **Windows one-click installer.** Needs a build step on GitHub that Sean adds himself (the team may not
   add GitHub workflows). The ready-to-paste text comes with this job.
2. **Voice.** Hold a key to talk, offline speech recognition, spoken replies.
3. **First-run setup.** Checks that the local model runner is installed, downloads a model, and lets
   Sean add an online-service key.
4. Later: wake word, better voices, a signed installer and updates, and macOS.

## What we'll change in this job

1. **Ground rules and public files.** README, licence (MIT), security policy, contribution guide,
   governance, code of conduct, support, changelog, the repo's guidelines, issue and PR templates, ignore
   rules.
   *Check:* the reviewers confirm the files exist and say nothing untrue (for example, they don't claim
   GitHub runs checks that don't exist yet).
2. **Tooling.** TypeScript, a linter and formatter, tests with an 80% coverage floor, and one command,
   `npm run verify`, that runs everything. A public-repo checker that rejects private addresses, home
   folder paths and personal emails, plus a secret scan.
   *Check:* `npm run verify` passes on a clean copy.
3. **The brain, switchable.** One interface with two connections behind it:
   - the local model runner on the same PC (default, `127.0.0.1` only);
   - any online service that offers the common chat format, using Sean's key.
   If the local runner isn't running, Sean gets a plain-English message.
   *Check:* tests against a fake model server. Tests never use the network.
4. **Skills, and the ask-first rule.** Each skill is marked "safe" or "asks first".
   - **Safe:** answer, web search, read and add notes, read and add reminders.
   - **Asks first:** open an app or file, delete a note or reminder.

   Rules for every skill:
   - Sage shows a confirm box that says exactly what it will do. Only Sean can answer it, never the model.
   - There is no run-any-command skill and no "always allow" or bypass mode.
   - Apps come only from a list Sean controls, and files only from folders he approves.
   - Text from web pages or files can't trigger a skill by itself.
   - Every confirmed action is written to a local log.

   *Check:* tests prove that an action needing approval never runs without it, whatever the model replies.
5. **Notes and reminders.** Kept in Sage's own folder in Sean's user profile. A desktop notification pops
   up when a reminder is due.
   *Check:* tests with a fake clock.
6. **Web search with no key.** A free search page, behind a switchable interface. Results count as
   untrusted text.
   *Check:* tests run on saved sample pages, with no live network.
7. **Settings and the online key.** Settings live in a file in Sean's profile. The key is encrypted with
   Windows' built-in protection and is never written to settings, logs or chat history.
   *Check:* a test proves the key never appears in any of them.
8. **The chat window.** A locked-down Electron window with:
   - no Node access from the page, the sandbox on, and a strict content policy;
   - no remote pages, and no navigation or popups;
   - the microphone as the only permission it can ask for (used in the voice job);
   - Electron's hardening switches ("fuses") on.

   It holds the chat, the confirm boxes and a settings screen (brain switch, key, app list, folders). No
   tracking or telemetry.
   *Check:* tests on the security settings and a headless start on Linux, plus a short Windows checklist
   in `docs/`.
9. **Docs.**
   - How Sage works.
   - The security case: what could go wrong (the model asks for something dangerous, a web page tries to
     trick it, the key leaks) and what stops it.
   - Running from source.
   - The roadmap, including "what Sage will not do".
   - "GitHub checks to add": ready-to-paste text for Sean.

   *Check:* reviewers read them against the code.

## Who's on it

Researcher (done), Engineer, QA, Security Officer, a second security reviewer, and an independent Auditor.
The job counts as security-sensitive: it stores a key, opens apps and files, and uses the network.

## Risks

- Nothing is tried on Windows during review. Sean runs the short Windows checklist from `docs/` after
  merging.
- Small local models can misuse skills. The ask-first rule stops anything risky regardless.
- The free search page could change or block requests. Search then says it's unavailable, and the
  search source can be swapped.
- Electron is a big download, a few hundred MB once installed.

## Out of scope

- Voice, the Windows installer and first-run setup (the next jobs).
- Wake word, signing, updates and macOS.
- GitHub workflows, branch rules and repo settings (Sean adds these from the docs).
