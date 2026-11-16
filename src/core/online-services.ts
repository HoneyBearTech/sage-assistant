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
}

export class OnlineServices {
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly deps: OnlineServicesDeps) {
    this.fetch = deps.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = deps.timeoutMs ?? 20_000;
  }

  /** The company's current model names, asked for with its own saved key. */
  async listModels(company: Company): Promise<ModelListResult> {
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
    if (!reply.ok) return reply;
    const names = namesFrom(company, reply.body);
    if (!names) return { ok: false, message: unreadableMessage(service) };
    return { ok: true, models: cleanModelNames(names.filter((name) => !name.includes(key))) };
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
