# Plan: minimatch-advisory

## What the owner asked for

"Start the next one": the roadmap item "Track the minimatch advisory (GHSA-g3hv-75wg-m249) in
electron-builder's build tools, and take the electron-builder update that fixes it."

## What we found

- The advisory is a moderate denial-of-service in minimatch (a file-pattern matcher) from 7.0.0 up
  to 11.0.1. `npm audit` reports it as 6 moderate findings, all through the installer build tools
  (electron-builder). Two of our copies are affected: 10.2.6 (used to pick which files go into the
  installer) and 9.0.9 (inside the tool that merges macOS builds, which Sage doesn't use). The other
  copies (3.1.5, 5.1.9) are older lines the advisory doesn't cover.
- **No electron-builder update fixes it yet.** The newest 26 release still asks for minimatch 10, and
  so does the 27 preview. Waiting could take a long time.
- minimatch 11 still works with the build tools: it can still be loaded the way they load it, and the
  parts they use are still there. minimatch 11 removed some functions, but the build tools don't use
  them.
- The earlier security reviews found the code runs only at build time, on file patterns this repo
  writes, so it can't be reached by anyone else. The risk is small; this job is about clearing the
  warning safely, not an urgent fix.

## What we'll change

1. **Make the build tools use a fixed minimatch.** Add an npm `overrides` entry in `package.json`
   that makes the two affected copies use minimatch 11 (11.0.1 or later), then refresh
   `package-lock.json` with `npm install`. Nothing else in the dependency tree changes. Leave the older
   3.x and 5.x copies alone.

   *Check:* `npm audit` reports no minimatch findings; `npm ls minimatch` shows minimatch 11 where 10.2.6
   and 9.0.9 were; the lockfile diff is limited to those packages.
2. **Prove the installer still gets the same files.** Build the unpacked Windows app
   (`npm run dist:dir`) before and after the change and compare the list of files inside the packaged
   app (`app.asar`) and the unpacked folder. They must match exactly.

   *Check:* the file lists match; `npm run verify` passes; the GitHub checks pass on Linux and Windows.
3. **Notes.** Say in `CONTRIBUTING.md` (its "Reviewing a Renovate update" section) why the override is
   there and when to remove it: as soon as electron-builder itself asks for a fixed minimatch, delete the
   override and refresh the lockfile. Update the roadmap item, and add a changelog entry under
   "Unreleased".

   *Check:* `npm run verify`.

## Who's on it

CEO, Engineer, QA, Security Officer, Second Security Reviewer and Auditor. No Researcher: the CEO did the
research above. This is a dependency change, so it counts as security-sensitive and gets two security
reviews.

## Risks

- **The installer could quietly change** if minimatch 11 matched file patterns differently. Step 2's
  before-and-after comparison is there to catch that. The real Windows installer is built only when a
  release is tagged, so the owner should install the next release and check it starts, as usual.
- **The override can outlive its need.** Renovate updates electron-builder; the note in step 3 says when
  to remove it.

## Out of scope

- Moving to the electron-builder 27 preview.
- Any other dependency update.
- A new release; this goes into the next one.

If you'd rather wait for electron-builder to fix this itself, close this pull request: the roadmap item
stays open and nothing changes.
