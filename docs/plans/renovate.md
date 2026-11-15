# Plan: renovate

## What Sean asked for

"This will use Renovate instead of Dependabot."

## What we found

- **No updates are running yet.** The repo has no Renovate or Dependabot config, and
  `docs/github-checks-to-add.md` section 7 holds ready-to-paste Dependabot text.
- **The GitHub checks are now in place.** Sean has added CI, the DCO check, secret scan, CodeQL,
  dependency review and Scorecard, plus CODEOWNERS, and turned on private vulnerability reporting. The
  DCO check already lets Renovate's commits through. But many docs still say "GitHub runs nothing yet" or
  "planned":
  - README and CONTRIBUTING, including its DCO paragraph;
  - the repo's guidelines file, which says never to claim GitHub runs checks;
  - `docs/README.md`, the assurance case, the roadmap and the decisions log;
  - `docs/github-checks-to-add.md`.
- **Every version is pinned on purpose.**
  - Dependencies are pinned to exact versions, with a lockfile (`package-lock.json`).
  - Every GitHub Action is pinned to a full commit ID (a "SHA"), with its version in a comment such as
    `# v7`.

  The Renovate setup must keep both that way.
- **Two files need a person after some updates.**
  - `package.json` keeps a list of the packages allowed to run install scripts (today, esbuild).
  - `biome.jsonc` names the linter's version.

  When those packages update, these lines need a matching manual change on the same pull request.
  Renovate can't make it.

## What we'll change

1. **Add `renovate.json` at the repo root.** It follows labscribe's layout, but only for what this repo
   uses: npm and GitHub Actions.
   - **Schedule:** weekly, early Monday morning, US Central time.
   - **Labels:** a "dependencies" label, with Sean assigned.
   - **Security fixes:** vulnerability alerts are on, with a "security" label, and they don't wait for the
     weekly slot.
   - **Exact versions:** npm versions stay exact, with the "pin" setting.
   - **Pinned actions:** actions stay pinned to a full commit ID with the version in a comment. Any action
     added later in a tag-only form gets pinned too, using Renovate's digest-pinning preset.
   - **Grouping:** small action updates come in one pull request, covering minor, patch and moved-tag
     ("digest") updates. The CodeQL parts always move together.
   - **Electron:** each new major version comes in its own pull request, with a note pointing to
     `docs/windows-checklist.md`. CI can't open the window, so those need a check on the Windows PC.
   - **Extra notes:** updates to esbuild and Biome carry a note about the matching manual change (see
     step 2).
   - **Lockfile refresh:** `package-lock.json` is refreshed once a month.

   *Check:*
   - Renovate's config checker passes, run locally with
     `npx --yes --package=renovate renovate-config-validator`.
   - `npm run verify` and CI pass on this pull request. They check formatting and the public-repo rules,
     not Renovate's own rules.
2. **Replace the Dependabot section with a Renovate section.**
   - Sean's one step on GitHub: install the Renovate app on this repo.
   - Keep GitHub's Dependabot *alerts* on, because Renovate reads them. Keep Dependabot's own update pull
     requests off, so there are no duplicates.
   - How to review an update pull request:
     - it runs every check, like any other change;
     - after an esbuild (or any install-script) update, inspect the new script and update the
       `allowScripts` line;
     - after a Biome update, update the schema line in `biome.jsonc` and fix any new warnings;
     - push those changes as a signed-off commit on the same pull request.

   The same checklist goes in CONTRIBUTING.
   *Check:* reviewers read it against `renovate.json`.
3. **Bring the docs up to date with the checks Sean has added.**
   - **What runs on GitHub:** say that every pull request gets CI (`npm run verify` on Ubuntu and
     Windows), the DCO check, secret scan, CodeQL, dependency review and Scorecard. Keep
     `npm run verify` as the local command for contributors.
   - **Files:**
     - README;
     - CONTRIBUTING (the checks table and the DCO paragraph);
     - the repo's guidelines file (its "GitHub runs nothing yet" rule and its link);
     - `docs/README.md` and the assurance case;
     - the roadmap (tick the GitHub setup items Sean has done, and fix its links);
     - the decisions log (fix its link).
   - **Rename `docs/github-checks-to-add.md` to `docs/github-checks.md`.** It becomes a short record of
     what is in place:
     - one line per workflow, with a link to its file in `.github/workflows/`, instead of copies of the
       workflow code, which would go stale as Renovate updates the real files;
     - the steps still open: install the Renovate app, and the branch rule if it isn't on yet.

   *Check:*
   - reviewers compare every claim with `.github/workflows/`;
   - a search finds no link to the old file name and no "planned" or "runs nothing yet" left about
     GitHub checks.
4. **CHANGELOG:** one line under Unreleased. The roadmap, decisions log and pass map are brought up to
   date when the job is recorded at the end.

## Who's on it

Engineer, QA, Security Officer, a second security reviewer, and an independent Auditor. This job counts as
security-sensitive: it decides how dependency updates arrive.

## Risks

- **A bad update arrives through Renovate.** Every update pull request still runs CI, dependency review
  and the other checks, and Sean reviews it before merging.
- **The app still needs installing.** Renovate does nothing until Sean installs its GitHub app on this
  repo.
- **Electron updates need a manual test.** CI can't open the window, so major updates are kept separate
  and point to the Windows checklist.
- **Some update pull requests need a manual change.** esbuild and Biome updates can fail CI, or leave a
  stale line, until someone adds the matching change. The review checklist and the note on those pull
  requests say what to do.

## Out of scope

- **No workflow changes.** No changes to the workflows, CODEOWNERS or repo settings.
- **No auto-merge.** Renovate won't merge its own updates. That can be decided later.
- **Unrelated work.** Nothing outside Renovate and the docs that describe the checks.
