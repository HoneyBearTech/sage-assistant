import { type ModelChoice, SAGE_MODELS } from "../shared/api.js";

// The Welcome screen's texts and steps, without the browser's objects, so the tests can check
// them directly.

export const WELCOME_STEPS = ["place", "runner", "model", "done"] as const;
export type WelcomeStep = (typeof WELCOME_STEPS)[number];

/** How often the window asks how far the model download has got. */
export const PULL_POLL_MS = 500;

export const WELCOME_TEXT = {
  checking: "Checking the local model runner…",
  unreachable:
    "Sage can't reach the local model runner. It isn't installed yet, or it isn't running. Install it and start it, then choose Check again.",
  unreadable:
    "The local model runner gave an answer Sage couldn't read. Check that it is up to date, then choose Check again.",
  running: "The local model runner is running.",
  checkFailed: "Sage couldn't check the local model runner. Choose Check again.",
  guideAsking: "Sage is asking whether to open the install guide…",
  guideOpened:
    "The install guide opened in your web browser. When the runner is installed and running, choose Check again.",
  guideDeclined: "The install guide wasn't opened.",
  guideFailed: "Sage couldn't open the install guide.",
  downloaded: "Already downloaded.",
  asking: "Sage is asking whether to download the model…",
  downloading: (completed: number, total: number) =>
    total > 0 ? `Downloading… ${megabytes(completed)} of ${megabytes(total)} MB` : "Downloading…",
  ready: (choice: ModelChoice) => `The ${SAGE_MODELS[choice].label} model is ready.`,
  declined: "The model wasn't downloaded.",
  cancelled: "Cancelled.",
  tooLate: "The download had already finished, so Sage is keeping this model.",
  failed: "Sage couldn't download the model. Try again.",
  noSkills:
    "The local model runner says this model can't use Sage's skills, so skills like notes and reminders won't work with it. Try the other model, or an online service.",
  summary: (choice: ModelChoice) =>
    `Sage will think on this computer, with the ${SAGE_MODELS[choice].label} model (${SAGE_MODELS[choice].name}).`,
  voice: "To talk to Sage, hold Ctrl+Space. Sage asks before downloading the speech file the first time.",
  notSaved: "Sage couldn't save that setup is done. Try again.",
  download: "Download",
  useModel: "Use this model",
  tryAgain: "Try again",
} as const;

function megabytes(bytes: number): string {
  return Math.round(bytes / 1_000_000).toLocaleString("en-US");
}
