<img src="build/icon.png" alt="The Sage icon: a white leaf on a green tile" width="96" align="right">

# Sage

**S.A.G.E.** (System for Assistance, Guidance & Execution), "Sage" for short, is a desktop assistant
that runs on your own computer. You chat with it in its own window. It can search the web, keep notes
and reminders, and open the apps and files you allow, and it **always asks you first** before it opens
anything or deletes anything.

Its "brain" (the model that understands you and writes the replies) is your choice:

- **On this computer** (the default): a model run by [Ollama](https://ollama.com) on the same PC. With
  this brain, and only with this one, nothing you type leaves your computer, apart from the web
  searches you ask for.
- **Claude**, **OpenAI** or **Gemini**, with your own key from Anthropic, OpenAI or Google AI Studio.
- **Another online service**: any service that offers the widely used chat-completions format, with your
  own key.

With an online brain, what you type and the results of Sage's skills (for example the list of notes, or
the web results it found) are sent to that company with each message: to Anthropic for Claude, to OpenAI
for OpenAI, to Google for Gemini, and to the service at the address you entered for another online
service. Keys are encrypted with your operating system's protection, each one is sent only to its own
company's address, and Sage still asks you first before it opens or deletes anything, whichever brain
you use.

> [!IMPORTANT]
> **Online brains cost money.** Keys from Anthropic and OpenAI are paid per use, separately from any
> subscription you have; Google has a free tier for some Gemini models, and charges beyond it. **Sage
> can't cap what you spend**, so set a spending limit on each company's own website (Anthropic Console,
> the OpenAI platform and Google AI Studio).

> [!NOTE]
> Sage has a text chat, voice (hold a key to talk) and a Welcome screen that sets it up on first start,
> with a one-click Windows installer; it also runs from source on Windows and Linux. What comes next is
> in the [roadmap](docs/roadmap.md).

## Install it on Windows

Download `Sage-Setup-<version>.exe` and `SHA256SUMS.txt` from the
[Releases page](https://github.com/HoneyBearTech/sage-assistant/releases), check the checksum, and run
the installer. It installs for your account only, without admin rights, and adds Sage to the Start menu
and the desktop. It isn't code-signed yet, so SmartScreen may warn: choose **More info**, then **Run
anyway**, only for a file from the Releases page whose checksum matched. For the local brain you also
need the local model runner; Sage's Welcome screen checks it and downloads a model for you (see
[First start](#first-start)). Step by step, with updating and uninstalling:
[docs/installing.md](docs/installing.md#installing-on-windows).

## First start

The first time Sage starts, a **Welcome screen** sets it up step by step: where Sage thinks (on this
computer, or an online service: Claude, OpenAI, Gemini or another, chosen in Settings), whether the local model runner is running (with short install steps
and, after asking, a button that opens Sage's [install guide](docs/installing.md#local-model-runner) in
your web browser), and a model: **Standard** (`qwen3:4b`, about 2.5 GB) or **Smaller** (`qwen3:1.7b`,
about 1.4 GB, for PCs with less memory). Sage asks in its own box before the download; the local model
runner downloads the model and checks its files, with progress and **Cancel**, and Sage then thinks on
this computer with it (Sage switches to **On this computer**, even if you were using an online service). **Skip
setup** is always there, and **Settings → Set up Sage** brings the screen back.

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

While the box is open, Sage's chat shows the same question in an amber card, and afterwards whether you
allowed it. The card is only a reminder: you answer in the box.

Sage sends no telemetry, analytics or crash reports, and has no account.

## The look

Sage's window is dark by default, a calm heads-up display in green, with an orb above the message box
that shows when Sage is listening, thinking or speaking. **Settings → Look → Theme** switches to
*Light* or *Match system*. **Sound** in the top bar turns on short sound effects (off until you do).
With your system's "reduce motion" setting on, nothing in the window moves.

## Voice

Hold **Ctrl+Space** while Sage's window is in front (the active window), or press and hold the **Hold to talk** button, and
speak. Let go when you're done (at most 30 seconds). Sage works out what you said **on your PC**, with
the [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) speech engine and the Moonshine tiny English
model, and puts the words **in the message box**. Nothing is sent until you check it and press Enter.

- **A one-time download.** The first time you use voice, Sage asks: *"Voice needs a 44 MB speech file
  from Hugging Face. Download it now?"* Only if you choose **Download** does it fetch the model's three
  files, from fixed addresses pinned to one exact version, and it uses them only if each file's size and
  SHA-256 fingerprint match. After that, voice works offline. **This is the only thing Sage downloads by
  itself** (a model from the Welcome screen is downloaded by the local model runner, after you agree). None of your speech or text is sent: it is an ordinary file download, so Hugging Face sees a
  request from your PC, as with any website.
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
  that can use tools. Sage's Welcome screen downloads one for you on first start; to do it yourself,
  Sage's default is `qwen3:4b` (about 2.5 GB):

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

- **Brain** picks where Sage thinks: *On this computer (Ollama)*, *Claude*, *OpenAI*, *Gemini* or
  *Another online service*, each with a one-line note on what it costs and what is sent where. The
  switch takes effect with your next message. The first time you pick (or save) an online brain, Sage
  says in one line what it will send to which company.
- **Local model** is the Ollama model name (default `qwen3:4b`). Sage only ever talks to Ollama at
  `127.0.0.1:11434`, on the same computer; that address can't be changed. If Ollama isn't running,
  Sage says so in plain words ("Sage can't reach the local model runner. Start it, or open Settings →
  Set up Sage for help, then try again.").
- **Claude, OpenAI and Gemini** each have a model box (with a sensible default you can change) and
  **Load models**, which asks the company for its current list to pick from. **Get a key** opens the
  company's key page in your web browser, after Sage asks; paste the key and choose **Save key**, then
  **Test** checks it with one small request that costs nothing (listing the models). Sage talks to
  each company at its own fixed address: Claude through Anthropic's Messages API
  (`https://api.anthropic.com/v1/messages`), OpenAI through `https://api.openai.com/v1/chat/completions`,
  and Gemini through Google's own API (`https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`).
- **Another online service** keeps the **Online service address**, **Online model name** and **Online
  service key** from before. Sage sends `POST <address>/v1/chat/completions` with the key as a bearer
  token. The address must start with `https://` (plain `http://` is accepted only for `127.0.0.1` or
  `localhost`, for a model server on your own PC).
- **Keys:** each brain has its own key, encrypted by your system and stored on its own; switching brains
  never mixes them, and removing one keeps the others. A key is sent only to its own company's address
  (or, for another online service, to the address it was saved for). It is never written to the
  settings file, the logs, the action log or the chat, and it is never shown again after you save it.
- **Errors** are plain sentences: a wrong or revoked key, credit or quota used up, a model that doesn't
  exist or was retired, the service busy, a time-out, or no network. Sage never shows the service's own
  error text.

## Where Sage keeps its data

Everything lives in Sage's folder in your user profile (Electron's `userData` folder):
`%APPDATA%\sage-assistant` on Windows and `~/.config/sage-assistant` on Linux.

| File | What's in it |
| --- | --- |
| `settings.json` | The brain, model names, another online service's address, your app list and approved folders. No key. |
| `claude-key.bin`, `openai-key.bin`, `gemini-key.bin` | Each company's key, encrypted with your system's protection. |
| `online-key.bin` | Another online service's key, encrypted with your system's protection. |
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
