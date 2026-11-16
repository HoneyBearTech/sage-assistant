// Sage's orb: its presence. It shows one of four states, set here as data-state on each drawing of
// the orb (styles.css draws and animates each one) and as a word underneath it. There is one state
// and two drawings, the small one above the message box and the large one on Home, so they always
// agree. The animation is paused while the window is hidden or minimised.

import { type OrbActivity, type OrbState, ORB_CAPTIONS, orbState } from "./orb-state.js";

export interface Orb {
  /** Changes part of the activity; every drawing shows the state that follows from all of it. */
  update(change: Partial<OrbActivity>): void;
  readonly state: OrbState;
}

/** One drawing of the orb and the word under it. */
export interface OrbDrawing {
  orb: HTMLElement;
  caption: HTMLElement;
}

export function createOrb(drawings: readonly OrbDrawing[]): Orb {
  const activity: OrbActivity = { listening: false, thinking: false, speaking: false };
  let state: OrbState = "idle";

  function render(): void {
    for (const { orb, caption } of drawings) {
      orb.setAttribute("data-state", state);
      caption.textContent = ORB_CAPTIONS[state];
    }
  }

  // Nobody sees a hidden window, so nothing in it needs to move.
  function pauseWhenHidden(): void {
    for (const { orb } of drawings) orb.classList.toggle("paused", document.visibilityState === "hidden");
  }
  document.addEventListener("visibilitychange", pauseWhenHidden);

  render();
  pauseWhenHidden();
  return {
    update(change) {
      Object.assign(activity, change);
      const next = orbState(activity);
      if (next === state) return;
      state = next;
      render();
    },
    get state() {
      return state;
    },
  };
}
