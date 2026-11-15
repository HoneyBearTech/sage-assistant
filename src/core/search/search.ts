/** A web search source. Sage ships with one that needs no key; others can be added behind this. */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchOutcome = { ok: true; results: SearchResult[] } | { ok: false; message: string };

export interface SearchProvider {
  readonly name: string;
  search(query: string): Promise<SearchOutcome>;
}

export const SEARCH_UNAVAILABLE = "Search is unavailable right now. Try again later.";
