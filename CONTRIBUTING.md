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
| Lint and format | [Biome](https://biomejs.dev/) 2.6.8 with its recommended rules (`biome.jsonc`); warnings fail too | `npm run check` | CI, every pull request |
| Typecheck | TypeScript in strict mode: `tsconfig.json` (main process, preload, tests, scripts) and `src/renderer/tsconfig.json` (the window) | `npm run typecheck` | CI, every pull request |
| Tests and coverage | Node's built-in test runner through `tsx`, with an 80% line-coverage floor | `npm run test:coverage` (`npm test` without coverage) | CI, every pull request |
| Public-repo check | No private IP addresses, LAN host names, home folders or personal e-mail addresses in any file, also when written with the JSON escapes `\u` plus four hex digits, `\\` or `\/` | `npm run check:public` | CI, every pull request |
| Secret scan | gitleaks over the git history and the working tree; skipped with a message if gitleaks isn't installed | `npm run secret-scan` | a gitleaks workflow on every pull request (history only); the local scan inside CI's verify step is skipped, because gitleaks isn't installed on those runners |

`npm run verify` runs all five, in that order, and stays the command to run locally. On GitHub, every pull
request gets CI (`npm run verify` on Ubuntu and Windows, plus a dependency audit), the DCO check, the
secret scan, CodeQL and dependency review; the OpenSSF Scorecard runs on `main` and weekly. The workflows
are in [.github/workflows/](.github/workflows/), and [docs/github-checks.md](docs/github-checks.md) records
them.

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
list of them in the `allowScripts` field of `package.json`. Today it has two entries, each pinned to a
version: `esbuild@0.28.2` is allowed (its script picks the right prebuilt binary for your system), and
`electron-winstaller@5.4.0` is turned off (`false`): electron-builder brings it for an installer type
Sage doesn't use. Electron has no install script; it downloads its runtime on the first `npm start`.

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
- **Tests use mocked timers or events, never sleeps or real timeouts.** A test that waits for
  something waits for the event itself (a promise the fake resolves, the scheduler's own queue), and
  anything on a timer runs on `FakeClock` or node:test's mock timers (`t.mock.timers`). A short
  real timeout is only acceptable when the outcome is the same however slow the machine is, such as
  a fake server that never answers. The suite runs its files in parallel, so a test that passes
  only on an idle machine fails on a busy one.
- **No free-port tricks.** Don't pick a free port, close it and expect it to stay closed: another
  test can take it in between. Start a fake server on port 0 and keep it open, or use
  `REFUSED_PORT` from `test/helpers.ts` for "nothing is listening".

## Reviewing a Renovate update

Renovate opens the dependency update pull requests (see [renovate.json](renovate.json)). Review each one
like any other change, because an update can carry a compromised release:

- It runs every check on GitHub, like any other pull request. Don't merge it until they pass.
- New releases wait 3 days before Renovate proposes them. Security fixes don't wait.
- After an esbuild update, or any update of a package that runs an install script, inspect the new
  script and update the `allowScripts` entry in `package.json` (the list of packages allowed to run
  install scripts). Entries are keyed by exact version, such as `esbuild@0.28.2`, so each esbuild update
  needs a new key.
- After an electron-builder update, check whether the version of `electron-winstaller` it brings changed
  (`npm install-scripts ls`, or its entry in the `package-lock.json` diff). If it did, read its new
  install script and replace the `electron-winstaller@…` key in `allowScripts` with the new version,
  still set to `false`: its script stays off, because Sage's installer type doesn't use it.
- Look for new or changed install scripts in every update pull request, including the monthly lockfile
  refresh: in the `package-lock.json` diff, look for `"hasInstallScript": true` on new or changed
  entries; or run `npm install-scripts ls` locally, which lists packages whose install scripts aren't
  reviewed yet (npm 11.19.1, which comes with Node 24.22, has it; if your npm lacks the command, use the
  lockfile diff).
- After a Biome update, update the version in the `$schema` line of `biome.jsonc` and fix any new
  warnings.
- Push those changes as a signed-off commit (`git commit -s`) on the same pull request.
- A new Electron major version comes in its own pull request. CI can't open the window, so run the
  [Windows checklist](docs/windows-checklist.md) before merging.

## Developer Certificate of Origin

Every commit must be signed off to certify the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO): that you wrote the change, or otherwise have the right to submit it under the project's licence.
`git commit -s` adds the line for you:

```text
Signed-off-by: Your Name <you@example.com>
```

A GitHub `noreply` address is fine. To fix a missing sign-off, amend or rebase with `--signoff` (for example
`git rebase --signoff main`) and force-push your branch. A DCO check runs on every pull request and
fails if a commit has no sign-off; commits from the Renovate and Dependabot bots and merge commits are
exempt.

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
