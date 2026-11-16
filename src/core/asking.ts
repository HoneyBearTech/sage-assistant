import type { AskingEvent } from "../shared/api.js";
import type { ConfirmPresenter } from "./skills/gate.js";

/**
 * Wraps the box that asks before Sage acts, so the window can show what is being asked: it is told
 * when the box opens (with the very sentence the box shows) and when it closes (allowed or not).
 *
 * This is news, one way. The answer comes only from `dialog`, the main process's own box; what
 * `announce` does, returns or throws never changes it. The ids are this wrapper's own counter, not
 * the call ids the gate uses, so nothing the window holds names an approval.
 */
export function announcingPresenter(
  dialog: ConfirmPresenter,
  announce: (event: AskingEvent) => void,
): ConfirmPresenter {
  let count = 0;
  const tell = (event: AskingEvent) => {
    try {
      announce(event);
    } catch {
      // The window may be gone; the box still decides.
    }
  };
  return {
    async ask(request) {
      count += 1;
      const id = `ask-${count}`;
      tell({ id, state: "open", text: request.summary });
      let allowed = false;
      try {
        allowed = (await dialog.ask(request)) === true;
      } finally {
        tell({ id, state: "closed", allowed });
      }
      return allowed;
    },
  };
}
