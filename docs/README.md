# Sage documentation

> [!IMPORTANT]
> **Sage asks before it acts, and you decide.** Opening an app or a file and deleting a note or reminder
> always show a confirmation box that says exactly what will happen. Read it before you choose
> **Allow**: Sage does what the box says, and a deleted note can't be brought back.
>
> **An online brain sees what you type.** With the local brain (Ollama) your messages stay on your
> computer. With an online brain (Claude, OpenAI, Gemini or another service), every message and every
> tool result in the conversation is sent to that company. Online brains cost money per use, and Sage
> can't cap what you spend: set a limit on the company's own website.

## Getting started

- [Installing](installing.md): the Windows installer from the Releases page (checking it, SmartScreen,
  updating and uninstalling), running Sage from source on Windows and Linux, installing the local model
  runner and a small model, setting up the online brain, and updating.
- [Windows checklist](windows-checklist.md): short manual checks to run on a Windows PC.

## How Sage works

- [Architecture](architecture.md): the parts of the app, how a message flows through them, and where
  data is kept.
- [Assurance case](assurance-case.md): what could go wrong (a dangerous request, a tricky web page, a
  leaked key, files outside the approved folders, a bad update) and what stops it, the trust boundaries,
  and the risk that remains.

## The project

- [Roadmap](roadmap.md): what has shipped, what comes next, what comes later, and what Sage will not do.
- [GitHub checks](github-checks.md): what runs on GitHub (CI, DCO, secret scan, CodeQL, dependency review,
  Scorecard), how Renovate keeps dependencies current, and the branch rule. Locally, run `npm run verify`.
- [Releasing](releasing.md): the release workflow (ready for the owner to add), how to make a release,
  and how to check a downloaded installer's checksum and provenance.
- [Plans](plans/) and [reports](reports/): the plan for each job and the research behind it.

The repository's root holds the [README](../README.md), the [security policy](../SECURITY.md), the
[contribution guide](../CONTRIBUTING.md), [governance](../GOVERNANCE.md), the
[code of conduct](../CODE_OF_CONDUCT.md), the [support policy](../SUPPORT.md) and the
[changelog](../CHANGELOG.md).
