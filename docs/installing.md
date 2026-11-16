# Installing

There are two ways to get Sage:

- **On Windows, the installer** from the GitHub Releases page: see
  [Installing on Windows](#installing-on-windows). You still need the local model runner for the local
  brain (step 1 below), or an online model service.
- **From the source code**, on Windows and Linux: steps 1 to 4 below.

Both share the same data folder, so notes, reminders, settings and the key you made in a copy run from
source are there in the installed app too.

## Installing on Windows

1. **Download** from the repository's
   [Releases page](https://github.com/HoneyBearTech/sage-assistant/releases): under the newest release,
   choose `Sage-Setup-<version>.exe` and `SHA256SUMS.txt`. Download only from this page.
2. **Check the checksum** before you run it. In PowerShell (see
   [Opening PowerShell](#opening-powershell-or-a-terminal)), in your Downloads folder, with the version
   you downloaded:

   ```powershell
   cd $HOME\Downloads
   (Get-FileHash .\Sage-Setup-0.2.0.exe -Algorithm SHA256).Hash -eq (-split (Get-Content .\SHA256SUMS.txt))[0]
   ```

   It must print `True`. If it prints `False`, don't run the file: download both again. How to check
   that GitHub built the file (its provenance) is in [releasing.md](releasing.md#checking-a-downloaded-installer).
3. **Run the installer.** The installer isn't code-signed yet (that is planned, see the
   [roadmap](roadmap.md)), so Windows SmartScreen may say *"Windows protected your PC"*. Choose
   **More info**, check the file name is `Sage-Setup-<version>.exe`, then choose **Run anyway**. Do this
   only for a file from the Releases page whose checksum matched.
4. It installs for your Windows account only, without asking for admin rights, adds **Sage** to the Start
   menu and the desktop, and starts Sage.
5. **Install the local model runner and a model**, as in [step 1 below](#local-model-runner), unless
   you use only an online model service.
6. **Set it up** as in [step 4](#4-set-it-up).

**Updating:** download the newer installer from the Releases page, check it the same way, and run it.
It replaces the old version; your data stays.

**Uninstalling:** **Settings → Apps → Installed apps** (on Windows 10, **Settings → Apps → Apps &
features**), find **Sage**, and choose **Uninstall**. Your notes, reminders, settings, action log, key and
speech file stay in `%APPDATA%\sage-assistant`; delete that folder too to remove them.

## What you need (from source)

| What | Size | Why |
| --- | --- | --- |
| [Node.js 24](https://nodejs.org) and npm | about 100 MB | Builds and starts Sage. |
| git | small | Downloads the source. |
| Sage's dependencies | a few hundred MB | Downloaded by `npm install`. |
| Electron's runtime | about 100 MB | Downloaded on the first `npm start`, not by `npm install`. |
| [Ollama](https://ollama.com) and a model | 1.5 to 3 GB for a small model | The local brain. Not needed if you only use an online model service. |
| The speech file | 44 MB | Voice. Downloaded once, the first time you use voice, only after Sage asks. |

A PC with 8 GB of memory runs a small local model; 16 GB is more comfortable.

### Opening PowerShell or a terminal

The steps below type commands into a command window:

- **Windows:** open the Start menu, type `PowerShell`, and choose **Windows PowerShell** (or **Terminal**
  on Windows 11). Type each command and press Enter. To paste a command, right-click in the window.
- **Linux:** open your desktop's **Terminal** app (often Ctrl+Alt+T). To paste, use Ctrl+Shift+V.

Wait for each command to finish (the prompt comes back) before typing the next one.

<a id="local-model-runner"></a>

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
If Sage says "Sage can't reach the local model runner. Start it, or open Settings → Set up Sage for help,
then try again.", start the runner and try again.

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
3. Choose **Save settings**.
4. Paste your key into **Online service key** and choose **Save key**. Sage encrypts it with your system's
   protection and never shows it again. **Remove key** deletes it.

Save the address before the key. If the address on screen isn't the one saved yet, Sage doesn't save
the key and says "Save settings first, then save the key." This way a key is always tied to the
service you typed it for.

If you later change the address to a different service (a different host or port), Sage removes the
saved key when you save, so a key is never sent to a service it wasn't entered for. Paste the new
service's key and choose **Save key** again. A key you save while no address is saved and the address
box is empty belongs to the first address you save. If Sage is answering while you change the brain or the service, that answer stops;
ask again.

With an online brain, everything you type, and what Sage reads for you during the conversation (search
results, notes), is sent to that service.

## Voice and the microphone

Hold **Ctrl+Space** while Sage's window is in front (the active window), or press and hold **Hold to talk**, speak, and let go.
The words go into the message box; press Enter to send them.

- **The first time**, Sage asks *"Voice needs a 44 MB speech file from Hugging Face. Download it now?"*.
  Choose **Download**. None of your speech or text is sent: it is an ordinary file download, so Hugging
  Face sees a request from your PC, as with any website. A line under the chat shows the progress, with **Cancel**; if it fails or the PC
  is offline, it says so and offers **Try again**. Once the file is there, voice works without the
  internet. It is kept in Sage's data folder, in `models/`.
- **Windows asks for the microphone** the first time, or may have it turned off. If Sage says the
  microphone is blocked, open **Settings → Privacy & security → Microphone** (Windows 10: **Settings →
  Privacy → Microphone**) and turn on **Microphone access** and **Let desktop apps access your
  microphone**. Then try again. If Sage can't find a microphone, plug one in or check
  **Settings → System → Sound → Input**.
- **Spoken replies** use the voices that come with Windows (**Settings → Time & language → Speech**
  lists them). On Linux they come from the system's speech service (for example the `speech-dispatcher`
  package); without one, Settings says there is no voice and replies stay as text. Change when replies
  are read aloud in Settings → **Read replies aloud**.

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

The installed app: run the newer installer, as in [Installing on Windows](#installing-on-windows).

A copy run from source, from the `sage-assistant` folder:

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

The installed app: uninstall it from Windows Settings, as in
[Installing on Windows](#installing-on-windows); your data stays.

A copy run from source: delete the `sage-assistant` source folder.

Either way, to remove your data too, delete the data folder above. To remove the local brain, uninstall
the local model runner (its models are in its own folder).

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "Sage can't reach the local model runner. Start it, or open Settings → Set up Sage for help, then try again." | Start the local model runner. On Windows, open it from the Start menu; on Linux, check its service, or start it from a terminal (see [step 1](#local-model-runner)). **Settings → Set up Sage** checks it for you. |
| "The local model "…" isn't downloaded yet." | Open **Settings → Set up Sage** and download one of Sage's two models; or download the model with the local model runner's own command (see [step 1](#local-model-runner)), or change Settings → Local model to one the runner has. |
| "The online service didn't accept the key." | Save the key again in Settings, and check it with the service. |
| "Search is unavailable right now." | The search page didn't answer or blocked the request. Try again later. |
| "Sage can't use the microphone because it's blocked." | Allow it in Windows's microphone settings; see [Voice and the microphone](#voice-and-the-microphone). |
| "Sage couldn't reach Hugging Face to download the speech file." | Check the PC is online, then choose **Try again**. |
| "The downloaded speech file wasn't the one Sage expected…" | The file didn't match its fingerprint and was deleted. Try again later; if it keeps happening, report it as an issue. |
| "The speech file on this PC was damaged or changed, so Sage deleted it." | Sage checks the file before first use in each run. Choose **Download** to get it again. |
| "The download of the speech file stopped making progress…" | Nothing arrived for 30 seconds. Check the PC is online, then choose **Try again**. |
| The window doesn't open on Linux | See [the sandbox note](#linux-notes). |
| `npm install` fails | Check `node --version` shows v24, then delete `node_modules` and run `npm install` again. |
