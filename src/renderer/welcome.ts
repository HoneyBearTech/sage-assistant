import type { ModelChoice, PullResult, Result, RunnerStatus, SageApi, VoiceStatus } from "../shared/api.js";
import { type DiagnosticStep, RUNNER_STATE_CODES, type SupportCode } from "../shared/support-codes.js";
import type { Typist } from "./typing.js";
import {
  announcement,
  type CheckLine,
  doneLines,
  modelLines,
  PULL_POLL_MS,
  runnerLines,
  WELCOME_STEPS,
  WELCOME_TEXT,
  type WelcomeStep,
} from "./welcome-text.js";

// The Welcome screen: where Sage thinks, the local model runner, a model, and done, as numbered
// sections. Each step lists its checks as short typed lines, each written from a real answer
// (the runner's status, the model request's result, the voice status); a failed check shows its
// support code and offers Copy diagnostics, whose text the main process builds and copies. Every
// question that opens or downloads something is asked by the main process in its own box; the
// window only asks for it, and only ever names one of Sage's two models ("standard" or "smaller").
// Text goes in with textContent, never as HTML.

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
  /** Each step's check lines. */
  checks: Record<Exclude<WelcomeStep, "place">, HTMLElement>;
  /** The one polite status area that reads out new check lines. */
  announce: HTMLElement;
  runnerCode: HTMLElement;
  runnerDiagnostics: HTMLButtonElement;
  modelCode: HTMLElement;
  modelDiagnostics: HTMLButtonElement;
  /** The box that shows the diagnostics text in full before it is copied. */
  diagnostics: HTMLElement;
  diagnosticsHeading: HTMLElement;
  diagnosticsText: HTMLElement;
  diagnosticsCopy: HTMLButtonElement;
  diagnosticsStatus: HTMLElement;
}

export interface WelcomeHooks {
  /** Setup was finished or skipped: open Chat, or Settings for the online service. */
  leave(to: "chat" | "settings"): void;
  /** The chat's typist: the check lines type out one after another, with its skip and reduced-motion rules. */
  typist: Typist;
  /** The system's reduced-motion setting, for the diagnostics. */
  reducedMotion(): boolean;
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
  /** Each step's failed check, if any: its support code is shown, and Copy diagnostics offered. */
  const failed: Record<DiagnosticStep, SupportCode | null> = { runner: null, model: null };
  /** The diagnostics text on show: its id is what Copy sends; the main process holds the text. */
  let diagnosticsId: string | null = null;
  /** Goes up whenever the box is hidden or asked for again; a text for an earlier ask is dropped. */
  let diagnosticsAsk = 0;
  /** Lines waiting to type, one after another. */
  let queue: { item: HTMLElement; text: string }[] = [];

  function typeNext(): void {
    const next = queue.shift();
    if (!next) return;
    next.item.hidden = false;
    // A click or a key (or reduced motion switched on) shows every line still waiting at once.
    hooks.typist.type(next.item, next.text, (skipped) => (skipped ? showAllLines() : typeNext()));
  }

  function showAllLines(): void {
    const waiting = queue;
    queue = [];
    for (const item of waiting) item.item.hidden = false;
  }

  /** Ends any typing, with every line shown. */
  function stopTyping(): void {
    showAllLines();
    hooks.typist.finish();
  }

  /** Replaces a step's lines with these, typed one after another, and reads them out once. */
  function showLines(step: Exclude<WelcomeStep, "place">, lines: CheckLine[], code?: SupportCode): void {
    stopTyping();
    const list = el.checks[step];
    list.replaceChildren();
    for (const check of lines) {
      const item = document.createElement("li");
      item.className = `check-line ${check.state}`;
      item.textContent = check.text;
      item.hidden = true;
      list.append(item);
      queue.push({ item, text: check.text });
    }
    el.announce.textContent = announcement(lines, code);
    typeNext();
  }

  /** Shows (or clears) a step's support code and its Copy diagnostics button. */
  function setFailed(step: DiagnosticStep, code: SupportCode | null): void {
    failed[step] = code;
    const [codeElement, button] =
      step === "runner" ? [el.runnerCode, el.runnerDiagnostics] : [el.modelCode, el.modelDiagnostics];
    codeElement.textContent = code ? WELCOME_TEXT.supportCode(code) : "";
    codeElement.hidden = !code;
    button.hidden = !code;
    hideDiagnostics();
  }

  function hideDiagnostics(): void {
    diagnosticsAsk++;
    diagnosticsId = null;
    el.diagnostics.hidden = true;
    el.diagnosticsText.textContent = "";
    el.diagnosticsStatus.textContent = "";
  }

  async function showDiagnostics(step: DiagnosticStep): Promise<void> {
    const code = failed[step];
    if (!code) return;
    hideDiagnostics();
    const mine = diagnosticsAsk;
    el.diagnostics.hidden = false;
    el.diagnosticsCopy.disabled = true;
    el.diagnosticsStatus.textContent = WELCOME_TEXT.diagnosticsBuilding;
    let result: Awaited<ReturnType<SageApi["diagnostics"]>>;
    try {
      result = await sage.diagnostics({ step, code, reducedMotion: hooks.reducedMotion() });
    } catch {
      result = { ok: false, message: WELCOME_TEXT.diagnosticsFailed };
    }
    // Left, moved on, or checked again meanwhile, or a newer build started in the main process:
    // this text is no longer about what is shown.
    if (mine !== diagnosticsAsk || (!result.ok && result.stale)) return;
    if (!result.ok) {
      el.diagnosticsStatus.textContent = result.message;
      return;
    }
    diagnosticsId = result.id;
    // All of it, as plain text in a read-only box (its text set with textContent, never as HTML),
    // exactly as the main process built it: what Copy puts on the clipboard.
    el.diagnosticsText.textContent = result.text;
    el.diagnosticsStatus.textContent = "";
    el.diagnosticsCopy.disabled = false;
    el.diagnosticsHeading.focus();
  }

  async function copyDiagnostics(): Promise<void> {
    const id = diagnosticsId;
    if (!id) return;
    let result: Result;
    try {
      result = await sage.copyDiagnostics(id);
    } catch {
      result = { ok: false, message: WELCOME_TEXT.copyFailed };
    }
    if (diagnosticsId !== id) return;
    el.diagnosticsStatus.textContent = result.ok ? WELCOME_TEXT.copied : result.message;
  }

  function showStep(step: WelcomeStep): void {
    stopTyping();
    hideDiagnostics();
    for (const name of WELCOME_STEPS) el.steps[name].hidden = name !== step;
    // Screen readers and the keyboard start at the new step.
    el.headings[step].focus();
    if (step === "runner") void checkRunner();
    if (step === "model") void refreshMarks();
    if (step === "done") {
      const choice = readyChoice ?? chosen();
      el.doneSummary.textContent = WELCOME_TEXT.summary(choice);
      el.doneVoice.textContent = WELCOME_TEXT.voice;
      el.checks.done.replaceChildren();
      void checkVoice(choice);
    }
  }

  async function checkVoice(choice: ModelChoice): Promise<void> {
    const mine = visit;
    let voice: VoiceStatus | null;
    try {
      voice = await sage.voiceStatus();
    } catch {
      voice = null;
    }
    if (mine !== visit || el.steps.done.hidden) return;
    showLines("done", doneLines(choice, voice));
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
    setFailed("runner", null);
    stopTyping();
    el.checks.runner.replaceChildren();
    const current = await status();
    if (mine !== visit) return;
    el.runnerCheck.disabled = false;
    const code: SupportCode | null = !current
      ? "SAGE-APP-01"
      : current.state === "unreachable" || current.state === "unreadable"
        ? RUNNER_STATE_CODES[current.state]
        : null;
    setFailed("runner", code);
    showLines("runner", runnerLines(current), code ?? undefined);
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
    setFailed("model", null);
    stopTyping();
    el.checks.model.replaceChildren();
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
    const code = result.status === "failed" ? result.code : null;
    setFailed("model", code);
    showLines("model", modelLines(choice, result), code ?? undefined);
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
    stopTyping();
    hideDiagnostics();
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
        setFailed("model", null);
        stopTyping();
        el.checks.model.replaceChildren();
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
  el.runnerDiagnostics.addEventListener("click", () => void showDiagnostics("runner"));
  el.modelDiagnostics.addEventListener("click", () => void showDiagnostics("model"));
  el.diagnosticsCopy.addEventListener("click", () => void copyDiagnostics());
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
      setFailed("runner", null);
      setFailed("model", null);
      stopTyping();
      for (const list of Object.values(el.checks)) list.replaceChildren();
      el.announce.textContent = "";
      renderModelButtons();
      el.modelNext.hidden = true;
      if (!downloading) setBusy(false);
      showStep("place");
    },
  };
}
