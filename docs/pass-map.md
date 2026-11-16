# Pass map

Which change shipped in which pull request.

| Date | Job | What shipped (or was found) | PR |
|---|---|---|---|
| 2026-11-15 | sage-foundation | Text-chat Sage as an Electron app run from source: switchable brain (local runner or online service), web search, notes and reminders, open app or file with ask-first, encrypted key, locked-down window, project files, `npm run verify`, docs and a survey of similar projects. After the owner's "fix" feedback, one minor item is still open (see the decisions log). | [#1](https://github.com/HoneyBearTech/sage-assistant/pull/1) |
| 2026-11-16 | renovate | Renovate for npm and GitHub Actions: weekly updates, security fixes at once, exact pins, SHA-pinned actions, a 3-day wait for new npm releases, Electron majors on their own. The docs now record the GitHub checks the owner added (`docs/github-checks.md`). | [#6](https://github.com/HoneyBearTech/sage-assistant/pull/6) |
| 2026-11-16 | biome-2-6-8 | Biome 2.6.8 (replaces Renovate's #4). Biome's new Markdown formatter is turned off, so the hand-written docs stay as they are; the schema line and the docs that name the version are updated. | [#8](https://github.com/HoneyBearTech/sage-assistant/pull/8) |
| 2026-11-16 | windows-installer | A one-click, per-user Windows installer (`npm run dist`, electron-builder NSIS) that keeps Sage's data folder; all seven fuses set by the build, with a drift test; the release workflow (checksum, build provenance, main-only tags) as ready-to-paste text in `docs/releasing.md`; install, update and uninstall docs and an "Installed app" checklist. | [#9](https://github.com/HoneyBearTech/sage-assistant/pull/9) |
