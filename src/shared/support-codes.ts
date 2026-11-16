// The support codes the Welcome screen shows next to a failed check, and the setup steps they belong
// to. This table is the one list of codes: the main process and the window take them from here, and
// test/support-codes.test.ts checks that docs/installing.md's Troubleshooting table has exactly these.

/**
 * Each code, with what it means in a few words. One code per failure Sage can tell apart; Sage
 * never shows a code for something it can't tell (such as "not installed" versus "not started").
 */
export const SUPPORT_CODES = {
  "SAGE-RUN-01": "The local model runner didn't answer: it isn't installed, or isn't running.",
  "SAGE-RUN-02": "The local model runner answered with something Sage couldn't read.",
  "SAGE-MOD-01": "The local model runner couldn't download the model, for a reason it didn't say.",
  "SAGE-MOD-02": "There isn't enough free disk space for the model.",
  "SAGE-MOD-03": "The local model runner couldn't find the model.",
  "SAGE-MOD-04": "A model download was already running.",
  "SAGE-NET-01": "The local model runner couldn't reach the internet to download the model.",
  "SAGE-NET-02": "The download made no progress for 2 minutes, so Sage stopped it.",
  "SAGE-SET-01": "The model is ready, but Sage couldn't save it as the local model.",
  "SAGE-APP-01": "Sage couldn't run the check (its own request failed).",
} as const;

export type SupportCode = keyof typeof SUPPORT_CODES;

export const SUPPORT_CODE_LIST = Object.keys(SUPPORT_CODES) as [SupportCode, ...SupportCode[]];

/** The runner's two failed states, as codes. */
export const RUNNER_STATE_CODES = {
  unreachable: "SAGE-RUN-01",
  unreadable: "SAGE-RUN-02",
} as const satisfies Record<string, SupportCode>;

/** The Welcome screen's four steps, with their numbered labels. */
export const SETUP_STEP_LABELS = {
  place: "01 Where Sage thinks",
  runner: "02 Model runner",
  model: "03 Model",
  done: "04 Ready",
} as const;

/** The steps that can fail, so offer Copy diagnostics. */
export const DIAGNOSTIC_STEPS = ["runner", "model"] as const;
export type DiagnosticStep = (typeof DIAGNOSTIC_STEPS)[number];
