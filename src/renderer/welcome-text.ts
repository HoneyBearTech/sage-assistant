import {
  type ModelChoice,
  type PullResult,
  type RunnerStatus,
  SAGE_MODELS,
  type VoiceStatus,
} from "../shared/api.js";
import type { SupportCode } from "../shared/support-codes.js";

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
  supportCode: (code: SupportCode) => `Support code: ${code}`,
  diagnosticsBuilding: "Sage is putting the diagnostics together…",
  diagnosticsFailed: "Sage couldn't put the diagnostics together. Try again.",
  copied: "Copied. Paste it wherever you're asking for help; Sage hasn't sent it anywhere.",
  copyFailed: "Sage couldn't copy it. Select the text in the box and copy it yourself.",
} as const;

/**
 * One check line: what Sage looked at and what it found, from a real answer only. "ok": as hoped;
 * "fail": the check failed (a support code goes with it); "info": neither, such as a model that
 * isn't downloaded yet.
 */
export interface CheckLine {
  text: string;
  state: "ok" | "fail" | "info";
}

const line = (what: string, found: string, state: CheckLine["state"]): CheckLine => ({
  text: `${what}... ${found}`,
  state,
});

const LOOKING = "Looking for the local model runner";

/** Step 02's lines, from the runner's status (null: the request itself failed). */
export function runnerLines(status: RunnerStatus | null): CheckLine[] {
  if (!status) return [line(LOOKING, "couldn't check", "fail")];
  if (status.state === "unreachable") return [line(LOOKING, "not found", "fail")];
  if (status.state === "unreadable") return [line(LOOKING, "answered, but Sage couldn't read it", "fail")];
  const lines = [
    line(LOOKING, "found", "ok"),
    status.version
      ? line(`Runner version ${status.version}`, "ok", "ok")
      : line("Runner version", "not reported", "info"),
  ];
  for (const choice of ["standard", "smaller"] as const) {
    lines.push(
      status.downloaded[choice]
        ? line(`Model ${SAGE_MODELS[choice].name}`, "downloaded", "ok")
        : line(`Model ${SAGE_MODELS[choice].name}`, "not downloaded yet", "info"),
    );
  }
  return lines;
}

/** Step 03's lines, from the model request's result. */
export function modelLines(choice: ModelChoice, result: PullResult): CheckLine[] {
  const model = `Model ${SAGE_MODELS[choice].name}`;
  switch (result.status) {
    case "done":
      return [
        line(model, "ready", "ok"),
        result.skills === "yes"
          ? line("Skills", "supported", "ok")
          : result.skills === "no"
            ? line("Skills", "not supported by this model", "info")
            : line("Skills", "the runner didn't say", "info"),
      ];
    case "declined":
      return [line(model, "not downloaded", "info")];
    case "cancelled":
      return [line(model, "download cancelled", "info")];
    case "failed":
      return [line(model, "download failed", "fail")];
  }
}

/** Step 04's lines: the model that was found ready, and the voice status (null: couldn't check). */
export function doneLines(choice: ModelChoice, voice: VoiceStatus | null): CheckLine[] {
  return [
    line(`Model ${SAGE_MODELS[choice].name}`, "ready", "ok"),
    !voice
      ? line("Voice", "couldn't check", "info")
      : voice.model === "ready"
        ? line("Voice", "ready", "ok")
        : voice.model === "downloading"
          ? line("Voice", "downloading", "info")
          : line("Voice", "not downloaded", "info"),
  ];
}

/** What the one polite status area says for a set of new lines: all of them at once. */
export function announcement(lines: readonly CheckLine[], code?: SupportCode): string {
  const said = lines.map((item) => `${item.text}.`).join(" ");
  return code ? `${said} ${WELCOME_TEXT.supportCode(code)}.` : said;
}

function megabytes(bytes: number): string {
  return Math.round(bytes / 1_000_000).toLocaleString("en-US");
}
