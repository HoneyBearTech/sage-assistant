# Sage

**S.A.G.E.** (System for Assistance, Guidance & Execution), "Sage" for short, is a desktop assistant
that runs on your own computer. You chat with it in its own window. It can search the web, keep notes
and reminders, and open the apps and files you allow, and it **always asks you first** before it opens
anything or deletes anything.

Its "brain" (the model that understands you and writes the replies) is your choice:

- **On this computer** (the default): a model run by [Ollama](https://ollama.com) on the same PC.
  Nothing you type leaves your computer, apart from the web searches you ask for.
- **An online model service**: any service that offers the widely used chat-completions format, with
  your own key. The key is encrypted with your operating system's protection.

> [!NOTE]
> Sage has a text chat and voice (hold a key to talk), with a one-click Windows installer; it also runs
> from source on Windows and Linux. A first-run setup comes next; see the [roadmap](docs/roadmap.md).

## Install it on Windows

Download `Sage-Setup-<version>.exe` and `SHA256SUMS.txt` from the
[Releases page](https://github.com/HoneyBearTech/sage-assistant/releases), check the checksum, and run
the installer. It installs for your account only, without admin rights, and adds Sage to the Start menu
and the desktop. It isn't code-signed yet, so SmartScreen may warn: choose **More info**, then **Run
anyway**, only for a file from the Releases page whose checksum matched. For the local brain you also
need the local model runner and a model (see below). Step by step, with updating and uninstalling:
[docs/installing.md](docs/installing.md#installing-on-windows).

## What Sage can do

| Skill | What it does | Asks first? |
| --- | --- | --- |
| Answer | Replies in plain words | No |
| Web search | Searches the web (DuckDuckGo, no key needed) and reads the results | No |
| Notes | Lists, reads and adds notes | No |
| Reminders | Lists and adds reminders; a desktop notification pops up when one is due, or a message in Sage's window if notifications don't work (while Sage is open; one missed while it was closed pops up when it next starts) | No |
| Open an app | Opens an app **from the list you set up** in Settings | **Yes, every time** |
| Open a file | Opens a document, picture, sound or video file **inside a folder you approved** in Settings, with its default app (never programs, scripts or shortcuts) | **Yes, every time** |
| Delete a note or reminder | Deletes it | **Yes, every time** |

The confirmation box says exactly what will happen, for example *Open the app "Notepad"
(C:\Windows\System32\notepad.exe)*, and nothing happens unless you choose **Allow**. Only you can
answer it: the model can't, and there is no "always allow" switch. Sage has no skill that runs
commands, and text from web pages or notes can't start a skill on its own. Every action you allow or
decline is written to a local log. How this works, and what it protects against, is in the
[assurance case](docs/assurance-case.md).

Sage sends no telemetry, analytics or crash reports, and has no account.

## Voice

Hold **Ctrl+Space** while Sage's window is focused, or press and hold the **Hold to talk** button, and
speak. Let go when you're done (at most 30 seconds). Sage works out what you said **on your PC**, with
the [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) speech engine and the Moonshine tiny English
model, and puts the words **in the message box**. Nothing is sent until you check it and press Enter.

- **A one-time download.** The first time you use voice, Sage asks: *"Voice needs a 44 MB speech file
  from Hugging Face. Download it now?"* Only if you choose **Download** does it fetch the model's three
  files, from fixed addresses pinned to one exact version, and it uses them only if each file's size and
  SHA-256 fingerprint match. After that, voice works offline. **This is the only thing Sage downloads by
  itself**, and nothing is sent: it is a plain file download.
- **The microphone is on only while you hold** the key or the button. It also turns off if Sage's window
  loses focus or you start a **New chat**. The sound stays in memory and is never saved or logged, and
  neither are the words, beyond what happens to typed messages.
- **Spoken replies.** Sage can read its replies aloud with a voice installed on your PC (Windows comes
  with some; on Linux you may need the system's speech service). Settings → **Read replies aloud**:
  *After voice messages* (the default), *Always* or *Never*. **Stop speaking**, the talk key and
  **New chat** stop it.
- If Windows blocks the microphone, allow it in **Settings → Privacy & security → Microphone** (see
  [installing.md](docs/installing.md#voice-and-the-microphone)).

## Run it from source

You need:

- **Node.js 24** and npm ([nodejs.org](https://nodejs.org), or a version manager such as `fnm`).
- **git**.
- **Ollama**, for the local brain ([ollama.com/download](https://ollama.com/download)), and a model
  that can use tools. Sage's default is `qwen3:4b` (about 2.5 GB):

  ```sh
  ollama pull qwen3:4b
  ```

Then, on **Windows** (PowerShell) or **Linux** (a terminal), the same commands:

```sh
git clone https://github.com/HoneyBearTech/sage-assistant.git
cd sage-assistant
npm install
npm start
```

The first `npm start` downloads Electron's runtime (about 100 MB) once. The full guide, including the
Linux keyring and sandbox notes and how to update, is in [docs/installing.md](docs/installing.md).

## How the brain switch works

Open **Settings** in Sage's window:

- **Brain** picks where Sage thinks: *On this computer (Ollama)* or *An online model service*. The
  switch takes effect with your next message.
- **Local model** is the Ollama model name (default `qwen3:4b`). Sage only ever talks to Ollama at
  `127.0.0.1:11434`, on the same computer; that address can't be changed. If Ollama isn't running,
  Sage says so in plain words ("Sage can't reach the local model runner. Is Ollama running?").
- **Online service address**, **Online model name** and **Online service key** set up the online
  brain. Sage sends `POST <address>/v1/chat/completions` with the key as a bearer token. The address
  must start with `https://` (plain `http://` is accepted only for `127.0.0.1` or `localhost`, for a
  model server on your own PC). The key is encrypted by your system and stored on its own. It is never
  written to the settings file, the logs, the action log or the chat, and it is never shown again
  after you save it.

## Where Sage keeps its data

Everything lives in Sage's folder in your user profile (Electron's `userData` folder):
`%APPDATA%\sage-assistant` on Windows and `~/.config/sage-assistant` on Linux.

| File | What's in it |
| --- | --- |
| `settings.json` | The brain switch, model names, the online address, your app list and approved folders. No key. |
| `online-key.bin` | The online key, encrypted with your system's protection. |
| `notes.json`, `reminders.json` | Your notes and reminders. |
| `action-log.jsonl` | One line for every action you allowed or declined. |
| `models/` | The speech file for voice (44 MB), once you've downloaded it. |

## Developing

`npm run verify` runs every check: Biome lint and format, the TypeScript typecheck, the tests with an
80% line-coverage floor, the public-repo checker and a secret scan (skipped with a message if gitleaks
isn't installed). On GitHub, every pull request also gets CI (the same command on Ubuntu and Windows),
the DCO check, a secret scan, CodeQL and dependency review, and the OpenSSF Scorecard runs on `main`
(see [docs/github-checks.md](docs/github-checks.md)). Renovate opens the dependency update pull
requests. See [CONTRIBUTING.md](CONTRIBUTING.md) for the details.

`npm run dist` builds the Windows installer into `out/` (on Windows only), and `npm run dist:dir` the
unpacked app (also on Linux). Releases are built on GitHub from a version tag, with a checksum and build
provenance; see [docs/releasing.md](docs/releasing.md).

## Documentation

The [docs index](docs/README.md) lists everything: how Sage works, the security case, installing, the
Windows checklist, releasing and the roadmap.

## Security and support

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). For help, see
[SUPPORT.md](SUPPORT.md).

## License

[MIT](LICENSE), copyright HoneyBearTech.
