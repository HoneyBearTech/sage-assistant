# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities through
[GitHub's private vulnerability reporting](https://github.com/HoneyBearTech/sage-assistant/security/advisories/new),
never in a public issue.

Include what you found, how to reproduce it (the messages you sent, the web page or note involved, the
settings), which commit you tested, your operating system, which brain you used (local or online), and
what an attacker gains. Never include a real online service key; redact it from logs and screenshots. If
you'd like to be credited under a particular name, or not at all, say so.

## How reports are handled

Sage is a personal project maintained by one person (see [GOVERNANCE.md](GOVERNANCE.md)), so these are
targets rather than a contractual SLA:

1. **Acknowledge** the report within 7 days.
2. **Triage** it: reproduce the problem, decide whether it is a vulnerability in Sage (see "Scope"), and
   agree its severity with you. If it isn't a vulnerability you'll get an explanation, and the report may
   move to a public issue with your agreement.
3. **Fix** it privately in a GitHub security advisory, with a regression test, and invite you to review
   the fix if you want to.
4. **Release** the fix, then publish the advisory (requesting a CVE where it applies) with the affected and
   fixed versions and any workaround. The aim is to fix critical and high-severity issues within 30 days
   of the report and others within 90 days, and to keep you updated at least every 14 days until then.
5. **Credit** the reporter in the advisory and the changelog, unless you ask to stay anonymous.

Please keep the details private until the advisory is published, or for 90 days after your report if no
fix has been released by then.

## Supported versions

Sage has no tagged release yet. Only the latest commit on `main` is supported. Details are in
[SUPPORT.md](SUPPORT.md).

## Scope

Sage is a desktop app for one person on their own computer. What it protects against, and how, is in
[docs/assurance-case.md](docs/assurance-case.md). Read it before you report.

In scope, for example:

- Anything that makes an "asks first" skill (opening an app or a file, deleting a note or reminder) run
  without the user choosing **Allow** for that exact action, or makes the confirmation box describe
  something other than what then happens.
- Text from a web page, search result or note that makes Sage take an action the user didn't ask for.
- Opening an app that isn't on the user's list, or a file outside the approved folders (for example
  through `..`, a symlink or a shortcut).
- The online key reaching the settings file, a log, the action log, the chat, the window, or any address
  other than the configured online service.
- The chat window loading remote content, navigating away, opening new windows, or getting a permission
  other than the microphone.

Expected behaviour, not a vulnerability: anything someone can do who already controls your user account
(they can edit Sage's files or run programs themselves), what a model says in its replies, and what an
online service you chose does with the messages you send it.
