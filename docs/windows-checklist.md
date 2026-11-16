# Windows checklist

Short manual checks for a Windows 10 or 11 PC, for the parts the automated tests can't reach (the real
window, the native confirmation box, notifications and the key encryption). Run them after a change to
the window, the skills or the key store, and before any release. It takes about 15 minutes, and the
[Installed app](#installed-app) section about 10 more.

Before you start: Ollama is installed and `ollama pull qwen3:4b` has finished (see
[installing.md](installing.md)), and Sage's source is up to date (`git pull`, `npm install`).

## Start

- [ ] `npm run verify` passes in PowerShell.
- [ ] `npm start` opens Sage's window, titled "Sage", with no errors in the terminal.
- [ ] Starting a second copy (`npm start` in another PowerShell window) brings the first window forward
      instead of opening another.
- [ ] The header shows "Brain: on this computer (qwen3:4b)".

## Chat and the local brain

- [ ] Ask "What can you do?" and get a sensible reply.
- [ ] Quit Ollama (its icon by the clock → Quit), send a message: the reply is "Sage can't reach the local
      model runner. Is Ollama running?". Start Ollama again; the next message works.
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

- [ ] In Settings, choose the online brain, enter an address and model, paste a test key, and choose
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
- [ ] The Start menu has **Sage**, and so does the desktop. Close Sage and start it from each shortcut:
      it opens.
- [ ] The window is titled "Sage" and looks the same as from source (styled, not plain black text on
      white). Ask "What can you do?": a reply comes back. **Settings** opens, and the chat comes back.
- [ ] "What notes do I have?" lists the note made in the source copy (both use
      `%APPDATA%\sage-assistant`).
- [ ] "Remind me to stretch in two minutes": a Windows notification titled "Sage reminder" says
      "stretch". In Settings → System → Notifications, the sender is listed as **Sage**.
- [ ] Starting Sage again from the Start menu while it is open brings the window forward.
- [ ] Close Sage. Open `package.json` in Notepad, change `"version": "0.1.0"` to `"version": "0.1.1"`
      and save (don't commit it). Run `npm run dist` again, and run the new installer over the installed app: it replaces it, Sage starts,
      and the note is still there. Then put `package.json` back with `git checkout package.json`.
- [ ] Close Sage. Uninstall it in Settings → Apps → Installed apps (Windows 10: Apps & features): the shortcuts are gone, and
      `%APPDATA%\sage-assistant` still holds `notes.json` and `settings.json`. `npm start` from the source
      folder still opens Sage with the note.
