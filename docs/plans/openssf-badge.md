# Plan: openssf-badge

## What the owner asked for

"Adding the OpenSSF badge to the README."

## What we found

- Sage has an OpenSSF Best Practices project (number 16810) at
  https://www.bestpractices.dev/projects/16810, but the README shows no badge yet.
- The README starts with the Sage icon and the title; the checks already running on GitHub (including the
  OpenSSF Scorecard) are described further down and in `docs/github-checks.md`.
- The badge shows the project's current level ("in progress" until the questionnaire on bestpractices.dev
  is complete). Only the owner can fill in that questionnaire, because it needs his sign-in.

## What we'll change

1. **README:** add the OpenSSF Best Practices badge under the title, linking to the project page, with
   plain alt text. Checked by: the public-repo check and the README still reading well on GitHub.
2. **docs/github-checks.md:** one short paragraph saying what the badge means, where its page is, and that
   the owner keeps the questionnaire up to date. Checked by: `npm run verify`.

## Who's on it

Engineer, Security Officer, Auditor. No Researcher or QA: this is a two-file text change.

## Risks

- The badge image comes from bestpractices.dev, so it only shows what that site says. Nothing in Sage
  itself changes.

## Out of scope

- Filling in the questionnaire (the owner's, on bestpractices.dev). If useful, a later job can prepare
  suggested answers for each question from the repo.
- Other badges (for example the Scorecard badge).
