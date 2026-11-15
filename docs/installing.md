# Installing

For now Sage runs from its source code, on Windows and on Linux. A one-click Windows installer is the
next job (see [the future installer](#the-future-windows-installer) below).

## What you need

| What | Size | Why |
| --- | --- | --- |
| [Node.js 24](https://nodejs.org) and npm | about 100 MB | Builds and starts Sage. |
| git | small | Downloads the source. |
| Sage's dependencies and Electron's runtime | a few hundred MB | Downloaded by `npm install` and on the first `npm start`. |
| [Ollama](https://ollama.com) and a model | 1.5 to 3 GB for a small model | The local brain. Not needed if you only use an online model service. |

A PC with 8 GB of memory runs a small local model; 16 GB is more comfortable.

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

`npm start` builds Sage into `dist/` and opens its window. The first time, it also downloads Electron's
runtime (about 100 MB); this is checked against the checksums that come with Electron's package.

## 4. Set it up

Open **Settings** in Sage's window:

- **Apps Sage may open:** add each app by a name you'll use ("Notepad") and the full path to its program
  (`C:\Windows\System32\notepad.exe`; on Linux, for example, `/usr/bin/gedit`). **Browse…** opens a file
  picker. On Windows only `.exe` files work. Sage can only open apps on this list, and asks you first
  every time.
- **Folders Sage may open files from:** add the folders you're happy for Sage to open files from, such as
  your Documents folder. Sage can only open files inside them (not programs or shortcuts), and asks you
  first every time.
- Choose **Save settings**.

### The online brain (optional)

If you'd rather use an online model service that offers the chat-completions format:

1. In Settings, choose **An online model service**.
2. Enter the service's address (for example `https://api.example.com`; Sage adds `/v1/chat/completions`)
   and the model name the service gives you.
3. Paste your key into **Online service key** and choose **Save key**. Sage encrypts it with your system's
   protection and never shows it again. **Remove key** deletes it.
4. Choose **Save settings**.

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
- **Notifications** need a notification service, which every common desktop has.

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
