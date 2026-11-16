import {
  type CancelPullResult,
  type GuideResult,
  type ModelChoice,
  type PullResult,
  type PullStatus,
  type Result,
  type RunnerStatus,
  SAGE_MODELS,
} from "../shared/api.js";
import { hasModel, PULL_MESSAGES, pullCode, type RunnerClient } from "./brain/runner.js";
import type { Logger } from "./log.js";
import type { SettingsStore } from "./settings.js";
import type { Timers } from "./voice/download.js";

/**
 * The one address Sage can open in the web browser: the local model runner section of Sage's own
 * install guide. It is fixed here; nothing from the window, a reply or a web page can change it.
 */
export const INSTALL_GUIDE_URL =
  "https://github.com/HoneyBearTech/sage-assistant/blob/main/docs/installing.md#local-model-runner";

/** The main process's box before a model download. */
export function pullQuestion(choice: ModelChoice): string {
  const model = SAGE_MODELS[choice];
  return `Download the ${model.label} model (${model.size})?`;
}
export const PULL_DETAIL =
  "This needs an internet connection and free disk space. The local model runner downloads the model and checks its files; it can take a while. You can cancel at any time. Once it is downloaded, Sage will use it on this computer: the brain in Settings switches to On this computer.";

/** The main process's box before the install guide opens. */
export const GUIDE_QUESTION = "Open Sage's install guide in your web browser?";
export const GUIDE_DETAIL = `It shows how to install and start the local model runner. Sage will open ${INSTALL_GUIDE_URL}`;

export const SETUP_MESSAGES = {
  alreadyDownloading: "A model is already downloading.",
  notSaved: "The model is ready, but Sage couldn't save it as the local model. Try again.",
  guideFailed: `Sage couldn't open your web browser. The install guide is at ${INSTALL_GUIDE_URL}`,
  notMarked: "Sage couldn't save that setup is done. Try again.",
} as const;

/** The model a request tried: one of Sage's two, and whether it was there but couldn't be saved. */
export interface TriedModel {
  choice: ModelChoice;
  saveFailed: boolean;
}

export interface SetupDeps {
  settings: SettingsStore;
  runner: RunnerClient;
  logger: Logger;
  /** The main process's own box before a download; true only when the user chose Download. */
  confirmPull: (choice: ModelChoice) => Promise<boolean>;
  /** The main process's own box before the install guide opens; true only for Open. */
  confirmOpenGuide: () => Promise<boolean>;
  /** Opens an address in the web browser (Electron's shell.openExternal). */
  openExternal: (url: string) => Promise<void>;
  /** Called when a download switched the brain (to local), so a turn on the old one stops. */
  brainChanged?: () => void;
  /** For tests: the stall limit's timer. */
  timers?: Timers;
  stallMs?: number;
}

/**
 * First-run setup in the main process: the local model runner's status, downloading one of Sage's
 * two models through the runner (only after the user agrees in the main process's box, one at a
 * time), opening the install guide, and marking setup as done. Each saves only its own settings.
 */
export class Setup {
  /**
   * The model request in progress, from its first step (asking the runner for its models) to its
   * last (saving the model). Cancel, Skip and quitting abort it at whichever step it is on.
   */
  private pull:
    | {
        controller: AbortController;
        transferring: boolean;
        completed: number;
        total: number;
        /** Set when the save starts: the commit point, after which a cancel no longer applies. */
        saving?: Promise<unknown>;
      }
    | undefined;

  /**
   * The model the last request tried, from the closed choice, for Copy diagnostics: set when a
   * request starts, marked when the model was there but couldn't be saved, cleared on success.
   */
  private attempt: TriedModel | null = null;

  constructor(private readonly deps: SetupDeps) {}

  /** The model the last model request tried and didn't finish with, or null. */
  triedModel(): TriedModel | null {
    return this.attempt ? { ...this.attempt } : null;
  }

  async status(): Promise<RunnerStatus> {
    const model = (await this.deps.settings.load()).local.model;
    const list = await this.deps.runner.models();
    if (!list.ok) {
      return { state: list.reason, model, downloaded: { standard: false, smaller: false }, version: null };
    }
    return {
      state: hasModel(list.names, model) ? "ready" : "no-model",
      model,
      downloaded: {
        standard: hasModel(list.names, SAGE_MODELS.standard.name),
        smaller: hasModel(list.names, SAGE_MODELS.smaller.name),
      },
      version: await this.deps.runner.version(),
    };
  }

  pullStatus(): PullStatus {
    return this.pull?.transferring
      ? { downloading: true, completed: this.pull.completed, total: this.pull.total }
      : { downloading: false, completed: 0, total: 0 };
  }

  /**
   * Has the runner download one of Sage's models, after asking. A model the runner already has
   * needs no download. Only once the model is there is it saved as the local model (and the brain
   * set to local, which stops a turn running against the online service). A cancel at any step,
   * even while the box is open or the save is waiting for the settings lock, saves nothing.
   */
  async pullModel(choice: ModelChoice): Promise<PullResult> {
    if (this.pull) {
      return { status: "failed", message: SETUP_MESSAGES.alreadyDownloading, code: "SAGE-MOD-04" };
    }
    const current = { controller: new AbortController(), transferring: false, completed: 0, total: 0 };
    this.pull = current;
    this.attempt = { choice, saveFailed: false };
    const signal = current.controller.signal;
    try {
      const model = SAGE_MODELS[choice].name;
      const list = await this.deps.runner.models(signal);
      if (signal.aborted) return { status: "cancelled" };
      if (!list.ok) {
        const message = list.reason === "unreachable" ? PULL_MESSAGES.unreachable : PULL_MESSAGES.unreadable;
        return { status: "failed", message, code: pullCode(message) };
      }
      if (!hasModel(list.names, model)) {
        let agreed: boolean;
        try {
          agreed = await this.deps.confirmPull(choice);
        } catch {
          agreed = false;
        }
        // Cancelled (or skipped) while the box was open: no download, whatever the answer.
        if (signal.aborted) return { status: "cancelled" };
        if (!agreed) return { status: "declined" };
        current.transferring = true;
        const outcome = await this.deps.runner.pull(model, {
          signal,
          onProgress: (progress) => {
            current.completed = progress.completed;
            current.total = progress.total;
          },
          ...(this.deps.timers ? { timers: this.deps.timers } : {}),
          ...(this.deps.stallMs ? { stallMs: this.deps.stallMs } : {}),
        });
        current.transferring = false;
        if (outcome.status === "cancelled") return outcome;
        if (outcome.status === "failed") {
          this.deps.logger.warn(`A model download failed: ${outcome.message}`);
          return { ...outcome, code: pullCode(outcome.message) };
        }
        this.deps.logger.info(`The local model runner downloaded ${model}.`);
      }
      const result = await this.useModel(model, current);
      if (result.status === "done") this.attempt = null;
      else if (result.status === "failed" && result.code === "SAGE-SET-01") {
        this.attempt = { choice, saveFailed: true };
      }
      return result;
    } catch (error) {
      // A fixed line only: nothing from the runner (or an error carrying its text) reaches the log.
      this.deps.logger.warn(`A model download failed unexpectedly (${errorName(error)}).`);
      return { status: "failed", message: PULL_MESSAGES.other, code: pullCode(PULL_MESSAGES.other) };
    } finally {
      if (this.pull === current) this.pull = undefined;
    }
  }

  /**
   * Saves the model as the local model, unless the request was cancelled before this point; then
   * the skills check. Starting the save is the commit point: from then on a cancel is too late
   * (cancelPull says so), and finish() waits for the save before marking setup done. A write in
   * progress is never undone.
   */
  private async useModel(model: string, current: NonNullable<Setup["pull"]>): Promise<PullResult> {
    if (current.controller.signal.aborted) return { status: "cancelled" };
    const saving = this.deps.settings.update((settings) => ({
      ...settings,
      brain: "local",
      local: { ...settings.local, model },
    }));
    current.saving = saving.catch(() => undefined);
    let saved: Awaited<typeof saving>;
    try {
      saved = await saving;
    } catch (error) {
      this.deps.logger.warn(`The local model couldn't be saved (${errorName(error)}).`);
      return { status: "failed", message: SETUP_MESSAGES.notSaved, code: "SAGE-SET-01" };
    }
    if (!saved.ok) return { status: "failed", message: SETUP_MESSAGES.notSaved, code: "SAGE-SET-01" };
    // A turn started against the online service stops, as when Settings changes the brain.
    if (saved.previous.brain !== saved.settings.brain) this.deps.brainChanged?.();
    const tools = await this.deps.runner.toolSupport(model);
    return { status: "done", skills: tools === "tools" ? "yes" : tools === "no-tools" ? "no" : "unknown" };
  }

  /**
   * Stops the model request at whatever step it is on, up to the commit point (the save starting).
   * "too-late": the model is already being saved as the local model, and stays chosen. Whether the
   * runner keeps part of a cancelled download is up to it.
   */
  cancelPull(): CancelPullResult {
    const current = this.pull;
    if (!current) return "idle";
    if (current.saving) return "too-late";
    current.controller.abort(new Error("cancelled"));
    return "cancelled";
  }

  /** Asks first, then opens the one fixed address of the install guide. */
  async openInstallGuide(): Promise<GuideResult> {
    let agreed: boolean;
    try {
      agreed = await this.deps.confirmOpenGuide();
    } catch {
      agreed = false;
    }
    if (!agreed) return { status: "declined" };
    try {
      await this.deps.openExternal(INSTALL_GUIDE_URL);
      return { status: "opened" };
    } catch {
      this.deps.logger.warn("The web browser couldn't be opened for the install guide.");
      return { status: "failed", message: SETUP_MESSAGES.guideFailed, address: INSTALL_GUIDE_URL };
    }
  }

  /** Setup was finished or skipped: a model request still running is cancelled, and only this one setting changes. */
  async finish(): Promise<Result> {
    // A model request before its commit point is cancelled; a save already started is let finish,
    // so "set up" is written after it, never in the middle of it.
    const saving = this.pull?.saving;
    this.cancelPull();
    if (saving) await saving;
    try {
      const saved = await this.deps.settings.update((current) => ({ ...current, setupDone: true }));
      return saved.ok ? { ok: true } : { ok: false, message: SETUP_MESSAGES.notMarked };
    } catch (error) {
      this.deps.logger.warn(`Setup couldn't be marked as done (${errorName(error)}).`);
      return { ok: false, message: SETUP_MESSAGES.notMarked };
    }
  }

  /** When Sage closes: stops a download. */
  dispose(): void {
    this.cancelPull();
  }
}

/** The kind of error only (its name), never its message, which could carry outside text. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
