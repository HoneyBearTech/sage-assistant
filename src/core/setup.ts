import {
  type GuideResult,
  type ModelChoice,
  type PullResult,
  type PullStatus,
  type Result,
  type RunnerStatus,
  SAGE_MODELS,
} from "../shared/api.js";
import { hasModel, PULL_MESSAGES, type RunnerClient } from "./brain/runner.js";
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
  "This needs an internet connection and free disk space. The local model runner downloads the model and checks its files; it can take a while. You can cancel at any time.";

/** The main process's box before the install guide opens. */
export const GUIDE_QUESTION = "Open Sage's install guide in your web browser?";
export const GUIDE_DETAIL = `It shows how to install and start the local model runner. Sage will open ${INSTALL_GUIDE_URL}`;

export const SETUP_MESSAGES = {
  alreadyDownloading: "A model is already downloading.",
  notSaved: "The model is ready, but Sage couldn't save it as the local model. Try again.",
  guideFailed: `Sage couldn't open your web browser. The install guide is at ${INSTALL_GUIDE_URL}`,
  notMarked: "Sage couldn't save that setup is done. Try again.",
} as const;

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
  private pull: { controller: AbortController; completed: number; total: number } | undefined;

  constructor(private readonly deps: SetupDeps) {}

  async status(): Promise<RunnerStatus> {
    const model = (await this.deps.settings.load()).local.model;
    const list = await this.deps.runner.models();
    if (!list.ok) return { state: list.reason, model, downloaded: { standard: false, smaller: false } };
    return {
      state: hasModel(list.names, model) ? "ready" : "no-model",
      model,
      downloaded: {
        standard: hasModel(list.names, SAGE_MODELS.standard.name),
        smaller: hasModel(list.names, SAGE_MODELS.smaller.name),
      },
    };
  }

  pullStatus(): PullStatus {
    return this.pull
      ? { downloading: true, completed: this.pull.completed, total: this.pull.total }
      : { downloading: false, completed: 0, total: 0 };
  }

  /**
   * Has the runner download one of Sage's models, after asking. A model the runner already has
   * needs no download. Only once the model is there is it saved as the local model.
   */
  async pullModel(choice: ModelChoice): Promise<PullResult> {
    if (this.pull) return { status: "failed", message: SETUP_MESSAGES.alreadyDownloading };
    const model = SAGE_MODELS[choice].name;
    const list = await this.deps.runner.models();
    if (!list.ok) {
      return {
        status: "failed",
        message: list.reason === "unreachable" ? PULL_MESSAGES.unreachable : PULL_MESSAGES.unreadable,
      };
    }
    if (!hasModel(list.names, model)) {
      let agreed: boolean;
      try {
        agreed = await this.deps.confirmPull(choice);
      } catch {
        agreed = false;
      }
      if (!agreed) return { status: "declined" };
      // The box may have been answered twice over; one download only.
      if (this.pull) return { status: "failed", message: SETUP_MESSAGES.alreadyDownloading };
      const current = { controller: new AbortController(), completed: 0, total: 0 };
      this.pull = current;
      try {
        const outcome = await this.deps.runner.pull(model, {
          signal: current.controller.signal,
          onProgress: (progress) => {
            current.completed = progress.completed;
            current.total = progress.total;
          },
          ...(this.deps.timers ? { timers: this.deps.timers } : {}),
          ...(this.deps.stallMs ? { stallMs: this.deps.stallMs } : {}),
        });
        if (outcome.status !== "done") {
          if (outcome.status === "failed")
            this.deps.logger.warn(`A model download failed: ${outcome.message}`);
          return outcome;
        }
        this.deps.logger.info(`The local model runner downloaded ${model}.`);
      } catch (error) {
        this.deps.logger.error("A model download failed", error);
        return { status: "failed", message: PULL_MESSAGES.other };
      } finally {
        this.pull = undefined;
      }
    }
    // Only the model and the brain change; everything else stays as saved.
    try {
      const saved = await this.deps.settings.update((current) => ({
        ...current,
        brain: "local",
        local: { ...current.local, model },
      }));
      if (!saved.ok) return { status: "failed", message: SETUP_MESSAGES.notSaved };
    } catch (error) {
      this.deps.logger.error("The local model couldn't be saved", error);
      return { status: "failed", message: SETUP_MESSAGES.notSaved };
    }
    const tools = await this.deps.runner.toolSupport(model);
    return { status: "done", skills: tools === "tools" ? "yes" : tools === "no-tools" ? "no" : "unknown" };
  }

  /** Stops a download in progress. Whether the runner keeps what it has so far is up to it. */
  cancelPull(): void {
    this.pull?.controller.abort(new Error("cancelled"));
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

  /** Setup was finished or skipped. Only this one setting changes. */
  async finish(): Promise<Result> {
    try {
      const saved = await this.deps.settings.update((current) => ({ ...current, setupDone: true }));
      return saved.ok ? { ok: true } : { ok: false, message: SETUP_MESSAGES.notMarked };
    } catch (error) {
      this.deps.logger.error("Setup couldn't be marked as done", error);
      return { ok: false, message: SETUP_MESSAGES.notMarked };
    }
  }

  /** When Sage closes: stops a download. */
  dispose(): void {
    this.cancelPull();
  }
}
