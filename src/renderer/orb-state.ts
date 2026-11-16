// The orb's states, without the DOM, so the tests can check them directly. orb.ts shows them.

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

/** What is going on: you are talking, Sage is working on a reply, Sage is reading one aloud. */
export interface OrbActivity {
  listening: boolean;
  thinking: boolean;
  speaking: boolean;
}

export const ORB_CAPTIONS: Record<OrbState, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

/** When several things happen at once: your voice first, then Sage's, then thinking. */
export function orbState(activity: OrbActivity): OrbState {
  if (activity.listening) return "listening";
  if (activity.speaking) return "speaking";
  if (activity.thinking) return "thinking";
  return "idle";
}
