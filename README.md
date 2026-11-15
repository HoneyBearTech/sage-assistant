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
> This is the foundation: a text chat that runs from source on Windows and Linux. A one-click Windows
> installer, voice (hold a key to talk) and a first-run setup come next; see the
> [roadmap](docs/roadmap.md).

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

## Developing

`npm run verify` runs every check: Biome lint and format, the TypeScript typecheck, the tests with an
80% line-coverage floor, the public-repo checker and a secret scan (skipped with a message if gitleaks
isn't installed). The checks run locally for now; running them on GitHub for every pull request is
planned (see [docs/github-checks-to-add.md](docs/github-checks-to-add.md)). See
[CONTRIBUTING.md](CONTRIBUTING.md) for the details.

## Documentation

The [docs index](docs/README.md) lists everything: how Sage works, the security case, installing, the
Windows checklist and the roadmap.

## Security and support

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). For help, see
[SUPPORT.md](SUPPORT.md).

## License

[MIT](LICENSE), copyright HoneyBearTech.
