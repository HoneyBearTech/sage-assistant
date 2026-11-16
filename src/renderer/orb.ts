// The orb above the message box: Sage's presence. It shows one of four states, set here as
// data-state on the orb (styles.css draws and animates each one) and as a word underneath it.
// Its animation is paused while the window is hidden or minimised.

import { type OrbActivity, type OrbState, ORB_CAPTIONS, orbState } from "./orb-state.js";

export interface Orb {
  /** Changes part of the activity; the orb shows the state that follows from all of it. */
  update(change: Partial<OrbActivity>): void;
  readonly state: OrbState;
}

export function createOrb(orb: HTMLElement, caption: HTMLElement): Orb {
  const activity: OrbActivity = { listening: false, thinking: false, speaking: false };
  let state: OrbState = "idle";

  function render(): void {
    orb.setAttribute("data-state", state);
    caption.textContent = ORB_CAPTIONS[state];
  }

  // Nobody sees a hidden window, so nothing in it needs to move.
  function pauseWhenHidden(): void {
    orb.classList.toggle("paused", document.visibilityState === "hidden");
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
