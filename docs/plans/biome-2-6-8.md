# Plan: biome-2-6-8

## What Sean asked for

"Fix the Biome PR." That is Renovate's pull request #4, which updates Biome (the linter and formatter)
from 2.5.15 to 2.6.8.

## What we found

- **Why #4 fails CI:** with 2.6.8, `npm run check` reports 15 errors and 1 note.
  - **The note:** `biome.jsonc` still names version 2.5.15 in its `$schema` line. The review checklist
    already says to change this line on every Biome update.
  - **The errors:** Biome 2.6 has started formatting Markdown files. All 15 errors are `.md` files (the
    README, CONTRIBUTING, every page in `docs/`, …). Biome would rewrite them: pad every table with
    spaces, turn `*italic*` into `_italic_`, and change list markers.
  - **The code itself:** passes unchanged.
- **The docs are written by hand.** They are hand-wrapped prose meant to be read on GitHub. Letting Biome
  reformat them would change nearly every page and make the tables harder to read as plain text, for no
  gain.
- **Two ways out, both tried on a copy:** turning off Biome's Markdown formatter, or leaving `.md` files
  out of Biome entirely. Both make `npm run check` pass. Turning off only the formatter is the narrower
  change: Biome still sees the files, it just doesn't reformat them.
- **Who can change #4:** the team may push only to its own branch, not to Renovate's. So the update is
  made on this job's branch. Once it reaches `main`, Renovate sees Biome is already up to date and closes
  #4 by itself.

## What we'll change

1. **Update Biome to exactly 2.6.8** in `package.json` and `package-lock.json`, the same change #4 makes.
   *Check:* the lockfile diff touches only the Biome packages, and none of them gains an install script
   (the review checklist's install-script check).
2. **`biome.jsonc`:**
   - change the `$schema` line to 2.6.8;
   - turn off Biome's Markdown formatter, with a one-line comment saying why: the docs are hand-written
     prose.

   *Check:* `npm run verify` passes on a clean copy, and CI passes on this PR on Ubuntu and Windows.
3. **CHANGELOG:** one line under Unreleased.

## Who's on it

Engineer, Security Officer, a second security reviewer, and an independent Auditor. QA and the plan check
are skipped for a change this small. It counts as security-sensitive because it is a dependency update.

## Risks

- **Markdown files go unformatted.** Biome won't format Markdown in future either. That matches how the
  docs have always been kept: by hand, reviewed in pull requests.
- **#4 might not close by itself.** If Renovate doesn't close it after the merge, Sean can close it by
  hand. Nothing is lost.

## Out of scope

- **No doc reformatting.** No reformatting of any doc, and no other Biome rule changes.
- **Other Renovate pull requests.** #3 (CodeQL) and #7 (Node.js 26) aren't touched.
