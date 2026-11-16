import { z } from "zod";
import type { Company, GuideResult, ModelListResult, Result } from "../shared/api.js";
import type { FetchLike } from "./brain/brain.js";
import { anthropicHeaders } from "./brain/anthropic.js";
import { serviceName, unreadableMessage } from "./brain/errors.js";
import { requestService } from "./brain/request.js";
import { ANTHROPIC_ORIGIN, GEMINI_ORIGIN, OPENAI_ORIGIN, SERVICES } from "./brain/services.js";
import type { ServiceKeys } from "./keystore.js";
import type { Logger } from "./log.js";

/**
 * The Settings screen's requests for a ready-made service: its current model list (Load models),
 * a check of the saved key (Test, which lists the models: it costs nothing), and opening the
 * company's key page after asking. The window sends only the company's id; every address is fixed
 * here, and a key is handed out only for its own company's address.
 */

/** Where each company lists its models. */
export const MODELS_URLS: Readonly<Record<Company, string>> = {
  claude: `${ANTHROPIC_ORIGIN}/v1/models?limit=1000`,
  openai: `${OPENAI_ORIGIN}/v1/models`,
  gemini: `${GEMINI_ORIGIN}/v1beta/models?pageSize=1000`,
};

/** The most model names shown, and the longest one. */
export const MAX_MODELS = 300;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

/** OpenAI lists every model it has; these families can't chat. */
const NOT_CHAT = /embedding|tts|whisper|dall-e|moderation|transcribe|realtime|audio|image|sora/i;

const idList = z.object({ data: z.array(z.looseObject({ id: z.string() })) });
const geminiList = z.object({
  models: z
    .array(
      z.looseObject({
        name: z.string(),
        supportedGenerationMethods: z.array(z.string()).nullish(),
      }),
    )
    .nullish(),
});

function headersFor(company: Company, key: string): Record<string, string> {
  if (company === "claude") return anthropicHeaders(key);
  if (company === "gemini") return { "x-goog-api-key": key };
  return { authorization: `Bearer ${key}` };
}

function namesFrom(company: Company, body: unknown): string[] | null {
  if (company === "gemini") {
    const parsed = geminiList.safeParse(body);
    if (!parsed.success) return null;
    return (parsed.data.models ?? [])
      .filter((model) => model.supportedGenerationMethods?.includes("generateContent") ?? true)
      .map((model) => model.name.replace(/^models\//, ""));
  }
  const parsed = idList.safeParse(body);
  if (!parsed.success) return null;
  const ids = parsed.data.data.map((model) => model.id);
  return company === "openai" ? ids.filter((id) => !NOT_CHAT.test(id)) : ids;
}

/** Only plain model names, each once, at most MAX_MODELS, sorted. */
export function cleanModelNames(names: string[]): string[] {
  return [...new Set(names.filter((name) => MODEL_NAME.test(name)))].sort().slice(0, MAX_MODELS);
}

export const PAGE_QUESTION = (company: Company) =>
  `Open ${SERVICES[company].company}'s key page in your web browser?`;
export const PAGE_DETAIL = (company: Company) =>
  `Sage will open ${SERVICES[company].keyPage}. Create a key there, then paste it into Settings and choose Save key. ${
    company === "gemini"
      ? "Google has a free tier for some models; beyond it, use is paid."
      : `${SERVICES[company].company} charges per use.`
  } Sage can't cap what you spend: set a limit on the company's own site.`;

export interface OnlineServicesDeps {
  keys: Pick<ServiceKeys, "keyForRequest">;
  logger: Logger;
  /** The main process's own box before a page opens; true only for Open. */
  confirmOpenPage: (question: string, detail: string) => Promise<boolean>;
  /** Opens an address in the web browser (Electron's shell.openExternal). */
  openExternal: (url: string) => Promise<void>;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** The clock, in milliseconds (tests set it). */
  now?: () => number;
}

/** How long a model list (and so a Test) is reused after it arrived, so clicks can't pile up requests. */
export const COOLDOWN_MS = 3_000;

export class OnlineServices {
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  /** The request running for each company: a second Load models or Test shares it. */
  private readonly running = new Map<Company, Promise<ModelListResult>>();
  /** Each company's last answer from the service, and when it came. */
  private readonly recent = new Map<Company, { at: number; result: ModelListResult }>();

  constructor(private readonly deps: OnlineServicesDeps) {
    this.fetch = deps.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = deps.timeoutMs ?? 20_000;
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * The company's current model names, asked for with its own saved key. One request at a time per
   * company: a call while one runs gets the same answer, and so does one within a few seconds of it.
   */
  listModels(company: Company): Promise<ModelListResult> {
    const recent = this.recent.get(company);
    if (recent && this.now() - recent.at < COOLDOWN_MS) return Promise.resolve(recent.result);
    const running = this.running.get(company);
    if (running) return running;
    const request = this.askForModels(company).finally(() => this.running.delete(company));
    this.running.set(company, request);
    return request;
  }

  /** Forgets the last answer for a company, when its key was saved or removed. */
  forget(company: Company): void {
    this.recent.delete(company);
  }

  private async askForModels(company: Company): Promise<ModelListResult> {
    const service = serviceName(SERVICES[company].name);
    const url = MODELS_URLS[company];
    // The key for exactly this address: checked here, at the point of the request.
    const key = await this.deps.keys.keyForRequest(company, url);
    if (!key) return { ok: false, message: `Save a ${SERVICES[company].name} key first.` };
    const reply = await requestService(
      this.fetch,
      url,
      { method: "GET", headers: headersFor(company, key) },
      service,
      this.timeoutMs,
    );
    const names = reply.ok ? namesFrom(company, reply.body) : null;
    const result: ModelListResult = !reply.ok
      ? { ok: false, message: reply.message }
      : names
        ? { ok: true, models: cleanModelNames(names.filter((name) => !name.includes(key))) }
        : { ok: false, message: unreadableMessage(service) };
    this.recent.set(company, { at: this.now(), result });
    return result;
  }

  /** Test: one small request with the saved key (listing the models, which costs nothing). */
  async testKey(company: Company): Promise<Result> {
    const listed = await this.listModels(company);
    if (!listed.ok) return listed;
    return { ok: true, message: `The key works: ${SERVICES[company].name} answered.` };
  }

  /** Asks first, then opens the company's key page: one of three fixed addresses. */
  async openKeyPage(company: Company): Promise<GuideResult> {
    const address = SERVICES[company].keyPage;
    let agreed: boolean;
    try {
      agreed = await this.deps.confirmOpenPage(PAGE_QUESTION(company), PAGE_DETAIL(company));
    } catch {
      agreed = false;
    }
    if (!agreed) return { status: "declined" };
    try {
      await this.deps.openExternal(SERVICES[company].keyPage);
      return { status: "opened" };
    } catch {
      this.deps.logger.warn("The web browser couldn't be opened for a key page.");
      return {
        status: "failed",
        message: `Sage couldn't open your web browser. The page is at ${address}`,
        address,
      };
    }
  }
}
