# Plan: notice-recollect

## What the owner asked for

"Move to the next roadmap item": "Minor: re-collect window notices before showing them when Chat opens.
This stops a just-deleted reminder from showing once."

## What we found

- Reminders that can't be shown as a Windows notification go to the chat window as notices. The window
  collects them every 5 seconds, holds them while Settings is open, and confirms them once Chat is on
  screen (`src/renderer/renderer.ts`).
- When a reminder is deleted while its notice is held, the next collection takes the notice out before
  anyone sees it. But opening Chat confirms held notices straight away, without collecting first. So if
  the user deletes a due reminder from Settings and opens Chat within 5 seconds, the deleted reminder
  can appear once. The decisions log recorded this as minor and probably unreachable in the real app.
- The same happens when the window comes back from being minimised.

## What we'll change

1. **Collect before confirming.** Opening Chat, and the window coming back into view, collect the
   notices again first, then confirm what is still there. Only one collection runs at a time: if one is
   already on its way when Chat opens, another follows right after it, so an older answer can never
   bring back a notice a newer one took out.

   *Check:* a window test for the recorded sequence (a reminder comes due while Settings is open, it is
   deleted, and Chat opens before the next 5-second collection): the deleted reminder never appears.
   Tests that a collection still running when Chat opens is followed by a fresh one, and that the
   existing notice tests still pass.
2. **Notes.** The roadmap item is ticked, the decisions log's open point is closed, and the changelog
   gets an entry under "Unreleased".

   *Check:* `npm run verify`.

## Who's on it

CEO, Engineer, Security Officer and Auditor. No Researcher, QA or plan check: a small change in one file
of the window, with its tests.

## Risks

- Opening Chat asks Sage for the notices once more; that's a small, local request.
- The notice code is subtle (earlier reviews found several narrow cases). The tests cover each recorded
  case, and the Auditor checks the new order of steps.

## Out of scope

- Any change to how reminders are stored, delivered or deleted in the main process.
- The 5-second collection interval.
