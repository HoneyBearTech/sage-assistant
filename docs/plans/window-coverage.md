# Plan: window-coverage

## What the owner asked for

"Start the next one": the roadmap item "Test coverage counting: each window test loads the window
script again, and each load counts as a separate, partly covered file, so the total drifts toward the
80% floor as window tests are added. Count the window script once."

## What we found

- `npm run verify` fails if the tests exercise less than 80% of the code's lines (the coverage floor).
  Today the total is 86.4%.
- The chat window's script (`src/renderer/renderer.ts`) does all its work the moment it's loaded. To
  give each test a fresh window, the test helper (`test/window.ts`) loads a new copy of the file for
  every window test.
- The coverage report can't add those copies up properly. It shows `renderer.ts` at 79.9% of lines and
  40% of functions, and lists lines as never run that every window test runs, such as the very first
  helper the script calls. So the window's real coverage is hidden, and the total slips a little with
  every new window test.
- The other window files (`voice.ts`, `welcome.ts`, `voice-controls.ts`) are already built as functions
  the window calls, are loaded once, and are counted correctly (93-100%).

## What we'll change

1. **Make the window script a function.** Move the work `renderer.ts` does when loaded into one exported
   function, `startChatWindow()`, the same way the other window files work. A new two-line file,
   `src/renderer/main.ts`, calls it, and the build bundles that file into the same `renderer.js` the
   window already loads. The window does exactly what it did before, in the same order; only where the
   code sits changes.

   *Check:* `npm run build` produces `dist/renderer/renderer.js` as before; the existing window tests pass
   unchanged in what they check; the test that no text is inserted as HTML still covers the window files.
2. **Load the window script once in tests.** `test/window.ts` imports `renderer.ts` once and calls
   `startChatWindow()` for each test on a fresh fake window, instead of loading a new copy each time.

   *Check:* `npm run test:coverage` lists `renderer.ts` once, with its real figures; lines every test runs
   are no longer listed as uncovered; the before and after reports are recorded in the notes. The total
   should go up, and adding a window test should no longer lower it.
3. **Notes.** Tick the roadmap item, and add a changelog entry under "Unreleased". Add a short line in
   `CONTRIBUTING.md`, where tests are described, saying window code is written as functions the tests
   call, not code that runs on load.

   *Check:* `npm run verify`.

## Who's on it

CEO, Engineer, QA, Security Officer and Auditor. No Researcher: the CEO did the research above.

## Risks

- **Moving the code could change how the window behaves**, for example if something now runs in a
  different order. The move keeps the same order, the window tests cover it, and the Auditor checks it.
  CI can't open the real window, so the owner should open Sage once after the next install and check the
  chat, Settings and Welcome screens as usual.
- **The diff looks big**, because the moved code is indented one more level. Reviewers compare it with
  indentation ignored.

## Out of scope

- Raising the 80% floor.
- New tests for the window (this fixes the counting only).
- Any change to what Sage does.
