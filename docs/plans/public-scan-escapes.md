# Plan: public-scan-escapes

## What the owner asked for

"Start the next one": the roadmap item "Public-repo checker: also catch e-mail addresses written with
JSON escapes (such as `\u0040` for `@`) in JSON files."

## What we found

- The public-repo checker (`npm run check:public`, part of `npm run verify` and of the CI checks)
  scans every file line by line for private network addresses, LAN host names, home folders with a
  real user name, and personal e-mail addresses (`scripts/lib/public-scan.ts`).
- It reads each line exactly as written. JSON files (and JavaScript strings) can write any character as
  `\u` and four hex digits, so an address written as `name\u0040example.org` hides from the e-mail rule.
  The same trick can hide the dots in a private address or a host name.
- The gap was found during the installer job and deferred to the roadmap. Nothing in the repository
  uses it today.

## What we'll change

1. **Scan the decoded line too.** When a line contains `\u` escapes (four hex digits, as JSON and
   JavaScript write them) or `\/`, the checker also decodes them and runs every rule on the decoded
   line, in every text file, not only JSON. A problem it finds there is reported once, with the line
   number and the address as decoded, marked as written with escapes. Lines without escapes are scanned
   exactly as today, and the existing exceptions (no-reply and example addresses, the deprecation notes
   npm copies into `package-lock.json`) still apply.

   *Check:* new tests in `test/public-scan.test.ts`: an address, a private IP and a LAN host name each
   written with escapes are caught; allowed addresses written with escapes still pass; a plain address
   isn't reported twice; text with backslashes that aren't escapes (Windows paths, regular expressions)
   isn't misread. The tests build their sample addresses at run time, as the existing ones do, so the
   test file itself stays clean. The whole repository still passes the check.
2. **Notes.** The roadmap item is ticked, the changelog gets an entry under "Unreleased", and the
   checker's description in the repo's guidelines and docs mentions escapes if they describe the rules.

   *Check:* `npm run verify`.

## Who's on it

CEO, Engineer, Security Officer and Auditor. No Researcher, QA or plan check: a small change to one
script and its tests.

## Risks

- **New findings in existing files.** If any file already holds an escaped address, the check fails
  until it's fixed. The team runs the check on the whole repository before asking for approval.
- **Other ways to disguise text** (HTML entities like `&#64;`, base64, words like "at" and "dot") stay
  out of reach; this closes the one gap found.

## Out of scope

- Other encodings (HTML entities, URL encoding such as `%40`, base64).
- Any change to which addresses are allowed.
