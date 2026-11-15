# GitHub checks

A short record of what runs on GitHub for this repository and what is set up there. The workflow files in
[.github/workflows/](../.github/workflows/) are the source of truth; read them for the details. Every
action in them is pinned to a full commit SHA with the version in a comment. `npm run verify` stays the
local command and runs the same lint, typecheck, tests, public-repo check and secret scan.

## In place

Workflows:

- [CI](../.github/workflows/ci.yml): `npm run verify` and `npm audit --audit-level=high` on Ubuntu and
  Windows, on every pull request to `main` and every push to `main`.
- [DCO](../.github/workflows/dco.yml): every commit in a pull request must carry a `Signed-off-by` line.
  Commits from the Renovate and Dependabot bots, and merge commits, are exempt.
- [Secret scan](../.github/workflows/secret-scan.yml): gitleaks over the history and the tree, on every
  pull request to `main` and every push to `main`.
- [CodeQL](../.github/workflows/codeql.yml): code scanning for JavaScript and TypeScript, on every pull
  request to `main`, every push to `main` and weekly.
- [Dependency review](../.github/workflows/dependency-review.yml): fails a pull request that adds a
  dependency with a known vulnerability of moderate severity or worse, or a licence outside the permissive
  list.
- [Scorecard](../.github/workflows/scorecard.yml): the OpenSSF Scorecard, on every push to `main` and
  weekly (it doesn't run on pull requests).

Settings:

- [CODEOWNERS](../.github/CODEOWNERS): `* @HoneyBearTech`.
- Private vulnerability reporting is on; [SECURITY.md](../SECURITY.md) relies on it.
- Dependabot alerts stay on, because Renovate reads them. Dependabot's own security and version update
  pull requests stay off, so there are no duplicates.

## Renovate

[renovate.json](../renovate.json) keeps the npm dependencies and the pinned action SHAs current. The
Renovate GitHub app is installed on this repository.

- **When:** one weekly run, before 6am on Monday (US Central time), plus a monthly refresh of
  `package-lock.json`. Security fixes don't wait for the weekly slot and carry a `security` label.
- **What:** npm versions stay exact and actions stay pinned to a full SHA. Minor, patch and digest updates
  of actions come in one pull request, and the CodeQL actions always move together. Each new Electron major
  version gets its own pull request.
- **Merging:** Renovate never merges its own pull requests. Review each one like any other change (an
  update can carry a compromised release):
  - it runs every check on GitHub;
  - after an esbuild (or any install-script package) update, inspect the new script and update the
    `allowScripts` entry in `package.json`;
  - after a Biome update, update the `$schema` line in `biome.jsonc` and fix any new warnings;
  - push those changes as a signed-off commit on the same pull request.

  The same checklist is in [CONTRIBUTING.md](../CONTRIBUTING.md#reviewing-a-renovate-update).

## Still open

- **The branch rule for `main`, if it isn't on yet.** In **Settings → Rules → Rulesets**, a ruleset for
  the default branch with:
  - enforcement Active and an empty bypass list; deletions and force pushes blocked; linear history;
  - a pull request required before merging, with review from Code Owners required and stale approvals
    dismissed when new commits are pushed. With one maintainer, required approvals are 0 so the owner can
    merge their own reviewed changes. That costs points on the Scorecard's Code-Review and Branch
    Protection checks; raise it to 1 once there is a second maintainer;
  - status checks required, with branches up to date before merging: `verify (ubuntu-latest)`,
    `verify (windows-latest)`, `DCO sign-off`, `Secret scan`, `Analyze (javascript-typescript)` and
    `Dependency review`.
