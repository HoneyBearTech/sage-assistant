# Plan: release-0-2-0

## What the owner asked for

"Release": a new version with everything merged since 0.1.1, so it can be installed and tried on Windows.
The team does the version pull request (steps 2 to 4 of [Releasing](../releasing.md)); the owner makes
the release with the tag (step 6), as for 0.1.0 and 0.1.1.

## What we found

- Five changes have been merged since `v0.1.1`: the new look part 1 (#24), more online brains (#25),
  the OpenSSF badge (#26), the Home screen with a daily brief (#27) and the Welcome start-up sequence
  (#28). Four of them add features, so this is a minor release: **0.2.0**.
- `package.json` and `package-lock.json` say `0.1.1`.
- The changelog's `## [Unreleased]` part lists "Changed" before "Added"; the format the changelog follows
  puts "Added" first.
- The release workflow on `main` is the same as the copy in `docs/releasing.md`, so the release steps
  still apply as written.
- The roadmap still says 0.1.1 "waits for the owner's tag"; 0.1.1 was released on 2026-11-16 and its
  installer checked.

## What we'll change

1. **Version:** `npm version 0.2.0 --no-git-tag-version`, which sets the version in `package.json` and
   `package-lock.json` together and makes no tag.

   *Check:* both files say `0.2.0` and nothing else in them changes.
2. **`CHANGELOG.md`:** the entries under `## [Unreleased]` move under a new heading
   `## [0.2.0] - 2026-11-16`, with a new, empty `## [Unreleased]` above it, and "Added" placed before
   "Changed". The links at the bottom point `[0.2.0]` to the release's page and `[Unreleased]` to the
   changes since `v0.2.0`. The entries' wording doesn't change.

   *Check:* `npm run verify`; the entries are the same before and after (only headings, their order and
   links change).
3. **`docs/roadmap.md`:** mark 0.1.1 as released and checked, and note that 0.2.0 waits for the owner's
   tag. Add the owner's checks for 0.2.0: the "Installed app", "New look", "Home screen", "First-run
   setup" and (if wanted) "Online brains" sections of the Windows checklist.

## Who's on it

CEO, Engineer, Security Officer and Auditor. No Researcher, QA or plan check: a small change to the
version files and two documents. Releases count as security-sensitive, so the job would also get a
second security review; that reviewer isn't available this month, so the Security Officer and Auditor
check it.

## What happens after

1. The owner approves and merges this pull request.
2. The owner runs the two tag commands in step 6 of Releasing, with `v0.2.0`. GitHub builds the installer,
   its checksum and the build record, and publishes release 0.2.0. The team then checks the published
   installer against the checksum and the build record, as before.
3. The owner installs 0.2.0 on Windows and runs the Windows checklist sections above. This is the first
   installer with the new look, Home, the Welcome start-up sequence and the online brains.

## Risks

- **A big step for one installer.** Five features reach a real Windows PC for the first time, and none of
  them has been seen in a real window yet. If something is wrong, a fix goes into 0.2.1.
- **The date.** The heading says 2026-11-16. If the tag is pushed on a later day, the date can be
  changed in a small pull request, or left as the day the version was prepared.
- **Online brains cost money.** The release notes and README already say so; the owner should set a
  spending limit with a company before trying its brain.
