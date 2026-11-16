# Plan: release-0-1-1

## What the owner asked for

"Start the next one": a new release with everything merged since 0.1.0, so one installer can be tested.
The team does the version pull request (steps 2 to 4 of [Releasing](../releasing.md)); the owner makes
the release with the tag (step 6), as for 0.1.0.

## What we found

- Seven changes have been merged since `v0.1.0`. Under "Unreleased" the changelog lists three fixes (a
  deleted reminder showing once, the installer build tools' minimatch advisory, the public-repo checker
  reading escaped text) and one internal change (the chat window's code reorganised for test coverage).
  There are no new features, so this is a patch release: **0.1.1**.
- `package.json` and `package-lock.json` say `0.1.0`.
- The release workflow on `main` is the same as the copy in `docs/releasing.md`, so the release steps
  still apply as written.
- The roadmap's owner item "add the release workflow, then make the first release" is out of date: 0.1.0
  was released on 2026-11-16 and its installer was checked against its checksum and build record.

## What we'll change

1. **Version:** `npm version 0.1.1 --no-git-tag-version`, which sets the version in `package.json` and
   `package-lock.json` together and makes no tag.

   *Check:* both files say `0.1.1` and nothing else in them changes.
2. **`CHANGELOG.md`:** the entries under `## [Unreleased]` move under a new heading
   `## [0.1.1] - 2026-11-16`, with a new, empty `## [Unreleased]` above it. The links at the bottom point
   `[0.1.1]` to the release's page and `[Unreleased]` to the changes since `v0.1.1` (both work once the
   tag exists). The entries' wording doesn't change.

   *Check:* `npm run verify`; the entries are the same before and after (only the headings and links are
   new).
3. **`docs/roadmap.md`:** tick the owner's first-release item (0.1.0 released and checked), and note that
   0.1.1 waits for the owner's tag.

## Who's on it

CEO, Engineer, Security Officer and Auditor. No Researcher, QA or plan check: a small change to the
version files and two documents. Releases count as security-sensitive, so the job would also get a
second security review; that reviewer isn't available this month, so the Security Officer and Auditor
check it.

## What happens after

1. The owner approves and merges this pull request.
2. The owner runs the two tag commands in step 6 of Releasing, with `v0.1.1`. GitHub builds the installer,
   its checksum and the build record, and publishes release 0.1.1. The team then checks the published
   installer against the checksum and the build record, as for 0.1.0.
3. The owner installs 0.1.1 on Windows and runs the Windows checklist. This is the first installer with
   the reminder fix, the minimatch override and the reorganised chat window, so open Chat, Settings and
   the Welcome screen.

## Risks

- **The date.** The heading says 2026-11-16. If the tag is pushed on a later day, the date can be
  changed in a small pull request, or left as the day the version was prepared.
- **The minimatch override and the reorganised window** reach a real Windows installer for the first
  time. If the build fails, nothing is published, and Releasing says how to start again.

## Out of scope

- Any code change, and the open pull requests #18 (voice accuracy, on hold) and #7 (Node 26, on hold).
- Adding or changing any workflow file.
