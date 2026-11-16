import type { Company } from "../../shared/api.js";

/**
 * The ready-made online services. Every address here is fixed: nothing from the window, a reply or
 * a page can change one. Each company's key is bound to its `origin` and is only ever sent there.
 */
export interface CompanyService {
  /** The name used in messages ("Claude didn't accept the key."). */
  name: string;
  /** Who the messages and the skills' results are sent to. */
  company: string;
  /** The only scheme, host and port this company's key is ever sent to. */
  origin: string;
  /** The page where the user creates a key; opened only after Sage's own asking box. */
  keyPage: string;
  /** The model a new user starts with; editable in Settings. */
  defaultModel: string;
}

export const ANTHROPIC_ORIGIN = "https://api.anthropic.com";
export const OPENAI_ORIGIN = "https://api.openai.com";
export const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";

export const SERVICES: Readonly<Record<Company, CompanyService>> = {
  claude: {
    name: "Claude",
    company: "Anthropic",
    origin: ANTHROPIC_ORIGIN,
    keyPage: "https://console.anthropic.com/settings/keys",
    defaultModel: "claude-sonnet-5-5",
  },
  openai: {
    name: "OpenAI",
    company: "OpenAI",
    origin: OPENAI_ORIGIN,
    keyPage: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-6-astra",
  },
  gemini: {
    name: "Gemini",
    company: "Google",
    origin: GEMINI_ORIGIN,
    keyPage: "https://aistudio.google.com/apikey",
    defaultModel: "gemini-3.8-flash",
  },
};

/**
 * The origin (scheme, host and port) a request to `url` goes to, or null if Sage would never send
 * a key there: only https, or plain http to this computer (for a self-hosted "other" service), and
 * no user name or password in the address.
 */
export function requestOrigin(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) return null;
  if (parsed.username || parsed.password) return null;
  return parsed.origin;
}
