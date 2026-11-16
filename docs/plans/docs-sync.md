# Plan: docs-sync

## What the owner asked for

"Start the docs sync job": bring the copy of the release workflow in [Releasing](../releasing.md) up to
date with the real file, `.github/workflows/release.yml`.

## What we found

- The release workflow was added from the guide's copy (#16), byte for byte. Renovate's "Pin
  dependencies" update (#10) then changed three lines of the real file: the version notes next to two
  actions (`# v7` became `# v7.0.1` and `# v7.1.0`) and the Node version (`24` became `24.22.3`). The
  pinned commits themselves didn't change.
- Everything else in the guide's copy still matches the real file exactly. No other document names
  these versions.
- The guide still describes the workflow as something to add, and doesn't say the copy can fall behind
  the real file when Renovate updates it.

## What we'll change

1. **`docs/releasing.md`, the workflow copy:** the same three lines as the real file, so the copy and
   `.github/workflows/release.yml` are identical again.

   *Check:* the copy, taken out of the guide, is compared with the real file and they match exactly;
   a workflow checker finds no problems in it.
2. **`docs/releasing.md`, the text around it:** say the workflow is now on `main` (added in #16), that
   the file on `main` is the one that runs, and that Renovate keeps its versions up to date there, so the
   guide's copy can fall behind until the next docs update. Step 1 of "Making a release" says it is
   already done for this repository and is kept for anyone setting up a copy of Sage.

   *Check:* `npm run verify`, and a plain-English read before final approval.

## Who's on it

CEO, Engineer, Security Officer and Auditor. No Researcher, QA or plan check: a small change to one
document.

## Risks

- None for Sage itself: no code or workflow file changes.
- The copy will fall behind again with the next Renovate update to the workflow. The new note says so;
  keeping it identical every time isn't worth a pull request per update.

## Out of scope

- Any change to the workflow files (the team doesn't change them).
- A test that fails when the copy differs from the real file: that would block every Renovate update to
  the workflow until the docs are changed in the same pull request, which Renovate can't do.
