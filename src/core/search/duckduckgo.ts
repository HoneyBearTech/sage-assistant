import { type FetchLike, readTextCapped } from "../brain/brain.js";
import { elements, hasClass, textOf } from "./html.js";
import { SEARCH_UNAVAILABLE, type SearchOutcome, type SearchProvider, type SearchResult } from "./search.js";

export const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/";
export const MAX_RESULTS = 6;

/** DuckDuckGo's plain HTML results page. It needs no key and no account. */
export class DuckDuckGoProvider implements SearchProvider {
  readonly name = "DuckDuckGo";
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: { fetch?: FetchLike; timeoutMs?: number } = {}) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async search(query: string): Promise<SearchOutcome> {
    try {
      const response = await this.fetch(DUCKDUCKGO_HTML_URL, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "Mozilla/5.0 (compatible; Sage desktop assistant)",
        },
        body: new URLSearchParams({ q: query }).toString(),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return { ok: false, message: SEARCH_UNAVAILABLE };
      const page = await readTextCapped(response);
      if (page === null || looksBlocked(page)) return { ok: false, message: SEARCH_UNAVAILABLE };
      return { ok: true, results: parseResults(page).slice(0, MAX_RESULTS) };
    } catch {
      return { ok: false, message: SEARCH_UNAVAILABLE };
    }
  }
}

/** The page DuckDuckGo shows when it thinks the request came from a bot. */
export function looksBlocked(page: string): boolean {
  return /anomaly-modal|class="anomaly|bots use DuckDuckGo too/i.test(page) || !/<body\b/i.test(page);
}

export function parseResults(page: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blockStart = /<div\b[^>]*class="([^"]*)"[^>]*>/gi;
  const starts: { index: number; classes: string[] }[] = [];
  for (const match of page.matchAll(blockStart)) {
    const classes = (match[1] ?? "").split(/\s+/);
    if (classes.includes("result") && match.index !== undefined) {
      starts.push({ index: match.index, classes });
    }
  }
  starts.forEach((start, i) => {
    if (start.classes.includes("result--ad")) return;
    const block = page.slice(start.index, starts[i + 1]?.index ?? page.length);
    const anchors = elements(block, "a");
    const title = anchors.find((a) => hasClass(a.attributes, "result__a"));
    if (!title) return;
    const url = resultUrl(title.attributes.href ?? "");
    if (!url) return;
    const snippetElement = [...anchors, ...elements(block, "div"), ...elements(block, "td")].find((e) =>
      hasClass(e.attributes, "result__snippet"),
    );
    const titleText = textOf(title.inner);
    if (!titleText) return;
    results.push({
      title: titleText,
      url,
      snippet: snippetElement ? textOf(snippetElement.inner) : "",
    });
  });
  return results;
}

/** Result links are either direct or go through DuckDuckGo's redirect (`/l/?uddg=<url>`). */
export function resultUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, "https://duckduckgo.com");
  } catch {
    return null;
  }
  if (isDuckDuckGoHost(url.hostname) && url.pathname === "/l/") {
    const target = url.searchParams.get("uddg");
    if (!target) return null;
    return resultUrl(target);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (isDuckDuckGoHost(url.hostname)) return null;
  return url.toString();
}

/** True for duckduckgo.com itself and its own subdomains, never for a look-alike such as evilduckduckgo.com. */
function isDuckDuckGoHost(hostname: string): boolean {
  return hostname === "duckduckgo.com" || hostname.endsWith(".duckduckgo.com");
}
