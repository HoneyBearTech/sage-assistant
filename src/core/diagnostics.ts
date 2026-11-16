import { arch, homedir, platform, release, userInfo } from "node:os";
import type {
  BrainChoice,
  DiagnosticsRequest,
  DiagnosticsResult,
  Result,
  RunnerStatus,
  VoiceStatus,
} from "../shared/api.js";
import { SAGE_MODELS } from "../shared/api.js";
import { SETUP_STEP_LABELS, SUPPORT_CODES } from "../shared/support-codes.js";
import type { Settings } from "./settings.js";
import type { TriedModel } from "./setup.js";

// Copy diagnostics, for the Welcome screen's failed steps. The text is built here, in the main
// process, from a fixed list of fields: Sage's version, the system, the step and its support code,
// the kind of brain, the runner's answer and version, whether the chosen model is there, the voice
// status and the window's look. Never a key, an address other than the PC's own, a name, a path, a
// note, a reminder or an e-mail address. As a second line of defence every value is scrubbed of the
// home folder, the user name, e-mail and web addresses, and every key the redactor knows. The text
// is put on the clipboard only when the user chooses Copy, and is never sent anywhere.

/** The PC's own facts the text uses, and what to scrub. */
export interface SystemFacts {
  /** "Windows", "Linux", "macOS" or the platform's own name. */
  os: string;
  osVersion: string;
  arch: string;
  /** Only to scrub: never written. */
  home: string;
  /** Only to scrub: never written. */
  user: string;
}

export function systemFacts(): SystemFacts {
  let user = "";
  try {
    user = userInfo().username;
  } catch {
    // No user name to scrub.
  }
  const name = platform();
  return {
    os: name === "win32" ? "Windows" : name === "linux" ? "Linux" : name === "darwin" ? "macOS" : name,
    osVersion: release(),
    arch: arch(),
    home: homedir(),
    user,
  };
}

export interface DiagnosticsDeps {
  appVersion: string;
  loadSettings: () => Promise<Settings>;
  runnerStatus: () => Promise<RunnerStatus>;
  voiceStatus: () => Promise<VoiceStatus>;
  /** The model the last model request tried and didn't finish with (Setup.triedModel). */
  triedModel: () => TriedModel | null;
  /** The redactor's: every key Sage has seen becomes "[redacted]". */
  redact: (text: string) => string;
  /** Puts text on the clipboard (Electron's clipboard, in the main process). */
  writeClipboard: (text: string) => void;
  system?: SystemFacts;
  /** The time now, in ms (the clock's); for the copy limits. */
  now?: () => number;
}

/** A built text can be copied only this long after it was built... */
export const DIAGNOSTICS_COPY_MS = 2 * 60_000;
/** ...and at most this many times. Then Copy diagnostics builds a fresh one. */
export const DIAGNOSTICS_MAX_COPIES = 3;

export const DIAGNOSTICS_MESSAGES = {
  stale: "Choose Copy diagnostics again, then Copy.",
  expired: "This text was put together over 2 minutes ago. Choose Copy diagnostics again, then Copy.",
  tooMany: "This text was already copied 3 times. Choose Copy diagnostics again to copy it again.",
  notCopied: "Sage couldn't copy to the clipboard. Select the text in the box and copy it yourself.",
} as const;

/** What the text says, field by field, before scrubbing. Each value is one of a few fixed words. */
export interface DiagnosticsFacts {
  appVersion: string;
  os: string;
  osVersion: string;
  arch: string;
  request: DiagnosticsRequest;
  brain: BrainChoice | "unknown";
  theme: Settings["theme"] | "unknown";
  /** The local model in Settings, by name only when it is one of Sage's two. */
  model: { kind: "sage"; name: string } | { kind: "other" } | { kind: "unknown" };
  /** The model the failed step tried, if any: always one of Sage's two. */
  tried: TriedModel | null;
  runner: RunnerStatus | null;
  voice: VoiceStatus["model"] | null;
}

const RUNNER_WORDS: Record<RunnerStatus["state"], string> = {
  unreachable: "didn't answer",
  unreadable: "answered with something Sage couldn't read",
  "no-model": "answered",
  ready: "answered",
};

const VOICE_WORDS: Record<VoiceStatus["model"], string> = {
  missing: "speech file not downloaded",
  downloading: "speech file downloading",
  ready: "speech file ready",
};

/** The text's lines, in order, as [label, value]. Labels are fixed; values are scrubbed later. */
export function diagnosticsLines(facts: DiagnosticsFacts): [string, string][] {
  const runner = facts.runner;
  const listed = runner && (runner.state === "ready" || runner.state === "no-model") ? runner : null;
  const unknown = "unknown, the runner didn't say";
  const saved = !listed ? unknown : listed.state === "ready" ? "yes" : "no";
  const tried = facts.tried;
  const triedText = !tried
    ? "none"
    : tried.saveFailed
      ? `${SAGE_MODELS[tried.choice].name} (downloaded, but not saved as the local model)`
      : `${SAGE_MODELS[tried.choice].name} (downloaded: ${
          !listed ? unknown : listed.downloaded[tried.choice] ? "yes" : "no"
        })`;
  const savedName =
    facts.model.kind === "sage"
      ? facts.model.name
      : facts.model.kind === "other"
        ? "not one of Sage's two, name left out"
        : "unknown";
  return [
    ["Sage version", facts.appVersion],
    ["System", `${facts.os} ${facts.osVersion}`],
    ["CPU", facts.arch],
    ["Setup step", SETUP_STEP_LABELS[facts.request.step]],
    ["Support code", `${facts.request.code}: ${SUPPORT_CODES[facts.request.code]}`],
    ["Brain", facts.brain],
    ["Local model runner", runner ? RUNNER_WORDS[runner.state] : "couldn't be checked"],
    ["Runner version", runner?.version ?? "not reported"],
    ["Model tried", triedText],
    ["Saved model", `${savedName} (downloaded: ${saved})`],
    ["Voice", facts.voice ? VOICE_WORDS[facts.voice] : "couldn't be checked"],
    ["Theme", facts.theme],
    ["Reduced motion", facts.request.reducedMotion ? "on" : "off"],
  ];
}

export const DIAGNOSTICS_HEADER = [
  "Sage diagnostics",
  "Built by Sage on this PC. Nothing in it was sent anywhere.",
] as const;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Loopback only: the one kind of address the text may keep. */
function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * The second line of defence, for one value: every known key first (before anything else changes
 * the text, so no substitution can split a key and leave parts of it), then the home folder (with
 * either slash), e-mail addresses, web addresses other than the PC's own, and the user name as a
 * whole word.
 */
export function scrubValue(
  value: string,
  system: Pick<SystemFacts, "home" | "user">,
  redact: (text: string) => string,
): string {
  let out = redact(value);
  const home = system.home.replace(/[\\/]+$/, "");
  if (home.length > 1) {
    for (const form of new Set([home, home.replaceAll("\\", "/"), home.replaceAll("/", "\\")])) {
      out = out.replace(new RegExp(escapeRegExp(form), "gi"), "[home]");
    }
  }
  out = out.replace(/[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[^\s@<>()"',;]+/g, "[e-mail]");
  out = out.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (url) => (isLoopback(url) ? url : "[address]"));
  if (system.user.trim().length > 1) {
    out = out.replace(new RegExp(`(?<![\\w])${escapeRegExp(system.user.trim())}(?![\\w])`, "gi"), "[user]");
  }
  return out;
}

/**
 * Only short plain words: letters, digits, spaces, dots, dashes, underscores and the scrubber's
 * brackets, on one line, at most 60 of them.
 */
function plain(value: string): string {
  const kept = value
    .replace(/[^0-9A-Za-z ._[\]-]/g, "")
    .trim()
    .slice(0, 60);
  return kept || "unknown";
}

export class Diagnostics {
  private last: { id: string; text: string; builtAt: number; copies: number } | undefined;
  /** Builds are numbered when they start; only the newest one started is kept. */
  private started = 0;
  private readonly system: SystemFacts;

  constructor(private readonly deps: DiagnosticsDeps) {
    this.system = deps.system ?? systemFacts();
  }

  /** A value from the PC itself: scrubbed (keys first), then kept to plain words last. */
  private own(value: string): string {
    return plain(scrubValue(value, this.system, this.deps.redact));
  }

  /** Gathers the facts, each on its own: one that can't be read says so and the rest still show. */
  async facts(request: DiagnosticsRequest): Promise<DiagnosticsFacts> {
    const [settings, runner, voice] = await Promise.all([
      this.deps.loadSettings().catch(() => null),
      this.deps.runnerStatus().catch(() => null),
      this.deps.voiceStatus().catch(() => null),
    ]);
    const local = settings?.local.model;
    const sageModel = Object.values(SAGE_MODELS).find((model) => model.name === local);
    return {
      appVersion: this.own(this.deps.appVersion),
      os: this.own(this.system.os),
      osVersion: this.own(this.system.osVersion),
      arch: this.own(this.system.arch),
      request,
      brain: settings?.brain ?? "unknown",
      theme: settings?.theme ?? "unknown",
      model: !settings
        ? { kind: "unknown" }
        : sageModel
          ? { kind: "sage", name: sageModel.name }
          : { kind: "other" },
      runner,
      voice: voice?.model ?? null,
      tried: this.deps.triedModel(),
    };
  }

  /**
   * Builds the text and remembers it under a new id; only that text can then be copied. A build
   * that finishes after a newer one started is not kept, and comes back marked stale.
   */
  async build(request: DiagnosticsRequest): Promise<DiagnosticsResult> {
    const number = ++this.started;
    const facts = await this.facts(request);
    const lines = diagnosticsLines(facts).map(
      ([label, value]) => `${label}: ${scrubValue(value, this.system, this.deps.redact)}`,
    );
    const text = [...DIAGNOSTICS_HEADER, "", ...lines].join("\n");
    if (number !== this.started) return { ok: false, stale: true, message: DIAGNOSTICS_MESSAGES.stale };
    this.last = { id: `diag-${number}`, text, builtAt: this.now(), copies: 0 };
    return { ok: true, id: this.last.id, text };
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /**
   * Copies the text built last, if `id` names it; the window never supplies the text. Only within
   * DIAGNOSTICS_COPY_MS of the build and at most DIAGNOSTICS_MAX_COPIES times, so the window can't
   * keep writing the clipboard without the user asking for a fresh text.
   */
  copy(id: string): Result {
    const last = this.last;
    if (!last || last.id !== id) return { ok: false, message: DIAGNOSTICS_MESSAGES.stale };
    if (this.now() - last.builtAt > DIAGNOSTICS_COPY_MS) {
      return { ok: false, message: DIAGNOSTICS_MESSAGES.expired };
    }
    if (last.copies >= DIAGNOSTICS_MAX_COPIES) return { ok: false, message: DIAGNOSTICS_MESSAGES.tooMany };
    try {
      this.deps.writeClipboard(last.text);
      last.copies += 1;
      return { ok: true };
    } catch {
      return { ok: false, message: DIAGNOSTICS_MESSAGES.notCopied };
    }
  }
}
