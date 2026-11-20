# Decisions log

Why past decisions were made, newest first.

## 2026-11-20: Renovate merges its own pull requests

Job `renovate-automerge` (#31).

**Decision.** Renovate merges its pull requests itself once every check passes,
majors included; new versions wait 3 days, security fixes and image rebuilds
don't, on the model homelab-atlas already uses. Kept manual: Electron majors,
esbuild, electron-builder, sherpa-onnx and Biome stay manual.
`platformAutomerge` is false ("Allow auto-merge" is off).

**Why.** The owner asked for every repo with Renovate to merge its updates
automatically (2026-11-20) and chose this model, majors included, over keeping
majors manual.

**Not done.** Repository settings and branch rules (owner only) and workflows
are unchanged. A group merges automatically only when every update in it may, so
each manual exception gets its own pull request.

**Review findings.** Fixed: stale docs that still promised a manual review or
named Dependabot, and (where it applied) exceptions that sat inside the update
group. None declined. Nothing merges until code-owner review is turned off on
`main` (an owner setting).

## 2026-11-17 - codeql-alerts

**Context:** the owner asked the team to look at the repository's code scanning alerts and resolve them.
Ten were open: three from CodeQL and seven from Scorecard.

**Decisions:**
- **Fix the three CodeQL alerts in code.** `resultUrl()` in web search matched DuckDuckGo with
  `hostname.endsWith("duckduckgo.com")`, which also matched look-alike names such as
  `evilduckduckgo.com`. A small helper now accepts only `duckduckgo.com` and names ending in
  `.duckduckgo.com`, in both places. The page test's inline-script check now matches any letter case and
  any end tag (`</script ...>`), and it counts every `<script` opening, so a tag the pattern misses fails.
- **Leave the Scorecard alerts to settings and time.** Branch protection is a repository setting (an
  owner item). Code review needs a second person. Maintained, SAST and CI tests change by themselves.
  The Best Practices questionnaire was already an owner item. Fuzzing becomes its own job because it adds
  a development dependency.
- Fixed alerts aren't dismissed by hand: CodeQL closes them on its next scan of `main`.

**Review:** the Security Officer found the fix real. They also checked port, case, userinfo,
look-alike, punycode, nested redirect and scheme cases. Search links are shown only as text inside the
untrusted-data block, and no other host or tag check in `src/` has the same weakness. The Auditor
approved: the new tests fail on the old code, and the page test fails for upper case, mixed case, spaced,
odd, unclosed and self-closing script tags. CodeQL on the pull request still flagged the end-tag form
`</script foo>`, so the end of the pattern was widened in a fix round. A second security review wasn't
available this month.

**Rejected findings:**
- *Strip one trailing dot from the host before the check* (Security Officer, should-fix, optional).
  Not taken: the old code behaved the same way, DuckDuckGo's page doesn't send that form, and such a link
  would only be shown as an ordinary result in text.

## 2026-11-16 - release-0-2-0

**Context:** the owner asked for a release with everything merged since 0.1.1, so the new work can be
installed and tried on Windows.

**Decisions:**
- **0.2.0, a minor release.** Since `v0.1.1`: the new look part 1 (#24), more online brains (#25), the
  OpenSSF badge (#26), the Home screen with a daily brief (#27) and the Welcome start-up sequence (#28).
  Four of them add features.
- The changelog's entries moved unchanged under the new heading, with "Added" before "Changed" as Keep a
  Changelog orders them; the links point to `v0.2.0`.
- The roadmap marks 0.1.1 as released and checked, and adds the owner's checklist sections for 0.2.0.
- The Windows checklist's upgrade step now says to raise the version by one patch step, instead of naming
  0.1.0 and 0.1.1.

**Review:** the Security Officer found nothing: the release workflow is unchanged and identical to the copy
in Releasing, only the three version fields changed, and a Linux `npm run dist:dir` build packaged every
file the five features need, with all seven fuses as configured. The Auditor approved, and noted the
checklist's stale upgrade versions, which were fixed. GitHub's checks pass, Windows included. A second
security review wasn't available this month.

**Rejected findings:** none.

## 2026-11-16 - welcome-boot

**Context:** the owner asked for the Welcome screen as a start-up sequence, part 3 of the new look, together
with the OpenSSF badge (#26) and the Home screen (#27).

**Decisions:**
- **Numbered steps** ("01 Where Sage thinks" to "04 Ready") in the new look's panels; the flow, buttons and
  Skip setup are unchanged.
- **Check lines only from real results** (the runner's status and version, the download result, the voice
  status), typed by the chat's typist and read out once per set through one status area. Step 01 has no
  check, so it has no lines.
- **Support codes from the failure states Sage already tells apart**, in one table in the code and a
  Troubleshooting table in `docs/installing.md`; a test keeps the two identical. No voice-download code
  (Welcome never downloads voice) and no "runner too old" code (Sage has no minimum version to compare).
- **Copy diagnostics is built by the main process** from a fixed list of fields, scrubbed (keys first, then
  home path, user name, e-mail addresses and web addresses), shown in full in a read-only box, and copied
  by the main process on a second click. The window sends only the step, the code and an id, so it can't
  choose the copied text. A text can be copied for 2 minutes and at most 3 times; only the newest build
  counts. It shows both the model a failed step tried and the saved model.
- **The runner's version** comes from a new request on the same fixed loopback address, asked at the same
  time as the model list, strictly checked, and kept only when the list answered.

**Review:** QA passed every plan step. The Security Officer cleared it, asking for limits on how the
window can trigger a copy and for the runner's two requests to run at once; both done. The Auditor found,
over two rounds: scrubbing that could break a key's redaction and leave parts of it, diagnostics naming
the saved model instead of the one that failed, an older build making the shown text uncopyable, a save
failure described as a download failure, and an old result read out after a retry, a step change or a
change of model. All fixed with tests. GitHub's code scanning flagged a test that stripped tags with a
pattern; it now matches the heading exactly. 574 tests; GitHub's Windows tests pass. No second security
review (quota out). The window was not seen on screen; the owner got a private preview page.

**Rejected findings:** none.

## 2026-11-16 - home-brief

**Context:** the owner asked for the Home screen with a daily brief, part 2 of the new look, together
with the OpenSSF badge (#26) and the Welcome start-up sequence (#28, built after this job).

**Decisions:**
- **Sage opens on Home** after setup; the Welcome screen still comes first when setup isn't done, and its
  exits still open Chat.
- **The brief is built by Sage itself** from a read-only summary, with fixed wording, and is never sent
  to the brain or added to the conversation: free, offline, and nothing leaves the PC. Read aloud unless
  "Read replies aloud" is Never; the optional morning brief (off by default) speaks only with Always.
- **Two window requests, no new message from the app to the window.** `sage:home` returns only what Home
  shows (bounded reminder text, note titles but never note text, three status values) and changes
  nothing. `sage:home-brief-claim` writes only the last brief day, once per local day, under the
  settings lock; that day never reaches the window, a Settings save keeps it, and it never moves
  backwards (a saved day more than two days ahead counts as a broken clock). Home polls when shown,
  every minute while on screen, and when a notice arrives.
- **Limits:** at most 5 missed reminders (newest, plus "and N more") kept apart from today's (at most
  10, those still to come first), so old missed ones can't hide what is due.
- **Each brief request has a number;** an older or unwanted one (Home left, window hidden) is dropped,
  and a morning check that comes to nothing never cancels a Brief me. Home has its own Stop button;
  sending a message stops the brief. The clock stops while the window is hidden and follows a change of
  time zone.
- **The chat cards from part 1** became their own roadmap item: they are a chat change, not Home.

**Review:** QA passed every plan step and asked for proof of two behaviours (the brief silent while the
microphone is open, a Settings save keeping the brief day) and safer checklist wording; all added. The
Security Officer cleared it. The Auditor found, over two rounds: the reminder cap hiding today's
reminders (and a false "Nothing is due today"), out-of-date briefs replacing newer ones or speaking after
Home was left, a sent message not stopping the brief, no Stop button on Home, the brief day moving
backwards, the clock running while hidden, a time formatter stuck on the first time zone, and a declined
morning check cancelling a Brief me. All fixed with tests. 534 tests. No second security review (quota
out). The window was not seen on screen (no display on the team's machine); the owner got a private
preview page.

**Rejected findings:** a keyboard test for the new buttons: the test window can't turn Enter or Space
into a click, so a static check that they are plain buttons was added instead, and the Windows checklist
walks through the keyboard.

## 2026-11-16 - openssf-badge

**Context:** the owner asked for the OpenSSF badge in the README (project 16810 on bestpractices.dev).

**Decisions:**
- **The Best Practices badge only**, under the title, linked to the project page. Other badges (such as
  the Scorecard's) were left out to keep the change to what was asked.
- **No changelog entry:** it changes nothing in Sage itself.
- **The questionnaire stays with the owner,** because it needs his sign-in. The badge reads "in progress"
  until it is complete.

**Review:** the Security Officer cleared it (only bestpractices.dev links over https; nothing private).
The Auditor approved (README layout unchanged; the badge page and image checked live). A two-file text
change, so no Researcher, QA or plain-English check.

**Rejected findings:** none.

## 2026-11-16 - brains-api

**Context:** the owner asked for Sage to use the big online model services as well as local models,
including through subscriptions. After the research ([docs/reports/2026-11-16-online-brains.md](reports/2026-11-16-online-brains.md))
he chose API keys for Claude, OpenAI and Gemini, and a subscription sign-in only for GitHub Copilot (a later
job).

**Decisions:**
- **No consumer subscription sign-in** for Claude, OpenAI or Google: Anthropic's and Google's terms forbid
  other apps from using it, and OpenAI's don't allow it anywhere the team could find.
- **One key per company, bound to its fixed address and checked at the moment of every request**
  (`ServiceKeys.keyForRequest`), not only when saved. Redirects are refused. Another online service keeps
  0.1.1's rules and key file, so 0.1.1 settings carry over unchanged.
- **Each service in its own format, no new packages.** Claude: the Messages format. Gemini: Google's own
  format rather than its chat-completions-style address, because newer Gemini models need their "thought
  signatures" sent back, which Google documents only for its own format. OpenAI: the Responses format
  (changed during review), because OpenAI's documentation says its recommended model can call tools only
  there.
- **A service's reply goes back unchanged within a message** (thinking blocks, signatures, encrypted
  reasoning), with the same system text and skills list for every request of the message; after the skill
  limit, tool use is switched off rather than the list changed. Newer Claude accounts refuse a request whose
  earlier turns changed. Earlier messages keep only the final text. If a thinking signature is refused,
  Sage strips the thinking once, retries, and keeps it out for the rest of the message.
- **Stopping a turn** (New chat, or a change of brain, model or key) cancels every later request of that
  turn, the retry included, and each request reads its key fresh.
- **Errors are mapped from the status and known type fields** (plus a few fixed phrases searched for and
  never shown); a service's own error text is never shown, logged or saved.
- **Privacy wording promises only what Sage controls:** what goes to which company, that Sage asks OpenAI
  not to keep the conversation, and that each company keeps requests under its own policies.
- **The research report was cut to a public summary** that names only the services Sage talks to now or
  plans to, and the plan paraphrases the owner's request (security review).

**Review:** QA passed every plan step. The Security Officer found no way for a key to leak; its should-fix
items (one model check per company at a time, printable-ASCII keys, a stale model check after a key change)
were fixed. The Auditor found, over two rounds: a pasted key that followed a brain switch, OpenAI's default
model needing the Responses format, Gemini calls without arguments rejected, Claude's thinking blocks
dropped during skill use, real credit and daily-quota errors missed, turns not stopped on a model or key
change, Gemini call ids dropped, cut-off replies shown as answers, a non-deterministic test, a retry sent
after a turn was stopped, an over-strong storage promise, refused thinking coming back, and failed OpenAI
replies shown as empty answers. All were fixed with tests. A second security review wasn't available this
month. Nothing was tried against the real services (no keys on the team's machine); the Windows checklist
covers that.

**Open after two fix rounds:** a Test or Load models result still on its way when that company's key
changes can be shown in Settings (Auditor, should-fix, display only). It is on the roadmap as a minor item.

**Rejected findings:** none.

## 2026-11-16 - hud-look

**Context:** the owner asked for Sage's interface, visuals and experience to closely follow
jarvis-agent.tech. The study is in [docs/reports/2026-11-16-jarvis-look.md](reports/2026-11-16-jarvis-look.md);
the work is split into three jobs, and this is the first.

**Decisions:**
- **Follow the patterns, not the product.** Sage takes the dark heads-up display, the voice orb, corner
  ticks, monospace labels, typed replies and short tones, with its own name, leaf, green palette, artwork,
  tones and words. The study lists patterns only and leaves out the product's exact colours, sound
  settings, wording and artwork (trimmed after the security review), and the orb's resting breath is
  4.4 seconds rather than the product's.
- **The question stays in the system box** (changed after the plan was approved, and told to the owner).
  The first plan put Allow and Decline in the chat window, which would have let the window answer. The
  window now only receives a one-way `sage:asking` message (open, then allowed or not) and shows a
  read-only amber card; the answer still comes only from the box. The preload exposes one listener and
  copies only known fields; the security test allows exactly one `ipcRenderer.on`.
- **Sound starts off** and is saved through its own `setSound` channel, which takes only on or off;
  Save settings keeps the stored value.
- **Dark is the default theme**, with Light and Match system kept. Text is never under 12 px, and a test
  checks 4.5 to 1 contrast for the main colours in both themes.
- **A review-only preview page** (`npm run preview`) is built from the real window files with a stand-in
  for Sage's main part, because the team's machine can't take screenshots of the window. It is never
  packaged.
- **Deferred to part 2:** cards for actions Sage took without asking (they need a new message from
  Sage's main part to the window), and showing a still-open question after the window reloads (the
  card is lost, while the box still works and decides).

**Review:** QA passed every step except the action cards (deferred, above). The Security Officer found no
problem in the code: the asking message is one-way, the box alone decides, the `setSound` channel and the
settings schema are tight, and the window's content rules are unchanged; it asked for the study to be
trimmed and the online services' names taken out of the plan, both done. The Auditor found two must-fix
problems (held notices showing before they were confirmed, because a display rule beat the hidden
attribute; the orb not pausing while minimised) and three should-fix ones (a slow settings read undoing a
mute, muting not stopping notes already scheduled, reduced motion not checked during typing); all were
fixed with tests. A second security review wasn't available this month.

**Rejected findings:**
- *Keep an open question's card across a window reload* (Auditor). Deferred, not fixed here: it is
  cosmetic, and the system box still asks and decides.

## 2026-11-16 - release-0-1-1

**Context:** the owner asked for the next item: a release with everything merged since 0.1.0, so one
installer can be tested.

**Decisions:**
- **0.1.1, a patch release.** Since `v0.1.0`: the deleted-reminder fix (#19), the public-repo checker reading
  escaped text (#20), the minimatch override (#21) and the chat window reorganised for test coverage
  (#22), plus internal pinning and docs changes (#10, #11, #17). No new features.
- The changelog's entries moved unchanged under the new heading; the links point to `v0.1.1`.
- The roadmap's owner item for the first release is ticked: 0.1.0 was released and its installer checked.

**Review:** the Security Officer found nothing: the tag protections are the same as for 0.1.0 (the tag must
be on `main` and match `package.json`, actions pinned, least-privilege permissions, checksum and
provenance), and nothing merged since 0.1.0 weakens the release. The Auditor approved after `npm run
verify` and a Linux `npm run dist:dir` build (packaged version 0.1.1). A second security review wasn't
available this month.

**Rejected findings:**
- *List the release workflow's exact Node version (24.22.3, from #10) in the changelog* (Auditor,
  should-fix). Not taken: the changelog lists changes that matter to people using Sage; internal build
  pins are recorded in the workflow file and its history, and 0.1.0's changelog follows the same rule.

## 2026-11-16 - window-coverage

**Context:** the owner asked for the next roadmap item: count the window script once in test coverage.

**Decisions:**
- **Make the window script a function rather than change the coverage tool.** `renderer.ts` did all its
  work on load, so each window test imported a fresh copy (`renderer.ts?window=N`), and the built-in
  coverage report counted every copy separately in the total and couldn't merge them for the file
  itself. Its start-up now sits in `startChatWindow()`, in the same order. A new `src/renderer/main.ts`
  calls it and is the build entry (output still `dist/renderer/renderer.js`, `index.html` unchanged).
  The tests load the file once and call the function per test on a fresh fake DOM. This matches the
  other window files (`createWelcome`, `createVoiceControls`). Rejected: a separate coverage tool (a new
  dependency for one file).
- **Coverage before and after** (lines / branches / functions): `renderer.ts` 79.93 / 63.83 / 40.00 ->
  96.43 / 89.13 / 83.33; all files 86.36 / 81.94 / 59.75 -> 99.13 / 94.62 / 94.88. Same 333 tests.
  `main.ts` isn't in the report because no test loads it; it is four lines.
- The two source-text checks in `test/renderer.test.ts` now allow the deeper indentation; they check the
  same things. The no-HTML security test now also scans `main.ts`.

**Review:** QA passed: the built `renderer.js` is the same window code apart from the wrapper (after
allowing for renamed identifiers), and no test was removed or weakened. The Security Officer found nothing:
`startChatWindow` is not reachable from the page (the bundle is one closed iife), and the CSP and
`index.html` are unchanged. The Auditor approved: the statement order, hoisting and closures keep their
meaning, and each test's timers and listeners stay with its own fake window. Small follow-ups, done in one
round: the guidelines and `docs/architecture.md` now name `main.ts` as the entry, and the first two commits
were combined so each commit passes the tests. CI can't open the real window, so the owner checks it after
the next install.

## 2026-11-16 - minimatch-advisory

**Context:** the owner asked for the next roadmap item: track the minimatch advisory
(GHSA-g3hv-75wg-m249, moderate) in electron-builder's build tools and take the update that fixes it.

**Decisions:**
- **Override now instead of waiting.** No electron-builder release asks for the fixed minimatch, not even
  the 27 preview, so the owner approved npm `overrides` instead. Keys are version-qualified
  (`minimatch@^10.2.5` under `app-builder-lib`, `minimatch@^9.0.3` under `@electron/universal`) so the
  older 3.x and 5.x copies, which the advisory doesn't cover, stay as they are. A plain
  `"minimatch"` key under the parent moved those too and left an invalid tree.
- **Pinned to exactly 11.0.8**, like the repo's other npm versions. Renovate can't read version-qualified
  override keys, so the entries are maintained by hand; CONTRIBUTING.md says to remove each one when its
  parent asks for 11.0.1 or later, and to check `npm ls minimatch` and `npm audit` after every
  electron-builder update. The electron-builder Renovate rule now carries a reminder.
- **Evidence that the installer is unchanged:** the unpacked Windows app (`npm run dist:dir`) was built from
  main and from the branch. The `app.asar` listing (37 entries), the unpacked folder (78 files) and the
  sha256 of every file inside `app.asar` matched, apart from `package.json`, which gains only the
  `overrides` block. The Auditor also ran 2,805 file-pattern comparisons between minimatch 10 and 11
  through electron-builder's own filter code, including Windows drive and UNC paths, with no difference.
  The real Windows installer is built only at release time.

**Review:** QA passed. The two security reviews found no blockers. They noted the new transitive package
`@isaacs/nonrecursive-glob-match` (same maintainer as minimatch, dev-only, young, no provenance
attestation): low risk, accepted. Both security reviews and the Auditor asked for an exact pin and clearer
removal notes (done, one fix round). The Auditor approved.

## 2026-11-16 - public-scan-escapes

**Context:** the owner asked for the next roadmap item: "Public-repo checker: also catch e-mail
addresses written with JSON escapes", a gap found during the installer job.

**Decisions:**
- **Decode the way JSON does, in one pass:** `\u` with four hex digits, an escaped backslash (to one
  backslash) and `\/`, in every text file, with no repeated decoding. Every rule runs on the decoded line
  too, with the same exceptions.
- **Findings are placed by position, not by text.** A plain finding that overlaps one in the decoded
  line is replaced by the fuller decoded one, so each occurrence is reported once.
- *Not covered:* HTML entities, `%40`, base64, `\x40`, `\u{40}` and words like "at" and "dot".

**Review:** the Security Officer found nothing to fix and noted the wording should name the exact
escapes (done). The Auditor found a Windows path hidden by mixed escapes and an address reported twice,
then two dedupe cases left by matching on text; the position rule fixed both. The Auditor approved
after checking thousands of generated lines against the old checker.

## 2026-11-16 - notice-recollect

**Context:** the owner asked to move to the next roadmap item: "re-collect window notices before showing
them when Chat opens", the open point from the foundation review.

**Decisions:**
- **Collect, then confirm.** Opening Chat and the window coming back into view collect the notices
  first. One collection runs at a time; a request that arrives meanwhile makes one more follow, and
  confirming happens only after the last successful one.
- **Held notices stay hidden** in the chat until the moment they are confirmed, so a notice withdrawn in
  the meantime is never seen.
- **The 5-second poll never queues** behind a running collection; only opening Chat and the window
  coming back do.
- **New chat forgets held notices** (except ones already being confirmed, which were already shown), so
  the next collection adds them to the new list before they are confirmed.

**Review:** the Security Officer found nothing to fix. The Auditor found four problems in the first
version (a held notice visible for a moment before the check finished, a failed check confirming stale
notices, a request dropped during a confirmation, and later batches confirmed while Chat was hidden, an
older gap) and, in re-checks, three narrower ones the fixes opened (slow checks could starve
confirmation, and New chat could let a notice be confirmed without ever appearing, in two ways). All
were fixed with a test each. This took three fix rounds instead of the usual two, because the last
problem was found in a fix and was a few lines to close.

## 2026-11-16 - docs-sync

**Context:** the owner asked to "start the docs sync job" after merging Renovate's "Pin dependencies"
update (#10), which changed three lines of the release workflow (two version notes and the exact Node
version, `24.22.3`) but not the guide's copy of it.

**Decisions:**
- **The copy is made identical to the real file again**, and the guide says the real file wins if they
  differ. A release runs the version of `.github/workflows/release.yml` in the tagged commit.
- **No test that forces the two to match.** Renovate can't update the docs in its own pull requests, so
  such a test would block every workflow update. The copy is brought up to date by hand now and then.

**Review:** the Security Officer found nothing to fix. The Auditor found that the first wording ("the
file on `main` is the one that runs") was wrong for a tag on an older commit, and that `#16` isn't a link
in a Markdown file; both were fixed and re-checked. The approved plan keeps its original wording.

## 2026-11-16 - release-0-1-0

**Context:** the owner asked to "start the release workflow job".

**Decisions:**
- **The owner adds the workflow; the team prepares the version.** The team doesn't add or change
  workflow files, so the owner added `.github/workflows/release.yml` through GitHub from the text in
  [Releasing](releasing.md) (#16). Before he merged it, the CEO checked it was the same text, byte for
  byte, and a workflow checker found no problems. The team's part is the version pull request (#15).
- **The tag stays with the owner.** Pushing `v0.1.0` publishes Sage, so the owner does it (step 6).
- **The first release only changes the changelog:** `package.json` already says `0.1.0`. The entries
  move under `## [0.1.0] - 2026-11-16`, unchanged, with Keep a Changelog links. If the tag is pushed on a
  later day, the date can be left or corrected in a small pull request.

**What we learned:** a commit made on GitHub's website has no sign-off line, so the required "DCO
sign-off" check failed on #16. The owner re-saved it with a sign-off. GitHub can add the line itself
(**Settings → General → Require contributors to sign off on web-based commits**).

**Review:** the Security Officer found nothing to fix; the Auditor approved, and confirmed the workflow
doesn't read the changelog, so its format can't break the release. A note that the changelog's opening
line still said versions "will follow" Semantic Versioning was taken.

## 2026-11-16 - sage-icon

**Context:** the owner asked to "start the Sage icon job", the roadmap item "A Sage icon for the
installer, the shortcuts and the window".

**Decisions:**
- **An original design in Sage's own green.** Three designs were offered on the plan (a sage leaf, a
  leaf in a speech bubble, an S made of two leaves). The owner approved the plan without choosing, so the
  recommended leaf was built. It stays clear at taskbar size.
- **One picture for everything.** The installer tool makes every Windows icon size, and the installer's
  and uninstaller's icons, from one 512 by 512 PNG; no `.ico` files are kept in the repo.
- **The drawing is the source.** `build/icon.svg` is the file to edit; `build/icon.png` is made from it
  with a renderer installed outside the repo (pinned version, install scripts off), so Sage gains no
  dependency. `build/README.md` gives the exact command, and it reproduces the committed picture byte
  for byte.
- **The window gets the picture from the build** (`dist/icon.png`, outside `dist/renderer`), so the
  page can't load it and the window's request filter is unchanged.

**Review:** the Security Officer found nothing to fix (no metadata in the pictures, a plain SVG, the
window's settings unchanged); the Auditor approved, after checking a packaged build: the picture is in
the app, `Sage.exe` holds seven icon sizes, and the re-render command works.

**Rejected findings:**
- *Pin the renderer by checksum in the re-render note* (Security Officer, low). Not done: it is a
  one-off step that draws a picture, outside the repo, with an exact version and install scripts off,
  and the result is checked by eye and by the test before it is committed.
- *Keep the plan's options picture out of the repo* (Security Officer, a note). Kept: plans stay in
  `docs/plans/`, and the picture shows what the owner chose from.

## 2026-11-16 - first-run-setup

**Context:** the owner asked to "start the first-run setup job", the roadmap item "Checks that the local
model runner is installed, downloads a model, and lets the user add an online-service key", after voice
shipped.

**Decisions:**
- **A Welcome screen as a third view** in the existing window, shown until the user skips or finishes
  (a `setupDone` setting, added without changing the settings version; Settings saves keep it). Existing
  copies of Sage see it once. **Set up Sage** in Settings brings it back.
- **The runner is checked over its own interface** on `127.0.0.1` (the same fixed address and rules as
  chat). Sage can't run programs, so it doesn't install the runner and can't tell "not installed" from
  "not started"; both get one message.
  - *Rejected for now:* looking for the runner's program files (brittle; a later idea on the roadmap).
- **One link out of Sage:** after asking in its own box, Sage opens one fixed address in the browser,
  the runner section of its own install guide on GitHub, which holds the runner's download link. Nothing
  else can be opened, and the address can't come from the window, a reply or a web page.
  - *Rejected:* a link straight to the runner's site (the guide keeps the link and steps in one place);
    showing the address only as text (more work for the user; it is still shown if the browser fails).
- **Two models only, Standard (`qwen3:4b`) and Smaller (`qwen3:1.7b`)**, both Apache-2.0 and able to use
  Sage's skills. The window sends only the choice, never a model name. The download is asked about
  first with its size, performed and checked by the runner (Sage doesn't fingerprint it, and the box
  says so), read line by line with caps, stopped after 2 minutes without real progress, and makes Sage
  use the local brain (the box says so). Once the download has finished and the save has started, the
  save is the commit point: Cancel or Skip before it saves nothing, after it the model stays chosen.
- **The online key stays in Settings:** choosing an online service opens Settings; no second key form.
- **Voice is left to first use**, with a line on the last step.

**Review:** a plan check before Gate A, then QA (pass), the Security Officer (clear), a second security
review and the Auditor, with two fix rounds and a re-check after each. The runner and the native boxes
can't run on the review machine, so the owner runs the checklist's First-run setup section on Windows.

**Fixed after review:** Skip didn't cancel a model request still checking or asking; switching to local
through setup didn't stop a running online reply; the stall limit could be kept alive by repeated or
alternating lines or a trickle of bytes; the number of download layers wasn't capped; Skip could undo
unsaved Settings edits, and a late refresh could overwrite a newer Settings save; Next stayed on the
previous model; a failed "set up" save was ignored; the box didn't say the brain switches to local; one
log line could have carried an error object.

**Rejected or deferred findings:**
- *A save already under way should be undone by Cancel* (Auditor, re-check). Not done: the write is
  atomic and can't be safely undone. Instead the save is the commit point, and Cancel says it was too
  late (see the decisions above).
- *The install-guide link follows `main`* (QA and the Security Officer, informational). Kept: the page is
  this repo's own guide, and its anchor already exists on `main`.
- *Ctrl+Space no longer works on the Settings screen* (QA, informational). Kept: talking only makes sense
  on Chat, where the words go.

## 2026-11-16 - voice

**Context:** the owner asked to "start the voice job", the roadmap item "Hold a key to talk, offline
speech recognition, and spoken replies", after the Windows installer shipped.

**Decisions:**
- **sherpa-onnx (`sherpa-onnx-node` 2.0.1, Apache-2.0) for speech recognition**, Sage's first run-time
  dependency and first native code. It has ready-built files for Windows and Linux and no install
  scripts. Its native files are kept unpacked next to the app's archive, because Windows can't load them
  from inside it.
  - *Rejected:* Chromium's built-in speech recognition (it sends audio to an online service, and doesn't
    work in Electron); Whisper in the window (it needs the content rule loosened for WebAssembly and
    fetches models from the window); whisper.cpp add-ons (a release candidate with a setup script, or
    built on the user's PC); Vosk (unmaintained).
- **The Moonshine tiny English model (MIT), downloaded once after asking.** About 44 MB in three files
  from Hugging Face, pinned to one commit, each checked by exact size and SHA-256 before use, and checked
  again once per run before its first use. Redirects are followed by hand, at most five, each over HTTPS.
  A download that stalls for 30 seconds stops. The owner kept this choice at plan approval.
  - *Rejected:* bundling the model in the installer (44 MB bigger, and the copy run from source would
    still need its own download); a file the user copies in by hand.
- **Recognition runs in its own helper process** (Electron's utility process), so a crash or a hang
  can't freeze or close Sage's window; a 60-second limit, and a fresh helper after a crash.
- **Hold to talk only while Sage's window is focused** (Ctrl+Space, or the Talk button). A key held
  anywhere on the PC needs a system-wide keyboard hook, the kind of code a keylogger uses.
- **The words go into the message box, never sent on their own**, so a misheard word is never sent
  unseen. A held or repeating Enter can't send them either: sending needs a fresh press.
- **The window records with the browser's standard recorder** and converts the sound itself, with no
  worklets, workers or `blob:` addresses, so the window's security settings and content rule are
  unchanged. The audio is checked by size and type before the main part reads it, and is never saved or
  logged.
- **Spoken replies with the PC's own voices** (only voices that run on the PC), with a "Read replies
  aloud" setting: after voice messages (the default), always or never. A message counts as a voice
  message while any dictated words stay in it. Only the final reply is read. The setting was added
  without changing the settings file's version, so older settings files load unchanged.
  - *Rejected for now:* sherpa-onnx's own voices (a second download and more code); that is the later
    "Better voices" job.

**Review:** a plan check before Gate A, then QA (pass), the Security Officer, a second security review
(clear) and the Auditor, with two fix rounds and a re-check after each. The engine and the real model
were run on the review machine outside Electron (a real download and a correct transcription). The
microphone, the helper process inside the installed app and the PC's voices can only be checked on
Windows, so the owner runs the checklist's Voice section before final approval.

**Fixed after review:** releasing a keyboard-held Talk button after focus moved didn't stop the
recording; a held Enter could send dictated words without a fresh press; a transcript could push the
message past 8,000 characters; a status line could stay after New chat; a stalled download waited
forever; the model was re-checked only by size; the download box said "Nothing is sent" (now: none of
your speech or text is sent).

**Rejected or deferred findings:**
- *Clear the voice mark on New chat* (a fix-round request). Reversed: New chat keeps the words in the
  box, and the plan says a message with dictated words counts as a voice message.
- *A model file changed while Sage is running isn't caught* (Security Officer, informational). Accepted:
  it needs write access to Sage's data folder, which already allows worse; the assurance case says so.
- *Line coverage drifts toward the floor* (Engineer). Real, caused by how window tests are counted;
  added to the roadmap.

## 2026-11-16 - windows-installer

**Context:** the owner asked to "start the installer job", the next roadmap item, after running the
Windows checklist (everything worked) and checking the GitHub settings (Dependabot alerts on, Dependabot's
own update pull requests off).

**Decisions:**
- **electron-builder 26.18.1 with a one-click NSIS installer**, per user, with no admin rights, shortcuts,
  and Sage starting when it's installed. Uninstalling keeps Sage's data.
  - *Rejected:* Electron Forge with Squirrel or an MSI. It would mean reorganising the build around
    Forge, and MSI isn't one-click. electron-builder's own docs mark its Squirrel target as deprecated.
- **The data folder stays `%APPDATA%\sage-assistant`.** "Sage" is set as the product name only in
  `electron-builder.json`, never in `package.json`, because Electron names the data folder after the
  archive's `package.json`. A test checks this.
- **Settings in JSON** (`electron-builder.json`), so the fuse drift test reads them with no extra package.
- **All seven fuses are set by electron-builder** right before any signing step. A test keeps
  `electron-builder.json` and `src/main/fuses-config.ts` the same. The old `npm run fuses` script is
  removed. The two new fuses (`GrantFileProtocolExtraPrivileges` off, `EnableCookieEncryption` on) stay
  only if the owner's Windows test shows the window still loads.
- **zod moved to the dev dependencies.** It is bundled into `main.cjs`, so the archive holds no
  `node_modules`.
- **`electron-winstaller`'s install script is off** (`allowScripts`). It only copies a 7-Zip file for
  Squirrel, which NSIS doesn't use. Renovate notes on electron-builder updates say to check its version.
- **The release workflow is ready-to-paste text** in `docs/releasing.md`, because the team doesn't add
  workflows. It builds only tags on `main`, uses no shared cache, checks the tag against
  `package.json`, writes `SHA256SUMS.txt` and a build provenance record, and publishes exactly three
  files. Only the publishing job can write to the repo. It also finishes an empty draft that an earlier
  run left behind.
- **The public-repo checker** skips e-mail addresses on a `package-lock.json` line only when the whole
  line is npm's copied `"deprecated"` notice (one such notice names a package author's public address).
- **No icon yet, no signing yet.** The installer uses Electron's default icon, and SmartScreen warns about
  the unsigned installer; the docs explain how to check the checksum and continue.

**Review:** a plan check before Gate A, then QA, the Security Officer, a second security review and the
Auditor, with one fix round and a re-check. The real installer can only be built on Windows, so the
owner builds and installs it from the branch, with the checklist's "Installed app" section, before
final approval.

**Rejected or deferred findings:**
- *`npm audit` must be clean (Auditor, must-fix).* Rejected for this job. The one advisory
  (GHSA-g3hv-75wg-m249, minimatch, moderate) is in electron-builder's build tools, and the fixed
  minimatch is a major version electron-builder 26.18.1 doesn't accept; `npm audit fix --force` would
  drop to electron-builder 25. The code runs only at build time, on file patterns the repo writes, and
  both security reviews found it unreachable from untrusted input. Tracked on the roadmap.
- *The Dependency review check will fail on that advisory and on one WTFPL-licensed package (both
  security reviews).* Not so: the check passed on the pull request, so the owner didn't need to change it.
- *The public-repo checker misses e-mail addresses written with JSON escapes.* Real, but older than this
  job. Deferred to the roadmap.

## 2026-11-16 - biome-2-6-8

**Context:** the owner asked to "fix the Biome PR". Renovate's pull request #4 moves Biome from 2.5.15
to 2.6, and its checks failed. Biome 2.6 started formatting Markdown files, so every doc failed the
format check (it wanted to pad tables with spaces and change the italics style). The code itself passed.
The `$schema` line in `biome.jsonc` also needed the new version number. The team can't push to
Renovate's own branch, so the update was made in this job's pull request instead.

**Decisions:**
- **Biome 2.6.8, exact version**, the same as Renovate's update. The lockfile changes only Biome's own
  packages. Two new optional packages for Android are listed by Biome 2.6.8 itself, and are never
  installed on Windows or Linux. None of the changed packages runs an install script.
- **Biome's Markdown formatter is off** (`"markdown": { "formatter": { "enabled": false } }` in
  `biome.jsonc`, with a comment). The docs are hand-written prose, wrapped by hand and reviewed in pull
  requests. The linter and the formatters for code and JSON are unchanged.
  - *Rejected:* letting Biome reformat every doc. It is a large change with no gain for readers, and it
    would make the docs' history harder to follow.
  - *Rejected:* leaving `.md` files out of Biome's file list. Turning off only the Markdown formatter is
    narrower, and keeps any future Markdown checks Biome adds.
- **Docs that name the Biome version** (the repo's guidelines, CONTRIBUTING and the architecture page)
  now say 2.6.8.

**Review:** the Security Officer, a second security review and the Auditor all found nothing to fix.
`npm audit` found no vulnerabilities, and the registry signatures were verified. QA and the plan check
were skipped because the change is small. No fix rounds were needed.

**Follow-up:** Renovate's #4 is replaced by this pull request. Renovate should close it on its next run
after this one is merged; if it doesn't, the owner can close it by hand.

## 2026-11-16 - renovate

**Context:** the owner asked: "This will use Renovate instead of Dependabot." By then the owner had added
the GitHub workflows, CODEOWNERS, private vulnerability reporting and a branch ruleset ("Main"). They
had also installed the Renovate app and merged its starter config. That config failed the Biome format
check, so CI on `main` was red until this job.

**Decisions:**
- **Scope:** Renovate for npm and GitHub Actions only (`enabledManagers`).
- **Schedule:** weekly, before 6am on Monday, US Central time. Security fixes come at any time, with a
  `security` label. The lockfile is refreshed monthly.
- **Exact versions:** kept with the `:pinAllExceptPeerDependencies` preset.
  *Rejected:* a global `rangeStrategy: "pin"`. It would also pin `engines.node` to one exact Node release.
- **Actions:** stay pinned to a full SHA (`helpers:pinGitHubActionDigests`). Minor, patch and digest
  updates of actions are grouped, and the CodeQL actions always move together.
- **A 3-day wait** before a new npm release is proposed, as a guard against a just-published bad release.
  - Vulnerability-alert pull requests are exempt: that is Renovate's default.
  - The monthly lockfile refresh is exempt too, because it has no release date. Without the exemption its
    check would stay pending forever.
- **Electron:** major versions come in their own pull request, with a note pointing to the Windows
  checklist.
- **Manual follow-ups:** esbuild and Biome updates carry notes about the change a person has to make on
  the same pull request (`allowScripts`, the `biome.jsonc` schema line).
- **No auto-merge.** Renovate never merges its own pull requests.
- **The checks page:** `docs/github-checks-to-add.md` became `docs/github-checks.md`, a short record with
  links to the workflow files instead of copies of them. Settings the team can't read (secret scanning and
  push protection, Dependabot alerts on, Dependabot's own update pull requests off) are listed for the
  owner to check.

**Review:** QA, the Security Officer, a second security review and the Auditor, with two fix rounds. The
install-script finding was raised by both security reviews, so it counted as confirmed. The checklist now
covers any package that adds an install script, not only esbuild.

**Windows test fix:** with `main`'s format error gone, CI ran the tests on Windows for the first time.
Three file-opening tests failed there. The runner's temp folder has a short 8.3 name, while Sage
correctly reports real (long) paths. The test helper now returns the real path. This was test-only; the
app was right.

**Rejected or deferred findings:**
- *"Renovate is installed" can't be shown from the repo.* Rejected: the onboarding pull request (#2) was
  merged, and Renovate has opened update pull requests.
- *The DCO check's bot exemption trusts the commit author, which a contributor could fake.* Deferred: it
  needs a workflow change, which is the owner's to make. The risk is low, since the owner reviews every
  pull request.

## 2026-11-15 - sage-foundation

**Context:** the first job for S.A.G.E. (System for Assistance, Guidance & Execution). The owner wants a
desktop assistant that runs on a Windows PC, installs as its own app, and runs from source on Linux.

**Decisions (owner):**
- Name: S.A.G.E., "Sage" for short.
- Target: a Windows PC first; Linux runs from source.
- Brain: switchable. A local model runner on the same PC by default, or an online model service with the
  owner's own key.
- v1: a chat window, then hold-a-key voice; a wake word later.
- v1 skills: answer questions, open apps and files, web search, notes and reminders. Anything that
  changes the computer asks first.
- Packaging: its own desktop app built with Electron, with a one-click installer on Windows.
- This repo's code and docs may name the model runner Sage talks to and describe Sage as an assistant.
  Nothing says who or what wrote the code.

**Decisions (plan, approved on PR #1):**
- **One language: Electron with TypeScript, and no local server.** The window talks only to the app's own
  main process.
  *Rejected:* Python with a Qt window (no Electron installer); Python with a local web server (an open
  port is the most common hole in similar projects); Tauri or Electron with a Python helper (two
  toolchains).
- **Local brain:** the local model runner's HTTP API, fixed to `127.0.0.1`, with redirects refused.
- **Online brain:** any service that speaks the common chat-completions format, so no vendor library is
  needed. HTTPS is required, except to loopback.
- **The online key:** encrypted with the system's protection (Electron safeStorage) and tied to the
  service address it was entered for. Changing the service removes the key, and a turn already running
  stops.
- **Ask first:** opening an app or a file and deleting a note or reminder always ask. The box is a native
  main-process box with "Don't allow" as the default. An approval is single-use and bound to the exact
  program, file or item. There is no run-command skill and no "always allow" mode.
- **Notes and reminders:** adding them is safe, because they are Sage's own data. They are capped at 3 per
  message because web text could try to make the model add them.
- **Opening files:** only document, picture, sound and video types, and only inside approved folders.
- **Licence:** MIT.
- **Search:** DuckDuckGo's HTML page, with no key. The source can be swapped, and results are untrusted
  text.
- **No GitHub workflows from the team:** the checks ran locally with `npm run verify`, and the job handed
  over ready-to-paste workflow text. The owner has since added the workflows; `docs/github-checks.md`
  now records what is in place.
- **Order of the next jobs:** Windows installer, then voice, then first-run setup.

**Review:**
- There were three review rounds, plus a fix for tests that failed on a busy machine. Then came the
  owner's feedback round, with re-checks.
- The second security review was skipped because it couldn't be started on the build machine.
- Every file and commit message was scanned for wording the repo's rules forbid before review. The scan
  was clean.

**Rejected or deferred findings:**
- *Remove the list of roles from the plan file.* Rejected: plans name roles by design, and that says
  nothing about who wrote the code.
- *A reminder can appear twice if Windows confirms the notification after 5 seconds.* Accepted as a
  residual risk; see the assurance case.
- *A reminder can be lost if the window crashes in the instant between receiving it and showing it.*
  Judged too rare to handle in this job.

**Owner's feedback at final review ("fix"):** three items that were open after the two fix rounds are
now fixed:
- **Save key** is refused unless the address on screen is the saved one.
- **A reminder shown in the window** counts as shown only after the window confirms it is on screen. It
  isn't confirmed while Settings is open or Sage is minimised, and it comes back after a restart.
- **Deleting a reminder** withdraws it from the window queue.

Each re-check found a narrow follow-on case in the new window code. Two of them were fixed in small extra
rounds, so the work went past the usual limit of fix rounds, because those bugs came from the fixes
themselves.

**Still open (minor):**
- **A deleted reminder can show once.** The sequence: a delete is waiting for Allow while Settings is open,
  the reminder comes due, the user allows the delete, then goes back to Chat within the 5-second refresh.
  The deleted reminder can then appear once.
- It needs Settings open while the confirm box is waiting. The box is modal, so this is probably
  unreachable in the real app.
- Nothing is lost or exposed. Fix: re-collect notices before showing them when Chat opens.
- Fixed by job notice-recollect: Chat opening and the window becoming visible now collect before confirming.
