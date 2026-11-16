import type { ModelChoice, PullResult, Result, RunnerStatus, SageApi } from "../shared/api.js";
import { PULL_POLL_MS, WELCOME_STEPS, WELCOME_TEXT, type WelcomeStep } from "./welcome-text.js";

// The Welcome screen: where Sage thinks, the local model runner, a model, and done. Every question
// that opens or downloads something is asked by the main process in its own box; the window only
// asks for it, and only ever names one of Sage's two models ("standard" or "smaller"). Text goes in
// with textContent, never as HTML.

export interface WelcomeElements {
  skip: HTMLButtonElement;
  /** A problem leaving the screen (setup couldn't be saved as done). */
  status: HTMLElement;
  steps: Record<WelcomeStep, HTMLElement>;
  headings: Record<WelcomeStep, HTMLElement>;
  placeLocal: HTMLButtonElement;
  placeOnline: HTMLButtonElement;
  runnerStatus: HTMLElement;
  runnerInstall: HTMLElement;
  runnerCheck: HTMLButtonElement;
  runnerNext: HTMLButtonElement;
  openGuide: HTMLButtonElement;
  guideStatus: HTMLElement;
  guideAddress: HTMLElement;
  modelStandard: HTMLInputElement;
  modelSmaller: HTMLInputElement;
  standardMark: HTMLElement;
  smallerMark: HTMLElement;
  modelDownload: HTMLButtonElement;
  modelCancel: HTMLButtonElement;
  modelProgress: HTMLProgressElement;
  modelStatus: HTMLElement;
  modelSkills: HTMLElement;
  modelNext: HTMLButtonElement;
  doneSummary: HTMLElement;
  doneVoice: HTMLElement;
  startChatting: HTMLButtonElement;
}

export interface WelcomeHooks {
  /** Setup was finished or skipped: open Chat, or Settings for the online service. */
  leave(to: "chat" | "settings"): void;
}

export interface Welcome {
  /** Shows the first step again, with nothing left over from last time. */
  open(): void;
}

export function createWelcome(sage: SageApi, el: WelcomeElements, hooks: WelcomeHooks): Welcome {
  let downloaded: Record<ModelChoice, boolean> = { standard: false, smaller: false };
  let downloading = false;
  let leaving = false;
  /** The model that is ready to use, once downloaded or found. */
  let readyChoice: ModelChoice | null = null;
  /** The last download failed or was cancelled: the button offers to try again. */
  let retry = false;
  /** Goes up each time the screen is opened; a late answer for an earlier visit is dropped. */
  let visit = 0;

  function showStep(step: WelcomeStep): void {
    for (const name of WELCOME_STEPS) el.steps[name].hidden = name !== step;
    // Screen readers and the keyboard start at the new step.
    el.headings[step].focus();
    if (step === "runner") void checkRunner();
    if (step === "model") void refreshMarks();
    if (step === "done") {
      el.doneSummary.textContent = WELCOME_TEXT.summary(readyChoice ?? chosen());
      el.doneVoice.textContent = WELCOME_TEXT.voice;
    }
  }

  function chosen(): ModelChoice {
    return el.modelSmaller.checked ? "smaller" : "standard";
  }

  function renderModelButtons(): void {
    el.standardMark.textContent = downloaded.standard ? WELCOME_TEXT.downloaded : "";
    el.smallerMark.textContent = downloaded.smaller ? WELCOME_TEXT.downloaded : "";
    el.modelDownload.textContent = retry
      ? WELCOME_TEXT.tryAgain
      : downloaded[chosen()]
        ? WELCOME_TEXT.useModel
        : WELCOME_TEXT.download;
  }

  async function status(): Promise<RunnerStatus | null> {
    try {
      return await sage.runnerStatus();
    } catch {
      return null;
    }
  }

  async function checkRunner(): Promise<void> {
    const mine = visit;
    el.runnerStatus.textContent = WELCOME_TEXT.checking;
    el.runnerCheck.disabled = true;
    el.runnerNext.disabled = true;
    const current = await status();
    if (mine !== visit) return;
    el.runnerCheck.disabled = false;
    if (!current) {
      el.runnerStatus.textContent = WELCOME_TEXT.checkFailed;
      return;
    }
    downloaded = current.downloaded;
    el.runnerInstall.hidden = current.state !== "unreachable";
    el.runnerStatus.textContent =
      current.state === "unreachable"
        ? WELCOME_TEXT.unreachable
        : current.state === "unreadable"
          ? WELCOME_TEXT.unreadable
          : WELCOME_TEXT.running;
    el.runnerNext.disabled = current.state !== "ready" && current.state !== "no-model";
  }

  async function refreshMarks(): Promise<void> {
    const mine = visit;
    renderModelButtons();
    const current = await status();
    if (mine !== visit || !current || current.state === "unreachable" || current.state === "unreadable") {
      return;
    }
    downloaded = current.downloaded;
    renderModelButtons();
  }

  function setBusy(busy: boolean): void {
    el.modelDownload.disabled = busy;
    el.modelStandard.disabled = busy;
    el.modelSmaller.disabled = busy;
    if (!busy) {
      el.modelCancel.hidden = true;
      el.modelProgress.hidden = true;
    }
  }

  async function refreshProgress(mine: number): Promise<void> {
    try {
      const progress = await sage.pullStatus();
      if (mine !== visit || !downloading || !progress.downloading) return;
      el.modelCancel.hidden = false;
      el.modelProgress.hidden = false;
      el.modelProgress.max = Math.max(progress.total, 1);
      el.modelProgress.value = Math.min(progress.completed, progress.total);
      el.modelStatus.textContent = WELCOME_TEXT.downloading(progress.completed, progress.total);
    } catch {
      // Asked again on the next poll.
    }
  }

  async function download(): Promise<void> {
    if (downloading) return;
    const mine = visit;
    const choice = chosen();
    downloading = true;
    readyChoice = null;
    setBusy(true);
    el.modelNext.hidden = true;
    el.modelSkills.textContent = "";
    el.modelStatus.textContent = WELCOME_TEXT.asking;
    const poll = setInterval(() => void refreshProgress(mine), PULL_POLL_MS);
    let result: PullResult;
    try {
      result = await sage.pullModel(choice);
    } catch {
      result = { status: "failed", message: WELCOME_TEXT.failed, code: "SAGE-APP-01" };
    } finally {
      clearInterval(poll);
      downloading = false;
      setBusy(false);
    }
    if (mine !== visit) return;
    retry = result.status === "cancelled" || result.status === "failed";
    if (result.status === "done") {
      readyChoice = choice;
      downloaded[choice] = true;
      renderModelButtons();
      el.modelStatus.textContent = WELCOME_TEXT.ready(choice);
      if (result.skills === "no") el.modelSkills.textContent = WELCOME_TEXT.noSkills;
      el.modelNext.hidden = false;
      el.modelNext.focus();
      return;
    }
    renderModelButtons();
    if (result.status === "declined") {
      el.modelStatus.textContent = WELCOME_TEXT.declined;
      return;
    }
    el.modelStatus.textContent = result.status === "cancelled" ? WELCOME_TEXT.cancelled : result.message;
  }

  async function finish(to: "chat" | "settings"): Promise<void> {
    if (leaving) return;
    leaving = true;
    el.status.textContent = "";
    // Leaving stops a download in progress: nothing keeps running behind the user's back.
    if (downloading) await sage.cancelPull().catch(() => undefined);
    let result: Result;
    try {
      result = await sage.finishSetup();
    } catch {
      result = { ok: false, message: WELCOME_TEXT.notSaved };
    }
    leaving = false;
    if (!result.ok) {
      // Stays here, so the choice can be made again; the message says what went wrong.
      el.status.textContent = result.message;
      return;
    }
    visit++;
    hooks.leave(to);
  }

  async function openGuide(): Promise<void> {
    const mine = visit;
    el.openGuide.disabled = true;
    el.guideStatus.textContent = WELCOME_TEXT.guideAsking;
    el.guideAddress.hidden = true;
    let result: Awaited<ReturnType<SageApi["openInstallGuide"]>>;
    try {
      result = await sage.openInstallGuide();
    } catch {
      result = { status: "failed", message: WELCOME_TEXT.guideFailed, address: "" };
    }
    el.openGuide.disabled = false;
    if (mine !== visit) return;
    if (result.status === "opened") {
      el.guideStatus.textContent = WELCOME_TEXT.guideOpened;
    } else if (result.status === "declined") {
      el.guideStatus.textContent = WELCOME_TEXT.guideDeclined;
    } else {
      el.guideStatus.textContent = result.message;
      // The address as plain text, to copy into a browser by hand.
      el.guideAddress.textContent = result.address;
      el.guideAddress.hidden = !result.address;
    }
  }

  el.skip.addEventListener("click", () => void finish("chat"));
  el.placeLocal.addEventListener("click", () => showStep("runner"));
  el.placeOnline.addEventListener("click", () => void finish("settings"));
  el.runnerCheck.addEventListener("click", () => void checkRunner());
  el.runnerNext.addEventListener("click", () => showStep("model"));
  el.openGuide.addEventListener("click", () => void openGuide());
  for (const radio of [el.modelStandard, el.modelSmaller]) {
    radio.addEventListener("change", () => {
      retry = false;
      // A model that is ready counts only while it is the one chosen.
      if (readyChoice !== chosen()) {
        readyChoice = null;
        el.modelNext.hidden = true;
        el.modelStatus.textContent = "";
        el.modelSkills.textContent = "";
      }
      renderModelButtons();
    });
  }
  el.modelDownload.addEventListener("click", () => void download());
  el.modelCancel.addEventListener("click", () => {
    void sage
      .cancelPull()
      .then((answer) => {
        // Already being saved as the local model: it stays chosen, and the result says it is ready.
        if (answer === "too-late" && downloading) el.modelStatus.textContent = WELCOME_TEXT.tooLate;
      })
      .catch(() => undefined);
  });
  el.modelNext.addEventListener("click", () => showStep("done"));
  el.startChatting.addEventListener("click", () => void finish("chat"));

  return {
    open() {
      visit++;
      readyChoice = null;
      retry = false;
      el.status.textContent = "";
      el.runnerStatus.textContent = "";
      el.runnerInstall.hidden = true;
      el.guideStatus.textContent = "";
      el.guideAddress.textContent = "";
      el.guideAddress.hidden = true;
      el.modelStatus.textContent = "";
      el.modelSkills.textContent = "";
      renderModelButtons();
      el.modelNext.hidden = true;
      if (!downloading) setBusy(false);
      showStep("place");
    },
  };
}
