# Plan: windows-installer

## What the owner asked for

"Start the installer job": the next roadmap item, a one-click Windows installer for Sage.

## What we found

- Sage builds into `dist/` and runs from source today. A packaged app needs only `dist/` and
  `package.json`. zod, the library Sage uses to check data, is already bundled into `dist/main.cjs`.
- electron-builder (version 26.18.1) can make a one-click Windows installer (NSIS) that installs for
  the current user without asking for admin rights, adds Start-menu and desktop shortcuts, and sets
  Electron's hardening switches ("fuses") itself, right before any signing step. A test build of the
  unpacked Windows app on the review machine worked, and the fuses read back as set.
- The installer file itself can only be built on Windows (on Linux it needs extra software the review
  machine doesn't have). So it is built on the owner's PC for testing, and by a release workflow that
  the owner adds on GitHub.
- electron-builder brings about 276 packages. One of them, `electron-winstaller`, has an install
  script (setup code that runs during `npm install`); the installer type we use doesn't need it, so it
  is turned off. One small package (`truncate-utf8-bytes`) uses the WTFPL licence, which the
  Dependency review check doesn't allow yet, so that check will probably fail until the owner allows it
  (step 7).

## What we'll change

1. **Add electron-builder 26.18.1** as an exact-version build tool (a dev dependency), and fix the
   moderate warning it brings in (`npm audit fix`, no breaking changes).
   - Add `"electron-winstaller@5.4.0": false` to `allowScripts` in `package.json`, so its setup code
     never runs.
   - Move zod from `dependencies` to `devDependencies`. It is already built into Sage, so the installer
     doesn't need a second copy.
   - Add a Renovate note for electron-builder updates: check whether the `electron-winstaller` version
     changed, and update the `allowScripts` entry if it did.

   *Check:* after `npm audit fix`, every version in `package.json` is still exact, `npm audit` shows
   nothing, `npm install-scripts ls` shows nothing unreviewed, and `npm run verify` passes.
2. **The installer settings** in a new `electron-builder.json`:
   - app id `com.honeybeartech.sage`, the same one Sage already uses for its notifications;
   - the name "Sage" for the installer, the shortcuts and `Sage.exe`, set only in this file. Sage's data
     folder stays `%APPDATA%\sage-assistant`, so a copy run from source and the installed app share the
     same notes, reminders, settings and key;
   - one click, for the current user only, with shortcuts, and Sage starts when it's installed;
   - uninstalling keeps Sage's data;
   - the file is named `Sage-Setup-<version>.exe` and is written to `out/`, so it doesn't clash with
     `dist/`. No extra update files are made (those are for automatic updates, which come later);
   - only `dist/` and `package.json` go into the app's archive. Source maps, the debugging files that
     map the built app back to its source, are left out;
   - the fuses, matching `src/main/fuses-config.ts`.

   *Check:* an unpacked Windows build on the review machine. Read the fuses back from `Sage.exe`, list
   the archive's contents, and check that the `package.json` inside it still has the name
   `sage-assistant` (that name sets the data folder).
3. **Two more fuses**, as the roadmap asked:
   - `GrantFileProtocolExtraPrivileges` off. Pages loaded from a file on the PC normally get some
     extra powers that web pages don't have. Sage's window is loaded from its own files and doesn't need
     them, but this has to be tested: if it blocks the window's script or styles, the window would show
     up blank or unstyled.
   - `EnableCookieEncryption` on. Sage keeps no cookies, so this is just a safety net.

   They are added to `src/main/fuses-config.ts`, its test and the installer settings, and a new test
   checks that the installer settings and `fuses-config.ts` never drift apart. electron-builder now sets
   the fuses, so the old `npm run fuses` script (`scripts/fuses.ts`) is removed, along with the
   comments and docs that mention it.

   *Check:* the tests, and the owner's Windows run in step 8. If the window doesn't load with the first
   fuse off, it comes back out and the reason is recorded.
4. **New commands.** Both build the app first (`npm run build`), then package it:
   - `npm run dist` builds the Windows installer. It works only on Windows.
   - `npm run dist:dir` builds the unpacked Windows app, without an installer. It also works on Linux,
     for checks.

   `out/` stays out of git. *Check:* `npm run dist:dir` succeeds on the review machine. `npm run dist`
   is checked on Windows in step 8.
5. **Release workflow, as ready-to-paste text** in a new `docs/releasing.md`. The team may not add
   workflows, so the owner adds it. The workflow:
   - runs when a version tag such as `v0.1.0` is pushed;
   - runs `npm run verify` on a Windows runner;
   - checks the tag matches the version in `package.json`, then builds the installer;
   - writes a `SHA256SUMS.txt` checksum file;
   - makes a signed record from GitHub of how and where the installer was built (build provenance). It
     is kept in GitHub's attestations list and also attached to the release as a file;
   - publishes exactly three files on the GitHub Releases page: the installer, the checksum file and
     the provenance file.

   Each part of the workflow gets only the permissions it needs, and only the publishing step may
   write to the repo. Every action is pinned to an exact commit, so a moved version label can't swap
   what runs. The page also explains, step by step, how the owner makes a release.
6. **Docs:**
   - `docs/installing.md`: install from the Releases page, check the checksum, get past SmartScreen
     ("More info", then "Run anyway"), update and uninstall;
   - `docs/windows-checklist.md`: a new "Installed app" section. Install, then check the shortcut, that
     the window shows styled and working (a reply comes back and Settings opens), that notes from a
     source copy are still there, a notification, updating in place, and that uninstalling keeps data;
   - `docs/architecture.md` and `docs/assurance-case.md`: the packaging notes and threat T5;
   - `docs/github-checks.md` and `docs/README.md`: point to the release workflow;
   - `GOVERNANCE.md` (the build adds no secrets or signing keys yet) and `SUPPORT.md` (releases from now
     on follow version numbers, and only the latest is supported);
   - the README, the repo's guidelines, CONTRIBUTING (the electron-winstaller install script in the
     Renovate checklist) and CHANGELOG;
   - the job's notes: `docs/roadmap.md`, `docs/decisions-log.md` and `docs/pass-map.md`.
7. **For the owner, on GitHub (the team can't do these):**
   - If the Dependency review check fails on the WTFPL licence, add `WTFPL` to the `allow-licenses`
     list in `.github/workflows/dependency-review.yml`, on `main`. The team then brings `main` into
     this branch, so the check runs again with the new list.
   - After merging, add the release workflow from `docs/releasing.md`.
8. **Before final approval, on the owner's Windows PC:** build with `npm run dist` from this branch,
   install it, and run the new "Installed app" checklist section. This is the only way to test the real
   installer before the release workflow exists.

## Who's on it

Plan check, Engineer, QA, Security Officer, second security review, Auditor, plain-English check.

## Risks

- **The real installer can't be built or tested on the review machine**, only the unpacked app. The
  owner's Windows run (step 8) covers it.
- **SmartScreen warns about the unsigned installer.** Signing costs money and is on the roadmap for
  later.
- **The release workflow can't be run before the owner adds it.** The first tagged release is its first
  real run. If it fails, the fix is a small follow-up.
- **The new fuse for the window's files may stop the window from loading.** If so, step 3 takes it out.
- **electron-builder is a large new set of build tools.** It is used only to build, never shipped inside
  Sage, and Renovate keeps it updated with the same checks as everything else.

## Out of scope

- Code signing and automatic updates (roadmap: later).
- An app icon. The installer uses Electron's default icon for now; a Sage icon can be its own small job.
- Windows on ARM, macOS and Linux packages.
- Changing any GitHub workflow or setting (the owner's, see step 7).
