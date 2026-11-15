# Similar projects: what Sage copies and what it avoids

Researched 2026-11-15 from each project's public pages. Star counts and dates are snapshots from that
day. Nothing was downloaded or run.

## jarvis-agent.tech

A paid, closed-source desktop kit sold by a small company. It is an Electron dashboard with ready-made
agents and playbooks for linking other services.

- **Install:** a one-click installer for Windows 10/11 and Mac. On Linux it runs from a source bundle
  (`bash start.sh`), without voice.
- **Brain:** online only. It uses the buyer's own accounts with online services, or an API key. It has no
  local model.
- **Voice:** hold Space to talk, with local speech recognition and spoken replies. The site doesn't name
  the engines.
- **Safety:** the site describes no confirmation step for risky actions. One of its agents makes
  spending changes on its own.
- **Privacy:** anonymous usage tracking is on by default, and an environment variable turns it off. The
  site doesn't say how keys are stored.

**Sage copies:** the install shape (one-click on Windows, source on Linux), hold-a-key talking with
offline speech recognition, and stating download sizes up front.
**Sage avoids:** tracking by default, high-impact actions taken without asking, undocumented key
storage, and a Linux version without voice.

## Open-source projects

| Project | What it is | Brain | Asks before risky actions? | Licence |
|---|---|---|---|---|
| Open Interpreter | Terminal agent (Rust) | Any compatible online service | Yes: sandbox and approvals | Apache-2.0 |
| Leon | Node and Python, web app on a local port | Local or online | None described | MIT |
| OpenVoiceOS | Python voice platform, offline-capable | Mixed | Skills install without prompts | Apache-2.0 |
| Jan | Desktop chat app (Tauri) with a local API | Local and online | Tools opt-in, shell switch | Apache-2.0 |
| AnythingLLM | Desktop and Docker app | Many, including local | Tool approval requests | MIT |
| Goose | Desktop agent (Rust) | Many, including local | Not checked | Apache-2.0 |
| Dix01/JARVIS | Electron and a Python local server (Windows) | Local or key | Safe / caution / dangerous tiers, but with a bypass mode | MIT |
| BASIC-JARVIS | Electron and a Python local server | Local | None. The local server has no login and allows any origin | MIT |

## Common patterns

- A local model runner, or any service with the common chat format, as the brain, with an API key for
  the online option.
- Offline speech recognition based on Whisper models, with the system or browser voices as a fallback.
- Actions sorted into "safe" and "ask first" tiers in the better projects.

## Common mistakes, and Sage's answer

| Mistake seen | Sage's answer |
|---|---|
| A local server with no login, which any web page can call | No local server. The window talks only to the app itself. |
| Shell or system control on by default | No run-any-command skill. Risky skills always ask first. |
| A "bypass" or "auto-approve" mode | None. Each action is confirmed separately. |
| Malicious web pages or tools starting programs (published advisories on Jan, AnythingLLM and Open WebUI) | Web and file text can't trigger skills. Apps come only from Sean's list. No remote pages in the window. |
| API keys in plain-text files | Key encrypted with the operating system's protection. Tests prove it is never written in plain text. |
| Tracking on by default | No tracking at all. |
| Missing licence, or abandoned after a few commits | MIT licence, a roadmap, a security policy and tests from day one. |
