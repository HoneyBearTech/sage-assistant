# Installing

For now Sage runs from its source code, on Windows and on Linux. A one-click Windows installer is the
next job (see [the future installer](#the-future-windows-installer) below).

## What you need

| What | Size | Why |
| --- | --- | --- |
| [Node.js 24](https://nodejs.org) and npm | about 100 MB | Builds and starts Sage. |
| git | small | Downloads the source. |
| Sage's dependencies | a few hundred MB | Downloaded by `npm install`. |
| Electron's runtime | about 100 MB | Downloaded on the first `npm start`, not by `npm install`. |
| [Ollama](https://ollama.com) and a model | 1.5 to 3 GB for a small model | The local brain. Not needed if you only use an online model service. |

A PC with 8 GB of memory runs a small local model; 16 GB is more comfortable.

### Opening PowerShell or a terminal

The steps below type commands into a command window:

- **Windows:** open the Start menu, type `PowerShell`, and choose **Windows PowerShell** (or **Terminal**
  on Windows 11). Type each command and press Enter. To paste a command, right-click in the window.
- **Linux:** open your desktop's **Terminal** app (often Ctrl+Alt+T). To paste, use Ctrl+Shift+V.

Wait for each command to finish (the prompt comes back) before typing the next one.

## 1. Install Ollama and a small model

**Windows:** download and run the installer from [ollama.com/download](https://ollama.com/download). It
starts Ollama in the background (look for its icon by the clock).

**Linux:** follow the instructions on [ollama.com/download](https://ollama.com/download) for your
distribution. Their install script sets Ollama up as a service; read it before you run it.

Then download a model that can use tools. In PowerShell or a terminal:

```sh
ollama pull qwen3:4b
```

`qwen3:4b` is Sage's default (about 2.5 GB). On a PC with less memory, `qwen3:1.7b` (about 1.4 GB) is
smaller and faster, but makes more mistakes; put its name in Settings → Local model. Check that it is
there with `ollama list`.

Sage talks to Ollama only at `127.0.0.1:11434`, on the same computer, which is Ollama's standard address.
If Sage says "Sage can't reach the local model runner. Is Ollama running?", start Ollama and try again.

## 2. Install Node.js 24 and git

**Windows:** install Node.js 24 from [nodejs.org](https://nodejs.org) (pick a 24.x version) and git from
[git-scm.com](https://git-scm.com). Or, with a version manager such as `fnm`: `fnm install 24` and
`fnm use 24`.

**Linux:** install git from your distribution, and Node.js 24 from [nodejs.org](https://nodejs.org) or
with `fnm install 24 && fnm use 24`.

Check with `node --version` (it should start with `v24`).

## 3. Get Sage and start it

The same commands on Windows (PowerShell) and Linux:

```sh
git clone https://github.com/HoneyBearTech/sage-assistant.git
cd sage-assistant
npm install
npm start
```

`git clone` makes a `sage-assistant` folder inside the folder the window is in (on Windows, usually your
user folder), and `cd sage-assistant` moves into it. `npm install` downloads Sage's dependencies; it
takes a minute or two and may print warnings, which are normal unless it ends with an error.

`npm start` builds Sage into `dist/` and opens its window. **The first start takes a while**, from a
minute to several on a slow connection, because it also downloads Electron's runtime (about 100 MB),
checked against the checksums that come with Electron's package. Later starts take a few seconds. Leave
the command window open while you use Sage: closing it closes Sage. To start Sage again later, open
PowerShell or a terminal, `cd sage-assistant`, and run `npm start`.

## 4. Set it up

Open **Settings** in Sage's window:

- **Apps Sage may open:** add each app by a name you'll use ("Notepad") and the full path to its program
  (`C:\Windows\System32\notepad.exe`; on Linux, for example, `/usr/bin/gedit`). Type the name, then
  either type the path or choose **Browse…**: it opens your system's file picker, and the program you
  pick fills in the path box. Then choose **Add**. On Windows only `.exe` files work; to find an app's
  program, right-click its Start menu entry, choose **Open file location**, then right-click the shortcut
  and choose **Properties** to see its target. Sage can only open apps on this list, and asks you first
  every time.
- **Folders Sage may open files from:** choose **Browse…** to pick a folder, such as your Documents
  folder, or type its full path, then choose **Add**. Sage can only open documents, pictures, music and
  video files inside these folders (not programs, scripts or shortcuts), and asks you first every time.
- Choose **Save settings**. Adding or removing an app or folder only takes effect after you save; you can
  switch to the chat and back without losing unsaved changes.

### The online brain (optional)

If you'd rather use an online model service that offers the chat-completions format:

1. In Settings, choose **An online model service**.
2. Enter the service's address (for example `https://api.example.com`; Sage adds `/v1/chat/completions`)
   and the model name the service gives you.
3. Paste your key into **Online service key** and choose **Save key**. Sage encrypts it with your system's
   protection and never shows it again. **Remove key** deletes it.
4. Choose **Save settings**.

If you later change the address to a different service (a different host or port), Sage removes the
saved key when you save, so a key is never sent to a service it wasn't entered for. Paste the new
service's key and choose **Save key** again.

With an online brain, everything you type, and what Sage reads for you during the conversation (search
results, notes), is sent to that service.

## Linux notes

- **Keyring.** On Linux, the key is encrypted with your desktop keyring (GNOME Keyring or KWallet). If no
  keyring is running and unlocked, Sage refuses to save the key rather than store it unprotected. Log in
  to a desktop session with a keyring, or use the local brain.
- **Sandbox.** Sage's window always runs in Chromium's sandbox. On some distributions (for example recent
  Ubuntu releases, which restrict unprivileged user namespaces), `npm start` can stop with *"The SUID
  sandbox helper binary was found, but is not configured correctly"*. Make Electron's sandbox helper
  owned by root and setuid, from the `sage-assistant` folder:

  ```sh
  sudo chown root:root node_modules/electron/dist/chrome-sandbox
  sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
  ```

  Do this again after reinstalling dependencies. Never start Sage with `--no-sandbox`.
- **Notifications** need a notification service, which every common desktop has. If a reminder can't be
  shown as a desktop notification, it appears in Sage's chat window instead.

## Updating

From the `sage-assistant` folder:

```sh
git pull
npm install
npm start
```

Your settings, notes, reminders, action log and key are in Sage's data folder, not in the source folder,
so they carry over.

## Where your data is

`%APPDATA%\sage-assistant` on Windows and `~/.config/sage-assistant` on Linux. See
[architecture.md](architecture.md#where-data-is-kept) for each file.

## Uninstalling

Delete the `sage-assistant` source folder. To remove your data too, delete the data folder above. To
remove the local brain, uninstall Ollama (its models are in its own folder).

## The future Windows installer

The next job adds a one-click Windows installer. Until it is signed with a code-signing certificate
(planned later, see the [roadmap](roadmap.md)), Windows SmartScreen will warn *"Windows protected your
PC"* the first time you run it, because the installer is new and unsigned. Only continue (**More info**,
then **Run anyway**) if you downloaded it from this repository's GitHub Releases page and its checksum
matches the one published with the release. The installer job will document both steps.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "Sage can't reach the local model runner. Is Ollama running?" | Start Ollama. On Windows, open it from the Start menu; on Linux, `systemctl status ollama` or `ollama serve`. |
| "The local model "…" isn't downloaded yet." | Run the `ollama pull` command it shows, or change Settings → Local model to one from `ollama list`. |
| "The online service didn't accept the key." | Save the key again in Settings, and check it with the service. |
| "Search is unavailable right now." | The search page didn't answer or blocked the request. Try again later. |
| The window doesn't open on Linux | See [the sandbox note](#linux-notes). |
| `npm install` fails | Check `node --version` shows v24, then delete `node_modules` and run `npm install` again. |
