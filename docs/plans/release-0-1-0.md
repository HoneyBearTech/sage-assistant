# Plan: release-0-1-0

## What the owner asked for

"Start the release workflow job". The team doesn't add or change workflow files, so the
owner adds the release workflow himself (step 1 of [Releasing](../releasing.md)). The team does the
version pull request (steps 2 to 4), and the owner makes the release with the tag (step 6).

## What we found

- The release workflow in `docs/releasing.md` is still current: its actions are pinned to the same
  versions as the other checks, it uses Node 24 like them, and a workflow checker finds no problems in it.
- `package.json` already says `0.1.0`, so for the first release only `CHANGELOG.md` changes.
- Everything in `CHANGELOG.md` is under `## [Unreleased]`.

## What we'll change

1. **`CHANGELOG.md`:** the existing entries move under a new heading `## [0.1.0] - 2026-11-16`, with a
   new, empty `## [Unreleased]` above it. Links at the bottom of the file point `[0.1.0]` to the
   release's page and `[Unreleased]` to the changes since `v0.1.0` (both work once the tag exists). The
   entries' wording doesn't change.

   *Check:* `npm run verify`; the entries are the same before and after (only the headings and links
   are new).
2. **`docs/roadmap.md`:** the owner's release item notes that the version pull request is done, and what
   is left (adding the workflow and the tag).

## Who's on it

CEO, Engineer, Security Officer and Auditor. No Researcher, QA or plan check: a small change to two
documents.

## What happens after

1. The owner adds `.github/workflows/release.yml` through GitHub (step 1 of Releasing) and merges it.
   The CEO can compare that pull request with the reviewed text before he merges it.
2. The owner approves and merges this pull request.
3. The owner runs the two tag commands in step 6. GitHub builds the installer, the checksum and the
   build record, and publishes release 0.1.0.

## Risks

- **The date.** The heading says 2026-11-16. If the release is made on a later day, the date can be
  changed in a small pull request, or left as the day the version was prepared.
- **The first run of the workflow** is its first real test. If it fails, nothing is published, and
  `docs/releasing.md` says how to start again.

## Out of scope

- Adding or changing any workflow file (the owner's step).
- Making the tag or the release (the owner's step).
- A version number change in `package.json` (already `0.1.0`).
