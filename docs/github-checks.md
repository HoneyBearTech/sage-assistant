# GitHub checks

A short record of what runs on GitHub for this repository and what is set up there. The workflow files in
[.github/workflows/](../.github/workflows/) are the source of truth; read them for the details. Every
action in them is pinned to a full commit ID (a "SHA", the long hexadecimal ID of one exact version) with
the version in a comment, so a moved tag can't change what runs. `npm run verify` stays the local command
and runs the same lint, typecheck, tests, public-repo check and secret scan.

## In place

Workflows:

- [CI](../.github/workflows/ci.yml): `npm run verify` and `npm audit --audit-level=high` on Ubuntu and
  Windows, on every pull request to `main` and every push to `main`. gitleaks isn't installed on those
  runners, so the secret scan inside `npm run verify` skips itself there; the next workflow does the scan.
- [DCO](../.github/workflows/dco.yml): every commit in a pull request must carry a `Signed-off-by` line.
  Commits from the Renovate and Dependabot bots, and merge commits, are exempt.
- [Secret scan](../.github/workflows/secret-scan.yml): `gitleaks git` over the git history, on every pull
  request to `main` and every push to `main`. The local `npm run secret-scan` also scans the working
  tree.
- [CodeQL](../.github/workflows/codeql.yml): code scanning for JavaScript and TypeScript, on every pull
  request to `main`, every push to `main` and weekly.
- [Dependency review](../.github/workflows/dependency-review.yml): fails a pull request that adds a
  dependency with a known vulnerability of moderate severity or worse, or a licence outside the permissive
  list.
- [Scorecard](../.github/workflows/scorecard.yml): the OpenSSF Scorecard, on every push to `main` and
  weekly (it doesn't run on pull requests).

The OpenSSF Best Practices badge at the top of the README is different from the Scorecard. The Scorecard is
an automatic check that runs on GitHub. The badge comes from the OpenSSF Best Practices programme, where the
owner answers a questionnaire about how the project is run; its page is
<https://www.bestpractices.dev/projects/16810>. The badge shows "in progress" until that questionnaire is
complete, and the owner keeps it up to date.

Not in place yet:

- **Release**: builds the Windows installer on a version tag such as `v0.2.0`, with a checksum file and
  build provenance, and publishes them on the Releases page. The team doesn't add workflows, so the
  owner adds it as `.github/workflows/release.yml` from the ready-to-paste text in
  [releasing.md](releasing.md), which also explains how to make a release.

Set up:

- [CODEOWNERS](../.github/CODEOWNERS): `* @HoneyBearTech`.
- Private vulnerability reporting is on; [SECURITY.md](../SECURITY.md) relies on it.
- The Renovate GitHub app is installed on this repository.
- A ruleset named "Main" exists. Its details can't be read from here, so check it against the summary
  under [The branch rule](#the-branch-rule).

## Settings to check

The team can't read these settings, so check them under **Settings → Code security** (they aren't
confirmed here):

- **Secret scanning** and **Push protection**: on.
- **Dependabot alerts**: on, because Renovate reads them.
- **Dependabot security updates** and **Dependabot version updates**: off, so Dependabot opens no pull
  requests of its own and there are no duplicates of Renovate's.

## Renovate

[renovate.json](../renovate.json) keeps the npm dependencies and the pinned action SHAs current.

- **When:** one weekly run, before 6am on Monday (US Central time), plus a monthly refresh of
  `package-lock.json`. Security fixes don't wait for the weekly slot and carry a `security` label.
- **A 3-day wait:** a new release isn't proposed until it is 3 days old, so a just-published (possibly
  bad) release isn't offered at once. Security-fix pull requests are exempt: Renovate's own default for
  them is no wait. The monthly lockfile refresh doesn't wait either, because it has no release date to
  count from.
- **What:** npm versions stay exact (the `engines` line in `package.json` stays a range) and actions stay
  pinned to a full SHA. Minor, patch and digest updates of actions come in one pull request (a "digest"
  update moves the SHA behind a tag that was re-pointed), and the CodeQL actions always move together.
  Each new Electron major version gets its own pull request.
- **Merging:** Renovate merges its own pull requests itself (squash, patch, minor and major), on its next
  run once every required check on the pull request has passed. These stay manual, because each needs a
  follow-up change or a test on the Windows PC that CI can't do: Electron major updates, esbuild,
  electron-builder, the sherpa-onnx speech engine and Biome. Review those like any other change (an
  update can carry a compromised release):
  - it runs every check on GitHub;
  - after an esbuild (or any install-script package) update, inspect the new script and update the
    `allowScripts` entry in `package.json` (the list of packages allowed to run install scripts). Entries
    are keyed by exact version, such as `esbuild@0.28.2`, so each esbuild update needs a new key;
  - after an electron-builder update, check whether the version of `electron-winstaller` it brings
    changed; if it did, inspect its install script and update its `allowScripts` entry, which stays
    `false` (the script stays off);
  - in every update pull request, including the monthly lockfile refresh, look for new or changed install
    scripts: in the `package-lock.json` diff, look for `"hasInstallScript": true` on new or changed
    entries, or run `npm install-scripts ls` locally (npm 11.19.1, which comes with Node 24.22, has it;
    with an older npm, use the lockfile diff);
  - after a Biome update, update the `$schema` line in `biome.jsonc` and fix any new warnings;
  - push those changes as a signed-off commit on the same pull request.

  Until the "Code Owners" review requirement in the branch rule below is switched off, every Renovate
  pull request, including the ones that merge themselves, also waits for the owner.

  The same checklist is in [CONTRIBUTING.md](../CONTRIBUTING.md#reviewing-a-renovate-update).

## The branch rule

A ruleset named "Main" is in place on the repository. In plain words, the recommended rule is: **`main`
can only change through a pull request that passes the checks.** The detail, to compare against the
ruleset under **Settings → Rules → Rulesets**:

- enforcement Active and an empty bypass list; deletions and force pushes blocked; linear history;
- a pull request required before merging, with review from Code Owners required and stale approvals
  dismissed when new commits are pushed. With one maintainer, required approvals are 0 so the owner can
  merge their own reviewed changes. That costs points on the Scorecard's Code-Review and Branch
  Protection checks; raise it to 1 once there is a second maintainer;
- status checks required, with branches up to date before merging: `verify (ubuntu-latest)`,
  `verify (windows-latest)`, `DCO sign-off`, `Secret scan`, `Analyze (javascript-typescript)` and
  `Dependency review`.
