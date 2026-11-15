# Saved search pages

Trimmed copies of the markup of DuckDuckGo's plain HTML results page
(`https://html.duckduckgo.com/html/`), with the results replaced by example sites. The tests in
`test/search.test.ts` parse these files; they never contact the real page.

- `results.html`: a normal page with an ad, direct links, a redirect link, HTML entities, and a
  result that tries to give the assistant instructions.
- `no-results.html`: a search with no results.
- `blocked.html`: the page shown when the request looks automated.
