# Plan: first-run-setup

## What the owner asked for

"Start the first-run setup job": the roadmap item "First-run setup. Checks that the local model runner is
installed, downloads a model, and lets the user add an online-service key."

## What we found

- Today Sage always opens on Chat. If the local model runner isn't running, or the model isn't
  downloaded, the user finds out only when a message fails, and the "model missing" message tells them
  to type a command in a terminal.
- The runner has a small web interface on this PC (`127.0.0.1:11434`, the address Sage already uses for
  chat). Through it Sage can ask whether the runner is running, which models it has, and ask it to
  download a model, with progress. The runner downloads and checks the model files itself.
- Sage can't run programs or installers (one of its rules), so it can't install the runner. It can
  point the user to the install steps. Sage can't tell "not installed" from "installed but not started"
  without running programs, so both get one message.
- Settings already has everything for the online-service key (address, model, key, Save key), with the
  key encrypted and tied to its service.
- Sage's window can't open web pages today. The install steps for the runner are in Sage's own guide,
  `docs/installing.md`, which links to the runner's download page.

## What we'll change

1. **A check of the local model runner**, done by the main part of Sage over the same fixed address as
   chat (`127.0.0.1` only, no redirects, short time limit, replies checked and size-capped). It lives in
   a small new runner client next to the chat code, which also does the download (step 3) and the
   skills check. It gives one of three answers for the local model saved in Settings: *not reachable*
   (not installed or not started), *running, but this model isn't downloaded*, or *ready*. It also says
   which of Sage's two models (step 2) are already downloaded.

   *Check:* tests with a fake runner on `127.0.0.1` (each answer, a slow or broken reply, a model name
   with and without a `:latest` ending).
2. **A Welcome screen**, a third view in Sage's window (no new windows), shown the first time Sage
   opens. It goes step by step:
   1. *Where should Sage think?* **On this computer** (recommended, private) or **An online service**.
      Online marks setup as done and opens Settings, where the address, model and key are saved as
      today (no second key form); **Set up Sage** in Settings brings the Welcome screen back if that was
      a mistake.
   2. *The local model runner.* The check's answer in plain words, a **Check again** button, and, if it
      isn't reachable, short install steps and an **Open the install guide** button. Sage first asks in
      its own box ("Open Sage's install guide in your web browser?", **Not now** by default), then opens
      one fixed address: the "local model runner" section of `docs/installing.md` on GitHub. That page
      has the runner's download link and steps. Sage opens nothing else, and the address can't come from
      the window, a reply or a web page. If no browser opens, Sage says so and shows the address to
      copy.
   3. *A model.* **Standard** (`qwen3:4b`, about 2.5 GB, Sage's default) or **Smaller, for PCs with less
      memory** (`qwen3:1.7b`, about 1.4 GB, faster but makes more mistakes). The choice is saved as the
      local model. **Download** asks first in Sage's own box, with the size and "this needs an internet
      connection and free disk space; the runner downloads and checks the files". Only then does Sage ask
      the runner to download it. A progress bar, **Cancel**, plain messages for errors (offline, not
      enough disk space, model not found, other), and **Try again**. A download that shows no progress
      for 2 minutes is stopped. A model that is already downloaded is marked as such and needs no
      download. After the download, Sage asks the runner whether the model can use Sage's skills
      (tools). If it says no, Sage says skills like notes and reminders won't work with it and suggests
      the other model or an online service; if the runner doesn't say, Sage carries on.
   4. *Done.* A short summary, a line about voice ("hold Ctrl+Space to talk; Sage asks before
      downloading the speech file the first time"), and **Start chatting**.

   **Skip setup** is always there. Skipping or finishing saves "set up" in the settings file, so the
   screen doesn't come back; a **Set up Sage** button in Settings opens it again. The new setting is
   added without changing the settings file's version, so today's settings still load, and saving the
   Settings screen keeps it. Existing copies of Sage (including the owner's) see the Welcome screen once,
   and can skip it; skipping or finishing changes nothing else (apps, folders, the online service and
   the key stay as they are). The Welcome screen saves only its own choices (the model and "set up"),
   through their own requests to the main part of Sage, never by rewriting the whole settings file.

   Inside the window:
   - Chat stays hidden until Sage knows which screen to show, and reminders and other notices wait while
     the Welcome screen is open, then show when Chat opens (today they wait the same way while Settings
     is open).
   - Ctrl+Space (talk) works only on the Chat screen.
   - The download's progress is fetched by the window every half second, the same way voice does it.
   - The Welcome screen's code goes in its own file, like the voice controls, so the tests cover it
     well and the 80% floor holds.

   *Check:* tests for each step and button on the stand-in window, the two "ask first" boxes (Not now,
   Download/Open), the fixed address, the download progress, cancel, the stall limit, each error
   message, that a settings file without the new setting loads unchanged, that saving Settings keeps
   it, that notices wait while Welcome is open, and that Ctrl+Space does nothing there. Existing window
   tests start as "already set up".
3. **The download through the runner** runs in the main part of Sage, one at a time, stopped when Sage
   quits. Only Sage's two model names can be requested, never a name typed in the window. Progress is
   read line by line, each line size-capped and checked. Sage shows only its own messages, never text
   from the runner. Unlike the speech file, Sage doesn't fingerprint this
   download itself: the runner downloads and checks it, and the box and the docs say so.

   *Check:* tests with a fake runner that streams progress, stalls, sends an error, sends an oversized
   or malformed line, or is cancelled.
4. **Better chat messages.** When the runner isn't reachable or the model is missing, the chat message
   points to **Settings → Set up Sage** instead of a terminal command.

   *Check:* the existing brain and window-request tests, updated, and the places in the README,
   `docs/installing.md` and the Windows checklist that quote these messages.
5. **Docs.** `docs/installing.md` (the Welcome screen does the model download; typing the command stays
   as the alternative), the README, a "First-run setup" section in `docs/windows-checklist.md` (no
   runner, runner stopped, runner without the model, a real download, cancel, skip, Set up Sage again),
   `docs/architecture.md`, `docs/assurance-case.md` (the one fixed link Sage can open, and that a model
   download is something the user starts and the runner performs: the speech file stays the only thing
   Sage itself downloads), the repo's guidelines, `CHANGELOG.md`, and the notes. The test that lists
   every web address in Sage's code gets the install-guide address added.

   *Check:* `npm run verify` (including the 80% test-coverage floor) and a plain-English read before
   final approval.
6. **The owner's check on Windows** before final approval: the checklist's new section, ideally once
   with the runner stopped and once with a model not yet downloaded.

## Who's on it

Researcher (done), Plan Checker, Engineer, QA, Security Officer, Second Security Reviewer, Auditor, and
a Plain-English Reader before final approval. The CEO keeps the notes.

## Risks

- **The runner's interface could change** in a later version. The replies are checked, and anything
  unexpected becomes a plain "the runner gave an answer Sage couldn't read" message.
- **Big download.** About 1.4 to 2.5 GB. The box says so before anything starts, and Cancel works at any
  time.
- **Cancel behaviour.** Whether the runner keeps the part already downloaded is up to the runner, so Sage
  only says "Cancelled". The owner's Windows check confirms what happens.
- **A first link out of Sage.** Kept to one fixed address of Sage's own guide, after asking. The
  window's own rules (no navigation, no pop-ups) don't change.
- **Can't be fully tested here.** The review machine has no screen and no runner; the logic is tested
  with a fake runner, and the owner checks the real thing on Windows.

## Out of scope

- Installing the runner for the user, or telling "not installed" from "not started" by looking for its
  program files.
- A key form inside the Welcome screen (it uses Settings), and offering the speech file download during
  setup.
- Choosing between more than two models, or checking the PC's memory.
