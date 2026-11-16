# Windows checklist

Short manual checks for a Windows 10 or 11 PC, for the parts the automated tests can't reach (the real
window, the native confirmation box, notifications, the key encryption, the microphone and the voices).
Run them after a change to the window, the skills, the key store, voice or first-run setup, and before
any release. It takes about 15 minutes, the [First-run setup](#first-run-setup) section about 20 more
(it downloads a model), the [Voice](#voice) section about 10 more, the [Home screen](#home-screen)
section about 10 more, and the
[Installed app](#installed-app) section about 10 more.

Before you start: Ollama is installed and `ollama pull qwen3:4b` has finished (see
[installing.md](installing.md)), and Sage's source is up to date (`git pull`, `npm install`).

## Start

- [ ] `npm run verify` passes in PowerShell.
- [ ] `npm start` opens Sage's window, titled "Sage", with no errors in the terminal. The first time
      after updating to a version with first-run setup, the Welcome screen opens instead of the chat
      (once): choose **Skip setup**. The chat opens, and your apps, folders and online settings are
      unchanged in Settings. Close and start Sage again: it opens on **Home**.
- [ ] Starting a second copy (`npm start` in another PowerShell window) brings the first window forward
      instead of opening another.
- [ ] The header shows "Brain: on this computer (qwen3:4b)".

## Chat and the local brain

- [ ] Ask "What can you do?" and get a sensible reply.
- [ ] Quit Ollama (its icon by the clock → Quit), send a message: the reply is "Sage can't reach the local
      model runner. Start it, or open Settings → Set up Sage for help, then try again.". Start the runner
      again; the next message works.
- [ ] Ask "Search the web for today's weather in Paris": you get a short answer based on search results.

## Notes and reminders

- [ ] "Make a note called Shopping: milk and eggs", then "What notes do I have?" lists it.
- [ ] "Remind me to stretch in two minutes": within about two and a half minutes a Windows notification
      titled "Sage reminder" says "stretch".
- [ ] Turn notifications off for Sage (Settings → System → Notifications) and set another reminder for
      two minutes: within about two and a half minutes it appears in Sage's chat as a notice instead.
      Set one more for two minutes and close Sage straight away; start Sage again after three minutes:
      the reminder appears then, once. Close Sage and start it again: it doesn't appear a second time.
- [ ] With notifications still off, set a reminder for two minutes and open **Settings**. Stay there for
      three minutes, then close Sage without opening the chat. Start Sage again: the reminder appears
      in the chat.
- [ ] With notifications still off, set a reminder for two minutes and, before it is due, say "Delete
      the reminder" for it and choose **Allow**: nothing appears in the chat at the due time, nor after
      a restart. Turn notifications back on. (A reminder deleted while its notice waits behind
      Settings is taken out of the chat before it is seen; the box is modal, so that case is left to
      the tests.)
- [ ] "Delete the Shopping note": a confirmation box says *Delete the note "Shopping". This can't be
      undone.* Choose **Don't allow**: the note is still there. Ask again and choose **Allow**: it is gone.
- [ ] Ask "Make a note called Later: test", and choose **New chat** while it still says *Thinking…*: the
      chat empties, you can type a new message straight away, and "What notes do I have?" doesn't list
      "Later" (unless it was saved before you clicked; then try with a slower question). (The box
      itself is modal, so New chat can't be clicked while it is open; the tests cover that case.)
- [ ] Close Sage, replace the text of `%APPDATA%\sage-assistant\notes.json` with `oops`, and start Sage:
      the chat shows a notice that the notes file couldn't be read and where the old file was kept, and
      that file exists in the data folder.

## Apps and files (ask first)

- [ ] In Settings, add the app **Notepad** with the path `C:\Windows\System32\notepad.exe`, and add your
      Documents folder under folders. Save.
- [ ] "Open Notepad": the box says *Open the app "Notepad" (C:\Windows\System32\notepad.exe).* Press
      **Enter** without clicking: nothing opens (Don't allow is the default). Ask again and choose
      **Allow**: Notepad opens.
- [ ] "Open the calculator" (not on the list): no box appears, and Sage says it isn't on the app list.
- [ ] Put a text file in Documents and ask Sage to open it by its full path: a box shows the full path;
      **Allow** opens it in its default app.
- [ ] Ask Sage to open `C:\Windows\win.ini` (outside the approved folders): no box, and Sage says it can't.
- [ ] Ask Sage to open a `.exe` or a shortcut (`.lnk`) inside Documents: no box, and Sage refuses.
- [ ] Open `%APPDATA%\sage-assistant\action-log.jsonl` in Notepad: there is one line for each **Allow**
      and **Don't allow** above.

## The online key

- [ ] In Settings, choose **Another online service**, enter an address and model, paste a test key, and choose
      **Save key** before **Save settings**: the status says "Key not saved: Save settings first, then
      save the key." and no `online-key.bin` exists. Choose **Save settings**, paste the key again and
      choose **Save key**: the key field empties and the status says a key is saved.
- [ ] Type a different service's address without saving, paste a test key and choose **Save key**: it
      is refused with the same message, and the saved key is unchanged. Put the saved address back.
- [ ] Open `%APPDATA%\sage-assistant\settings.json` in Notepad: the key is not in it.
- [ ] Open `%APPDATA%\sage-assistant\online-key.bin` in Notepad: it is unreadable (encrypted), and the key
      can't be found in it with Ctrl+F.
- [ ] Type something in the model box without saving, then choose **Save key** again with a test key and
      switch to the chat and back: the unsaved model name is still there.
- [ ] Change the address to a different service and choose **Save settings**: the status says the key
      was removed, and `online-key.bin` is gone.
- [ ] Choose **Remove key**: `online-key.bin` is gone.
- [ ] Switch back to "On this computer" and save.

## Online brains: Claude, OpenAI and Gemini

Needs a real key for at least one of the three (set a low spending limit on the company's site first).

- [ ] Settings → Brain lists *On this computer*, *Claude*, *OpenAI*, *Gemini* and *Another online
      service*, each with its one-line note; Tab and the arrow keys move through them, and the screen
      reader reads each note.
- [ ] Choose each of Claude, OpenAI and Gemini in turn: the line about what is sent to which company
      appears, the model box shows that company's model, and the key status is that company's own.
- [ ] Choose **Get a key**: Sage's box asks first (**Not now** is the default). **Not now** opens nothing;
      **Open** opens the company's key page in the web browser.
- [ ] Paste the key, choose **Save key**: the field empties and the status says a key is saved. A file
      `claude-key.bin`, `openai-key.bin` or `gemini-key.bin` appears, unreadable in Notepad, and the key
      can't be found in it or in `settings.json` with Ctrl+F.
- [ ] Choose **Test**: "The key works: … answered."
- [ ] Choose **Load models**: a list appears; picking one fills the model box, which can still be typed
      in. Choose **Save settings**: the line about what is sent to which company shows.
- [ ] Ask a question in Chat: the answer comes from that service.
- [ ] Ask "open <an app from your list>": Sage's box asks first, exactly as with the local brain, and
      **Don't allow** stops it.
- [ ] Ask Sage to add a note, then to list notes: both work, and the answer uses the list.
- [ ] With each of the three, ask "What notes and reminders do I have?" (two skills in one message):
      the answer uses both lists, with no error (the service's thinking went back unchanged).
- [ ] Paste a key, then pick another brain before **Save key**: the key box is empty.
- [ ] Ask something, and while Sage is answering save a different model name: the answer stops with
      "The brain settings changed…".
- [ ] Save a second company's key: both files exist. **Remove key** for one: only its file is gone and
      the other brain still answers.
- [ ] Save a wrong key (change one character) and choose **Test**, then ask something: both say the key
      wasn't accepted, in a plain sentence, without the service's own text.
- [ ] Type a model name that doesn't exist and ask something: Sage says the company doesn't know that
      model.
- [ ] Turn off the network and ask something: "Sage can't reach … Check your internet connection."
- [ ] A settings file from 0.1.1 with an online service (copy one in before starting): Sage shows
      *Another online service* with the same address and model, and its saved key still works.
- [ ] Switch back to "On this computer" and save.

## First-run setup

Run this section after a change to the Welcome screen, the runner client or the setup code, and before
any release. You need the network for the download (the Smaller model is about 1.4 GB). To see the
Welcome screen again at any time, choose **Settings → Set up Sage**.

- [ ] **No runner.** Quit the local model runner (its icon by the clock → Quit). Choose **Settings → Set
      up Sage**: the Welcome screen opens with no tabs, the focus on "01 Where Sage thinks", and
      **Skip setup** at the top. Choose **On this computer**: under "02 Model runner" one line types out,
      "Looking for the local model runner... not found", and it says Sage can't reach the local model
      runner (not installed yet, or not running), with **Support code: SAGE-RUN-01** in amber next to
      it, install steps, **Open the install guide**, **Check again** and **Copy diagnostics…**. **Next**
      is greyed out.
- [ ] **Numbered sections.** The four steps are labelled 01 Where Sage thinks, 02 Model runner, 03 Model
      and 04 Ready, in small monospace capitals, each in a panel with corner ticks, in both the dark and
      the light theme.
- [ ] **Copy diagnostics.** On the failed runner step, choose **Copy diagnostics…**: a box opens below
      with the whole text, and the keyboard focus moves to it. Read it: Sage's version, "System:
      Windows" and its version, the CPU, "Setup step: 02 Model runner", "Support code: SAGE-RUN-01: …",
      "Brain: local", "Local model runner: didn't answer", the runner version, the chosen model, the
      voice status, the theme and reduced motion. Choose **Copy to clipboard**: it says "Copied."
      Open Notepad and paste: the text is exactly what the box showed. Check it holds no user name, no
      `C:\Users\…` path, no e-mail address, no key, no web address, and no note or reminder text (with
      an online key saved and a note added beforehand, for a real test). Nothing else happens: no
      browser opens and nothing is sent.
- [ ] **The install guide box.** Choose **Open the install guide**: Sage's own box asks *"Open Sage's
      install guide in your web browser?"*, with **Not now** selected. Choose **Not now**: nothing opens,
      and the screen says so. Choose it again, then **Open**: the web browser opens the "local model
      runner" part of `docs/installing.md` on GitHub, and nothing else opens.
- [ ] **Runner stopped, then started.** Start the runner again and choose **Check again**: the lines
      type out one after another ("Looking for the local model runner... found", "Runner version …...
      ok", then one line for each of Sage's two models, downloaded or not), the code, **Copy
      diagnostics…** and the box are gone, it says the local model runner is running, and **Next**
      works. Choose **Check again** and press a key while the lines type: all of them show at once.
- [ ] **Runner without the model.** Choose **Next**: the Standard model shows "Already downloaded." (from
      the setup at the top of this checklist) and its button says **Use this model**. Choose **Smaller**:
      the button says **Download**.
- [ ] **The download box.** Choose **Download**: Sage's box asks *"Download the Smaller model (about 1.4
      GB)?"*, says it needs an internet connection and free disk space, that the local model runner
      downloads and checks the files, and that Sage will then use it on this computer (the brain switches
      to On this computer), with **Not now** selected. **Not now**: it says the model wasn't
      downloaded, and nothing downloads.
- [ ] **Cancel.** **Download**, then **Download** in the box: a progress bar and "Downloading… N of M MB"
      appear within a second, with **Cancel**. Choose **Cancel**: it says "Cancelled." and offers **Try
      again**. (Whether the runner keeps the part it already has is up to the runner; note what you see.
      The model in Settings stays as it was; you can check it after the next steps.)
- [ ] **Offline.** **Try again**, then **Download**; once it is downloading, turn the network off. Within
      about 2 minutes Sage stops it with a plain message (that this PC may be offline, or "The download
      made no progress for 2 minutes…"), in Sage's plain words rather than a technical error from the
      runner, with the line "Model qwen3:1.7b... download failed", a support code (`SAGE-NET-01` or
      `SAGE-NET-02`) and **Copy diagnostics…**, and offers **Try again**. Look the code up in
      `docs/installing.md` (Troubleshooting → Support codes). Choose **Copy diagnostics…**: the box says
      "Setup step: 03 Model" and the same code. Turn the network back on.
- [ ] **A real download.** **Try again**, then **Download**: the progress goes up to the full size, then
      it says "The Smaller model is ready." with **Next**, the lines "Model qwen3:1.7b... ready" and
      "Skills... supported", no code, and no warning about skills. Choose **Next**: "04 Ready" lists
      "Model qwen3:1.7b... ready" and the voice ("Voice... not downloaded", or ready), and says Sage
      will think with the Smaller model (qwen3:1.7b) and how to talk to it.
      Choose **Start chatting**: the chat opens, the header shows "Brain: on this computer (qwen3:1.7b)",
      and a message gets a reply.
- [ ] **Already there.** **Settings → Set up Sage** → **On this computer** → **Next** → **Standard** →
      **Use this model**: no box and no download; it says the Standard model is ready. **Next**, then
      **Start chatting**: the header shows qwen3:4b again. (The Smaller model stays on your PC; remove it
      with the runner afterwards if you don't want to keep the 1.4 GB.)
- [ ] **Skip.** **Settings → Set up Sage**, then **Skip setup**: the chat opens and nothing in Settings
      changed. Close Sage and start it again: it opens on the chat.
- [ ] **An online service.** **Settings → Set up Sage** → **An online service (Claude, OpenAI, Gemini or
      another)**: Settings opens with the brain unchanged, the focus on *Claude*, and a line saying to
      choose one, save, then save its key. Leave "On this computer" picked and choose **Save settings**.
      Restart Sage: it opens on the chat.
- [ ] **From the online service back to local.** If you have an online service set up (see "The online
      key" above), save it with "Another online service", then **Settings → Set up Sage** → **On this
      computer** → **Next** → **Standard** → **Use this model**: it says the Standard model is ready, and
      after **Next** and **Start chatting** the header shows "Brain: on this computer (qwen3:4b)". In Settings, the
      online address and model are still there, and the key is still saved.
- [ ] **Reduced motion.** Turn on Windows Settings → Accessibility → Visual effects → Animation effects
      off, then **Settings → Set up Sage** → **On this computer**: all the check lines appear at once,
      with no typing and no blinking cursor. **Copy diagnostics…** on a failed step says "Reduced
      motion: on". Turn animation effects back on.
- [ ] **Keyboard only.** Unplug or ignore the mouse. **Settings → Set up Sage**, then Tab through every
      step: each button, including **Copy diagnostics…**, the diagnostics box and **Copy to clipboard**,
      shows a visible focus ring and works with Enter or Space; the text box can be scrolled with the
      arrow keys. With Narrator on, each set of check lines is read once, as a whole, and the support
      code with it.
- [ ] **Notices and the talk key.** Add a reminder for one minute from now, then **Settings → Set up
      Sage** and wait on the Welcome screen until it is due (with notifications turned off for Sage in
      Windows Settings → System → Notifications, it goes to the chat window instead): when you choose **Skip setup**, the reminder is in the chat. On the Welcome screen,
      Ctrl+Space does nothing.

## Voice

Run this section after a change to voice (the window's talk code, the speech helper, the download or the
speech engine, including a Renovate update of sherpa-onnx), and before any release. You need a
microphone. To start from scratch, close Sage and delete `%APPDATA%\sage-assistant\models` if it exists.

- [ ] Hold **Ctrl+Space**: the line under the chat says voice needs a one-time 44 MB speech file, with a
      **Download** button. No microphone prompt has appeared yet.
- [ ] Choose **Download**: Sage's own box asks *"Voice needs a 44 MB speech file from Hugging Face.
      Download it now?"*, with a line saying none of your speech or text is sent. Choose **Not now**:
      nothing is downloaded and **Download** is offered again.
- [ ] Choose **Download**, then **Download** in the box: a progress line with **Cancel** appears. Choose
      **Cancel**: it says the download was cancelled, offers **Try again**, and
      `%APPDATA%\sage-assistant\models` holds no files.
- [ ] Turn the network off (aeroplane mode), choose **Try again** and **Download**: a plain message says
      Sage couldn't reach Hugging Face, with **Try again**. Turn the network back on, choose **Try again**:
      it finishes with "Voice is ready", and `models\moonshine-tiny-en-quantized-2026-02-27` holds three
      files (about 13, 30 and 0.5 MB).
- [ ] Hold **Ctrl+Space** and say "remind me to call the dentist tomorrow": Windows may ask for the
      microphone the first time (allow it). The line shows "Listening…" with a counting timer, and the
      microphone icon appears in the taskbar while you hold. Let go: it shows "Working out what you
      said…", then the words appear in the message box and are **not** sent. The taskbar microphone
      icon disappears as soon as you let go.
- [ ] Type "Note:" in the box first, then talk again: the words go after "Note:" with a space.
- [ ] Press and hold the **Hold to talk** button with the mouse while you speak, then release: the words
      appear. Tab to the button, hold **Space** while you speak, and let go: the same.
- [ ] On the button, hold **Space**, press **Tab** while still holding, then let go: the microphone icon
      disappears as soon as you press Tab (not after 30 seconds), and the words appear.
- [ ] Send a question, and while Sage is answering, Tab to the button and hold **Enter** while you speak.
      Keep holding Enter after the reply appears: the words appear in the message box and are **not**
      sent. Let go of Enter, then press it again: now they are sent.
- [ ] Hold Ctrl+Space, let go, and press Ctrl+Space again at once while it says "Working out what you
      said…": it says it is still working, and only the first words appear. Talk again, let go and
      click **New chat** at once: the status line clears and no words appear.
- [ ] Type or paste almost 8,000 characters in the box, then talk: the words aren't added, the text is
      kept as it was, and Sage says they don't fit.
- [ ] Tap Ctrl+Space quickly: it says to hold the key while you speak, and nothing appears in the box.
- [ ] Hold Ctrl+Space and keep talking for over 30 seconds: it stops by itself at 0:30 and the words
      appear.
- [ ] Hold Ctrl+Space and click another window while still holding: the microphone icon disappears and
      Sage says it stopped listening. Hold it again and click **New chat** with the mouse: the same, and
      nothing appears in the box.
- [ ] Turn the network off. Hold Ctrl+Space and talk: the words still appear (voice works offline after
      the download). Turn the network back on.
- [ ] In Windows Settings → Privacy & security → Microphone, turn off **Let desktop apps access your
      microphone**. Hold Ctrl+Space: Sage says the microphone is blocked and where to allow it. Turn it
      back on.
- [ ] Send a message you spoke (you may edit it first): the reply is shown and read aloud with a Windows
      voice, and a **Stop speaking** button appears. Choose it: the speech stops and the button goes.
- [ ] Send a long voice message, and while the reply is read aloud press Ctrl+Space: the speech stops at
      once. Do it again and choose **New chat**: the speech stops.
- [ ] Send a typed message: the reply is not read aloud.
- [ ] Settings → **Read replies aloud** → **Always**, Save: a typed message's reply is read aloud.
      **Never**, Save: a spoken message's reply isn't. Back to **After voice messages**, Save: as before.
      Settings does not show a message saying this PC has no voice.
- [ ] With the network off, send a spoken message: the reply (if the brain is local) is read aloud
      offline. Turn the network back on.
- [ ] In Task Manager, while Sage works out a recording, a separate Sage process ("Sage speech") runs;
      Sage's window stays responsive.

## New look

- [ ] The window opens dark: a green-black ground with a faint grid, `SAGE` and a small leaf at the top
      left, and monospace capital labels. Open **Chat**: the orb above the message box says *READY* and
      breathes slowly. All text is easy to read.
- [ ] Settings → Look → Theme → *Light*: the window turns light at once, and the status line says the
      change isn't saved yet. Choose **Save settings**, close Sage and start it again: it opens light.
      Set *Match system*, save, and switch Windows between light and dark (Settings → Personalization →
      Colors): Sage follows. Set *Dark* again and save.
- [ ] Send a message: your row is labelled `YOU` in amber, Sage's `SAGE` in green; while the reply is on
      its way the orb's rings turn (*THINKING*), and the reply types itself out in about a second. Send
      a long question and click anywhere while the reply types: all of it shows at once.
- [ ] Hold Ctrl+Space (with the voice model downloaded): the orb pulses amber (*LISTENING*) until you
      let go. With Read replies aloud on *Always*, the orb pulses (*SPEAKING*) while the reply is read,
      and rests when it ends or you choose **Stop speaking**.
- [ ] Ask "Open Notepad" (Notepad on the app list): the system box asks as before, and behind it the
      chat shows an amber card, *Sage is asking: Open the app "Notepad" (…)*, with exactly the box's
      sentence. Choose **Allow**: the card says *ALLOWED*. Ask again and choose **Don't allow**: *NOT
      ALLOWED*. The card has nothing to click.
- [ ] **Sound** in the top bar is off (hollow dot) on a first start. Click it: a short blip, the dot
      lights, and sending plays a blip; the asking card plays a low tone and **Allow** two rising notes.
      Restart Sage: Sound is still on. Click it off: no sounds at all.
- [ ] Windows Settings → Accessibility → Visual effects → **Animation effects** off, then restart Sage:
      the orb stands still (its word still changes), and replies appear at once without typing. Turn
      Animation effects back on.
- [ ] Minimise Sage for a minute while the orb breathes: Task Manager shows Sage's CPU near zero.

## Home screen

Before you start: two reminders for later today and one for an earlier time today that Sage couldn't
show (or set one for a minute ahead and quit Sage before it is due), a reminder for a later day, and a
few notes. Ask Sage in Chat, for example "Remind me at 17:00 to call Sam".

- [ ] Start Sage: it opens on **Home**, and the tab bar reads **Home**, **Chat**, **Settings**, with Home
      underlined. The large orb says *READY*, the clock shows the time as the taskbar clock does (24-hour
      or AM/PM, as Windows is set), and the greeting fits the time of day (*Good morning* from 05:00,
      *Good afternoon* from 12:00, *Good evening* from 18:00).
- [ ] Watch the clock across a minute: it changes once, on the minute, with no seconds ticking.
- [ ] **Today** lists today's reminders with their times; a missed one is amber and marked *MISSED*.
      With more than five missed reminders, only the five newest are listed, then an amber row such as
      *2 MORE MISSED*, and today's reminders still to come are all still there (check this on a fresh
      test account, or in the preview page's sample data).
      **Notes** shows the titles of your five newest notes. **Status** shows the brain (*On this computer*
      or the company's name), whether voice is ready, whether sound is on, and the next reminder. Click
      **Sound** in the top bar: Status follows.
- [ ] Wait for a reminder to fire while Home is open: within a minute it is no longer the next one in
      Status.
- [ ] Empty states: on a fresh test account (or in the preview page, Home → *Empty*) Home shows
      *Nothing due today*, *No notes yet* and the next reminder as *None*. Don't delete real reminders
      or notes for this; on your own profile, skip this line.
- [ ] **Talk to Sage**: Chat opens with the cursor in the message box; type and press Enter.
- [ ] **Brief me** with Read replies aloud on *After voice messages*: the Brief panel appears and the
      brief types itself out ("Good morning. It's …", today's reminders, missed ones, your latest notes,
      "What would you like to start with?"), and is read aloud; the large orb says *SPEAKING*. The chat
      shows nothing new, and with an online brain nothing is sent (the brief works with the network
      unplugged). Repeat with *Always* (read aloud) and *Never* (not read aloud).
- [ ] While the brief is read aloud, a **Stop speaking** button shows in the Brief panel: press it (with
      the mouse, then once more with Tab and Enter): the speech stops and the button goes. It never
      shows while a reply is read. Brief me again and click **Chat** while it speaks: the speech stops.
      Brief me again and minimise Sage: it stops too.
- [ ] With missed reminders that Sage left out (see above), the brief says "You missed: …; and N more."
- [ ] Settings → Home → **Brief me when Sage first opens each day** on, *Save settings*. Set Read replies
      aloud to *Always* and save. Close Sage, then set the PC's date to tomorrow (Settings → Time &
      language → Date & time, automatic time off) and start Sage: Home shows the brief and reads it
      aloud. Close and start Sage again: no brief. Set *After voice messages*, set the date one more day
      ahead and start Sage: the brief shows but isn't read aloud. Set the date back one day and start
      Sage: no brief; set it forward again to the day of the last brief: still no brief. Turn the setting
      off, move the date ahead again: no brief. Set the date and time back to automatic.
- [ ] Change the time zone (Settings → Time & language → Date & time, set time zone automatically off)
      while Home is open: within a minute the clock shows the new zone's time, as the taskbar clock
      does. Set the time zone back.
- [ ] Animation effects off (Accessibility → Visual effects) and restart Sage: on Home the orb stands
      still, the clock still changes on the minute, and **Brief me** shows the brief at once.
- [ ] Keyboard only: Tab reaches the **Home**, **Chat** and **Settings** tabs, **Sound**, **Talk to
      Sage**, **Brief me** and, while the brief is read, **Stop speaking**, each with a visible focus ring; Enter or Space works on each. Narrator
      reads each panel's name and its rows.

## The window

- [ ] Drag a file from Explorer onto the chat: the window does not navigate to the file.
- [ ] Press Ctrl+R and F5: the page doesn't change, and the chat still works.
- [ ] In Task Manager, Sage runs as Electron processes and nothing else of Sage's keeps running after you
      close the window.

## Installed app

Run this section after a change to the installer settings (`electron-builder.json`), the fuses, or the
release workflow, and before any release. It takes about 10 minutes. Electron's security switches
(fuses) are set by the installer build, so this section also checks the app still starts with them.

Before you start: close Sage if it's open. Make sure the source copy has at least one saved note (the
earlier sections delete the Shopping note and replace `notes.json`, so if needed, start the source copy,
add a quick note, then close Sage).

`npm ci` installs the exact versions of everything needed to build (run it in the source folder if you
haven't since the last update). The first `npm run dist` downloads a few hundred MB, so it takes longer.

- [ ] In PowerShell, in the source folder, `npm run dist` ends without errors and writes
      `out\Sage-Setup-<version>.exe` (the version in `package.json`), and no `.blockmap` file next to it.
- [ ] Run the installer: SmartScreen may warn (**More info**, then **Run anyway**). It installs without
      asking for admin rights and starts Sage.
- [ ] The installer, `Sage.exe` and the shortcuts show the leaf icon (white leaf on a green tile), not
      Electron's default. Windows may keep showing an old shortcut icon until you sign out and in (or
      uninstall the test copy first).
- [ ] The Start menu has **Sage**, and so does the desktop. Close Sage and start it from each shortcut:
      it opens.
- [ ] The taskbar button and the window show the leaf icon.
- [ ] The window is titled "Sage" and looks the same as from source (styled, not plain black text on
      white). Ask "What can you do?": a reply comes back. **Settings** opens, and the chat comes back.
- [ ] "What notes do I have?" lists the note made in the source copy (both use
      `%APPDATA%\sage-assistant`).
- [ ] "Remind me to stretch in two minutes": a Windows notification titled "Sage reminder" says
      "stretch". In Settings → System → Notifications, the sender is listed as **Sage**.
- [ ] Starting Sage again from the Start menu while it is open brings the window forward.
- [ ] Voice in the installed app: hold Ctrl+Space and speak (the speech file downloaded from source is
      shared, so no download is asked for): the words appear in the message box, so the speech engine
      loads from the installed app. Its native files (`sherpa-onnx.node` and its `.dll` files) are in
      the install folder under `resources\app.asar.unpacked\node_modules\sherpa-onnx-win-x64` (to find
      the install folder, right-click Sage in the Start menu and choose **Open file location**,
      right-click the Sage shortcut there, choose **Properties**, then **Open File Location**).
- [ ] Close Sage. Open `package.json` in Notepad, change `"version": "0.1.0"` to `"version": "0.1.1"`
      and save (don't commit it). Run `npm run dist` again, and run the new installer over the installed app: it replaces it, Sage starts,
      and the note is still there. Then put `package.json` back with `git checkout package.json`.
- [ ] Close Sage. Uninstall it in Settings → Apps → Installed apps (Windows 10: Apps & features): the shortcuts are gone, and
      `%APPDATA%\sage-assistant` still holds `notes.json` and `settings.json`. `npm start` from the source
      folder still opens Sage with the note.
