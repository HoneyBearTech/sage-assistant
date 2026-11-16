# Plan: welcome-boot

## What the owner asked for

"The Welcome screen as a start-up sequence" - part 3 of the new look.

## What we found

- The design study ([docs/reports/2026-11-16-jarvis-look.md](../reports/2026-11-16-jarvis-look.md))
  describes it: the Welcome steps as numbered sections with typed check lines, plus a support code and
  **Copy diagnostics** when something fails ("small, valuable").
- The Welcome screen already has four steps: where Sage should think, the local model runner, choosing a
  model, and done. The checks behind them are real: the runner's status, the model download and the
  voice status.
- When a step fails today, the user sees a plain sentence but has nothing to send when asking for help.

## What we'll change

1. **Numbered sections.** The four steps get mono labels ("01 Where Sage thinks", "02 Model runner",
   "03 Model", "04 Ready") and the new look's panel style. The flow, buttons and Skip setup stay the same.
   Checked by: window tests for each step, focus and keyboard use.
2. **Typed check lines.**
   - **Each step shows its real checks as short typed lines**, for example "Looking for the local model
     runner... found" or "Model qwen3:4b... ready". Every line reports a real check result; there is no
     made-up progress.
   - **Reduced motion:** the lines appear at once.
   - **Screen readers** hear them through a polite status area.

   Checked by: tests that each line matches the check's real result, and the reduced-motion test.
3. **Support codes.**
   - **When a check fails, Sage shows a short support code** next to the plain sentence, for example
     `SAGE-RUN-01` for "the runner isn't installed or isn't running".
   - **A table of codes in the docs** gives the cause and what to try. It goes in a new "Troubleshooting" section
     of `docs/installing.md`, linked from the README.

   Checked by: a test that every code the app can show is in the docs table, and no code appears twice.
4. **Copy diagnostics.**
   - **A button on a failed step.** It copies a plain text block to the clipboard: Sage's version, the
     system and its version, the step and support code, the brain chosen (never a key or an online
     address), whether the runner answered and its version, whether the model is present, and the voice
     status.
   - **Built by Sage itself and shown in full** in a small box before copying, so the user sees exactly
     what they would share.
   - **Leaves out personal details:** no user names in paths, no keys, no notes or reminders, no email
     addresses.
   - **Copied only on a click.** Nothing is sent anywhere.

   Checked by: tests that the text contains each expected line and none of a planted key, home path,
   email address or note text.
5. **Docs and preview.**
   - README, CHANGELOG, the architecture notes, the assurance case (the copy request) and the Windows
     checklist's "First-run setup" section.
   - An update to the review-only preview page.

## Who's on it

Engineer, QA, Security Officer, Auditor, and a plain-English check of the final report. No Researcher: the
part 1 study covers the design.

## Risks

- **Copied diagnostics could carry something private** if a field is added carelessly later. The text is
  built from a fixed list of fields and a test plants private values to prove they stay out.
- **This job changes the same window files as the Home screen job.** It starts only after that job is
  merged.

## Out of scope

- Sending diagnostics anywhere (Sage has no telemetry and keeps it that way).
- A start-up sequence on every launch (only the Welcome screen changes).
- Spoken greetings or voice clips.
