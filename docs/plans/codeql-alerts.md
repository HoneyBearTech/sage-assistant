# Plan: codeql-alerts

## What the owner asked for

"Start looking at the code scanning alerts on this repo and resolving them."

## What we found

- The repository has 10 open code scanning alerts: 3 from CodeQL (problems in the code) and 7 from
  Scorecard (scores for how the project is run, with no file attached).
- **CodeQL #2 and #3** (`src/core/search/duckduckgo.ts`, lines 86 and 92, high): `resultUrl()` checks
  whether a link belongs to DuckDuckGo with `hostname.endsWith("duckduckgo.com")`. That also matches a
  look-alike name such as `evilduckduckgo.com`. In practice:
  - line 86 would treat `https://evilduckduckgo.com/l/?uddg=<url>` as DuckDuckGo's own redirect and
    unwrap it;
  - line 92 would drop a real result on such a site.
  Neither lets a page run anything (only `http` and `https` links come out, and the result is still
  only a link), but the check should mean what it says.
- **CodeQL #1** (`test/security.test.ts`, line 54, high): the test that checks the window's page for
  inline script looks for `<script ...>...</script>` in lower case only, so `<SCRIPT>` or
  `</script >` would slip past it. The page itself is fine; the test is weaker than it looks.
- **The Scorecard alerts** can't be fixed in code:
  - **Branch protection (3/10)** is a repository setting.
  - **Code review (0/10)** wants approvals from a second person.
  - **Maintained (0/10)** is because the repository is under 90 days old.
  - **Best Practices (2/10)** needs the questionnaire filled in.
  - **SAST and CI tests (9/10)** are each one old unchecked change that ages out.
  - **Fuzzing (0/10)** needs a new test tool, which is a dependency change for its own pull request.
  The report lists what the owner can do for each.

## What we'll change

1. **`src/core/search/duckduckgo.ts`:** a small helper that is true only for `duckduckgo.com` itself
   or a name ending in `.duckduckgo.com` (for example `html.duckduckgo.com`), used in both places.

   *Check:* new tests in `test/search.test.ts`:
   - a redirect on `evilduckduckgo.com` isn't unwrapped (it comes back as that site's own link);
   - a result on `evilduckduckgo.com` isn't dropped;
   - redirects on `duckduckgo.com` and `html.duckduckgo.com` still unwrap;
   - links to `duckduckgo.com` and its subdomains are still dropped.
   The existing tests still pass.
2. **`test/security.test.ts`:** the inline-script check matches `<script>` in any letter case and
   allows spaces in the closing tag. It also counts every `<script` in the page, in any case, so a tag
   the pattern misses fails the test.

   *Check:* the test passes on the real page and fails on a test copy with `<SCRIPT>alert(1)</SCRIPT>`
   (tried by hand, not committed).
3. **Notes:** the roadmap gets the owner's Scorecard items and a fuzzing follow-up. The changelog gets
   one "Fixed" line under Unreleased for the link check.

   *Check:* `npm run verify`. After merging, CodeQL's next scan of `main` closes alerts #1-#3 by itself.

## Who's on it

CEO, Engineer, Security Officer and Auditor. No Researcher (the CEO read the alerts and the code), no
QA (two small changes covered by tests and the reviewers). This is a security fix, so it would also get
a second security review; that reviewer isn't available this month.

## Risks

- Very low. The link check gets stricter for look-alike names only; real DuckDuckGo addresses behave
  as before.

## Out of scope

- The Scorecard alerts listed above. They are repository settings, the owner's tasks, time, or a later
  job (fuzzing).
- Dismissing alerts on GitHub: fixed alerts close themselves on the next scan.
