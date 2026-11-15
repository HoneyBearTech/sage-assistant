# Contributing to Sage

Sage is a personal project with a single maintainer. Contributions are welcome, but there is no
service-level agreement, and review may take a while. Only the latest commit on `main` is supported (see
[SUPPORT.md](SUPPORT.md)).

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) and how the project is run
([GOVERNANCE.md](GOVERNANCE.md)) before you start.

## Reporting bugs and suggesting changes

- Use [GitHub Issues](https://github.com/HoneyBearTech/sage-assistant/issues) for bugs, questions and
  ideas. There are forms for a bug report and a feature request. For anything bigger than a small fix,
  open an issue first so we can agree on the approach before you spend time on it.
- **Never paste your online service key** into an issue, a log or a screenshot.
- **Do not report security vulnerabilities in a public issue.** Follow [SECURITY.md](SECURITY.md).

## Development setup

What you need:

- **Node.js 24** and npm. With `fnm`: `fnm use 24`.
- `git`.
- The local model runner and a small model, only if you want to chat with the app you're running (see
  [docs/installing.md](docs/installing.md)). The tests don't need them.

```sh
git clone https://github.com/HoneyBearTech/sage-assistant.git
cd sage-assistant
npm install
npm start        # builds into dist/ and opens Sage's window
```

The tests never touch the network, your real settings or your notes: they use fake HTTP servers on
`127.0.0.1` started by the test, temporary folders for Sage's data, a fake key store and a fake clock.
Keep it that way.

## The checks, and where they run

| Check | What it does | Runs locally with | On GitHub |
| --- | --- | --- | --- |
| Lint and format | [Biome](https://biomejs.dev/) 2.5.15 with its recommended rules (`biome.jsonc`); warnings fail too | `npm run check` | planned |
| Typecheck | TypeScript in strict mode: `tsconfig.json` (main process, preload, tests, scripts) and `src/renderer/tsconfig.json` (the window) | `npm run typecheck` | planned |
| Tests and coverage | Node's built-in test runner through `tsx`, with an 80% line-coverage floor | `npm run test:coverage` (`npm test` without coverage) | planned |
| Public-repo check | No private IP addresses, LAN host names, home folders or personal e-mail addresses in any file | `npm run check:public` | planned |
| Secret scan | gitleaks over the git history and the working tree; skipped with a message if gitleaks isn't installed | `npm run secret-scan` | planned |

`npm run verify` runs all five, in that order. Nothing runs on GitHub yet: the workflows are written out,
ready to add, in [docs/github-checks-to-add.md](docs/github-checks-to-add.md).

`npm run format` rewrites files in the house style, and `npx biome check --write .` also applies safe lint
fixes.

## Before you open a pull request

```sh
npm run verify
```

It must pass. If you changed the window, also start the app (`npm start`) and try the change by hand.

## Coding standards

- **TypeScript** in strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. The
  typecheck must be clean.
- **Logic lives in `src/core/`**, where the tests can reach it without Electron. `src/main/main.ts` only
  connects it to Electron; keep it thin.
- **The ask-first rule is not optional.** A skill that opens, starts, changes or deletes anything is
  `risk: "confirm"`, has a `prepare` step that says in plain words exactly what will happen, and is tested
  to prove it never runs without an approval. There is no skill that runs commands, and there will be no
  "always allow" switch.
- **Outside text is data.** Anything that comes from a web page, a file or a note goes back to the model
  wrapped as untrusted (`untrustedSource`), and is never parsed for commands.
- **The key stays secret.** Never write the online key to settings, a log, the action log, the chat or the
  window. `test/key-leak.test.ts` checks this; extend it if you add a place that writes data.
- **Validate everything that crosses a boundary** with zod: model replies, IPC payloads, settings and
  stored files.
- **No telemetry**, analytics or crash reporting of any kind, and no remote content in the window.
- **Dependencies**: pin exact versions, keep them few, and only with permissive licences. No vendor SDKs;
  use `fetch`. See [install scripts](#install-scripts-and-allowscripts) below.
- Formatting and lint are Biome's job; if you must silence a rule, use a `biome-ignore` comment with the
  reason.

### Install scripts and `allowScripts`

A package's install script runs code on your computer during `npm install`, so Sage keeps a reviewed
list of them in the `allowScripts` field of `package.json`. Today it has one entry, pinned to a
version: `esbuild@0.28.2`, whose script picks the right prebuilt binary for your system. Electron has no
install script; it downloads its runtime on the first `npm start`.

The field is read by npm 11.19 and later (the version that comes with Node 24):

- `npm install` prints *"… install scripts not yet covered by allowScripts"* for any package with an
  install script that isn't on the list. Treat that warning as a review request, not noise.
- `npm install-scripts ls` lists them; `npm install-scripts approve <package>` adds a pinned entry after
  you've read the script; `npm install-scripts deny <package>` writes `false`, which stops that script
  from running.
- `npm install --strict-allow-scripts` refuses to install while any script is unreviewed.

Keep the field when you change dependencies: don't delete it to quiet the warning. When a dependency
update changes a reviewed package's version, read its new install script and update the pinned entry
in the same pull request. Older npm versions ignore the field and run every install script, which is
one more reason to use Node 24.

## Test policy

- **New functionality comes with tests** in `test/`, covering what it should do and how it handles bad
  input or a service that is down.
- **Bug fixes come with a regression test** that fails without the fix, unless that is impractical, in
  which case the pull request says why.
- **Security-relevant changes come with a test that proves the protection works.**

## Developer Certificate of Origin

Every commit must be signed off to certify the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO): that you wrote the change, or otherwise have the right to submit it under the project's licence.
`git commit -s` adds the line for you:

```text
Signed-off-by: Your Name <you@example.com>
```

A GitHub `noreply` address is fine. To fix a missing sign-off, amend or rebase with `--signoff` (for example
`git rebase --signoff main`) and force-push your branch. There is no automatic DCO check on GitHub yet
(it is planned); the maintainer checks it in review.

## Pull requests

- Keep each pull request to **one change**, and describe what it does and why.
- Follow the [coding standards](#coding-standards) and the [test policy](#test-policy), and sign off your
  commits.
- Never commit keys, tokens or Sage's data files. `.gitignore` excludes them; extend it if you need to.
- Sage can open apps and files and holds a key, so call out any change to skills, the ask-first gate, the
  key store, the window's security settings or IPC in the description.

## Code review

Every change reaches `main` through a pull request and is reviewed by the maintainer, who reads the whole
diff and runs `npm run verify`. With one maintainer, the maintainer's own changes are reviewed against the
same list.

**What is checked:** it does one thing and says why; it is correct for the cases that matter, including
errors; tests cover it; no secret reaches a file, log or the window; input from the window, the model, web
pages and files is validated or treated as untrusted; anything that opens or deletes is confirmed every
time; new dependencies are needed, maintained and permissively licensed; docs and the changelog are
updated.

## Licence

By contributing, you agree that your contribution is licensed under the project's [MIT License](LICENSE).
