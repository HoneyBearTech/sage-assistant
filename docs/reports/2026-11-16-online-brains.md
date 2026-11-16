# Research: Claude, Codex, GitHub Copilot and Google Antigravity as Sage's brain

Research report, 2026-11-16. The owner asked for Sage to use these services as well as local models.

How sure I am: the Anthropic, GitHub and Google text below was read on the vendors' own pages (fetched
this session). The OpenAI Terms of Use page returned HTTP 403, so its clauses are NOT read. Several OpenAI
and Google pages were long, and where a fact came from a tool summary rather than verbatim page text I say
"(summary)". I am not a lawyer; "ToS verdict" is a reading of the text, not legal advice. Facts I did not
verify are marked UNVERIFIED.

What Sage has today (read from the repo): `Brain` interface = one non-streaming call
`chat(messages, tools) -> {ok, content, toolCalls[] | message}`; `LocalBrain` (local runner on 127.0.0.1) and
`OnlineBrain` (`<base>/v1/chat/completions`, bearer key, https only, one key bound to one service origin,
stored with Electron safeStorage; refuses to store on Linux without a real keyring). No vendor SDKs. The
assistant loop runs the tool calls itself through the ask-first gate, max six rounds.

---

## Summary table

| Service | Route | Sign-in | Cost to user | ToS verdict | Windows | Chat-only mode | Recommended? |
|---|---|---|---|---|---|---|---|
| Claude | Anthropic API (Messages API, HTTPS) | API key from Console | Pay per token; no free tier assumed | Clean | Yes (plain HTTPS) | Native: Sage sends its own tools, none run by the vendor | **Yes, build first** |
| Claude | `claude -p` driven with the user's Pro/Max login | Subscription OAuth (browser) | Plan price; limits shared with their own use | **Grey, leaning forbidden** for a third-party app | Yes (CLI) | `--tools ""` + `--disallowedTools "mcp__*"` (my combination, not a documented recipe) | No (offer at most as a clearly labelled "advanced, at your own risk" later, or not at all) |
| Claude | Agent SDK | API key only for products | Per token | Clean with API key; subscription login not allowed for third-party products | Yes | Same as CLI | No (adds nothing over the plain API for a chat brain) |
| Codex / OpenAI | OpenAI API (chat completions / Responses) | API key | Pay per token | Clean | Yes | Native | **Yes, already works** through the existing online brain |
| Codex | `codex exec` with ChatGPT sign-in | ChatGPT login (browser, device code beta) | Plan price (Plus $20, Pro from $100) | **Grey: no OpenAI text found that allows it; Terms of Use unread (403)** | Yes (Windows sandbox exists, install details unverified) | Default exec sandbox is read-only, but it can still read files and run commands; not truly chat-only | Not first; maybe later as "advanced" after the owner reads the Terms |
| Codex | Codex SDK (`@openai/codex-sdk`, `openai-codex`) | ChatGPT login or API key | As above | Same grey for subscription; docs steer automation to API keys | Node/Python | `Sandbox.read_only` (still reads files) | No |
| GitHub Copilot | Copilot SDK (GA, becoming "Microsoft Copilot SDK") over the Copilot CLI | GitHub device-flow sign-in, GitHub OAuth App, fine-grained PAT, or BYOK | Copilot Free/Pro $10/Pro+ $39/Max $100 per month (AI Credits quotas) | **Best-supported subscription route; docs describe multi-user apps. No clause found that bans it** (GitHub terms read in part; Copilot-specific terms not fully read) | CLI exists on Windows (implied, install page unread) | `--available-tools` / `--excluded-tools` / `--deny-tool`; SDK tool lists (details UNVERIFIED) | **Yes, second** (the one subscription route worth building) |
| GitHub Copilot | `copilot -p` | Same | Same | Same | Same | `-s --no-ask-user --available-tools=` (empty list UNVERIFIED) | As a fallback to the SDK |
| GitHub Copilot | GitHub Models API | PAT | n/a | n/a | n/a | n/a | **No: retired 2026-07-30** |
| Google Antigravity | Gemini API key (Google AI Studio) | API key | Free tier exists for some models, paid higher limits | Clean (Google's recommended route) | Yes (plain HTTPS) | Native | **Yes, third** |
| Antigravity | Antigravity SDK (`google-antigravity`, Python) with API key / Vertex | API key | Per Gemini API pricing | Clean | Python only | `deny("*")` policy | No (Python, not needed) |
| Antigravity | `agy -p` with Google AI Pro/Ultra login | Google account OAuth | Plan price | **Forbidden for third-party wrapping** (FAQ + Terms section 6) | Yes | No documented read-only flag | **No. Do not build.** |

---

## Each service in detail

### 1. Claude (Anthropic)

**What it is / routes.**
- Anthropic API (Messages API): the supported way for any product. Native tool use (JSON schema tools) and
  streaming. Official SDKs exist, but a plain `fetch` works and keeps Sage's "no vendor SDKs" rule. Sage
  would add a third brain class with its own message mapping (system prompt separate, tool results as
  user-role blocks); it does not fit the chat-completions format one-to-one. (From my own knowledge of the
  API; check the API reference when building.)
- Claude Agent SDK (TypeScript/Python) and `claude -p`: the same agent loop that Claude Code uses, with its
  own built-in file/shell tools. Docs: "To drive the same agent loop from a language other than Python or
  TypeScript, run the CLI as a subprocess with the `-p` flag and `--output-format json`."
  (https://code.claude.com/docs/en/agent-sdk/overview)

**Sign-in.** API key (Console), or subscription OAuth (`claude` login, or a long-lived token from
`claude setup-token`). In `-p` mode "the key is always used when present." `--bare` mode "never reads OAuth
credentials or the system keychain", so a chat-only `--bare` run needs an API key anyway.
(https://code.claude.com/docs/en/authentication, https://code.claude.com/docs/en/headless)

**Credentials kept by the CLI** (same authentication page): macOS Keychain; Linux
`~/.claude/.credentials.json` mode 0600; Windows `%USERPROFILE%\.claude\.credentials.json` "and inherit the
access controls of your user profile directory". So on Windows and Linux it is a plain file. Sage must never
read it.

**Cost / limits.** API: per token, billed to the user's Console account. Subscription: plan price, and
"Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and
the Agent SDK." (legal-and-compliance page). Secondary sources (not verified against Anthropic) report that
in 2026 Anthropic discussed moving `claude -p` / Agent SDK use onto a separate credit and then paused it;
treat as unconfirmed.

**ToS (read on https://code.claude.com/docs/en/legal-and-compliance, section "Authentication and credential use"):**
- "**OAuth authentication** is intended exclusively for purchasers of Claude Free, Pro, Max, Ultra, Team, and
  Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native
  Anthropic applications."
- "**Developers** building products or services that interact with Claude's capabilities, including those
  using the Agent SDK, should use API key authentication through Claude Console or a supported cloud
  provider."
- "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or
  to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users."
- "Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens —
  sign-in to a Claude account must complete through Anthropic's own flow."
- Agent SDK page: "Unless previously approved, Anthropic does not allow third party developers to offer
  claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the
  API key authentication methods described in the Quickstart instead."
- One softer sentence: "Nor does it prevent an end user from signing in to the unmodified Claude Code binary
  with their own Claude subscription, including where a platform hosts Claude Code as described under *Can
  customers offer Claude Code in their products?* above." That is about hosting Claude Code itself, not
  about a different app using the CLI as its model engine.
- Press coverage of the same change (Feb 2026): https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546

**Verdict.** API key: clean. Sage launching `claude -p` with the user's Pro/Max login: **grey, and I read it
as against the rules**: Sage would be "a different product" whose requests go through plan credentials. The
clause about "route requests through ... plan credentials on behalf of their users" is the one that bites.
A Sage that only checks "is claude installed" and tells the user to use it themselves in a terminal is fine,
but that is not a brain.

**Chat-only.** CLI reference rows: `--tools`: "Restrict which built-in tools Claude can use. Use `""` to
disable all ..."; `--disallowedTools`: "`"mcp__*"` removes every MCP tool"; `--max-turns` limits agentic
turns. Chat-only = `claude -p --tools "" --disallowedTools "mcp__*" --output-format json --max-turns 1` (my
combination; the docs give no single "chat-only" recipe). `--bare` would also skip hooks, skills, CLAUDE.md
and plugins, but note it says Claude "has access to Bash, file read, and file edit tools" in bare mode unless
you also pass `--tools ""`, and it blocks subscription login. (https://code.claude.com/docs/en/cli-reference)

**Windows / install / detect.** API route needs nothing installed. CLI: install Claude Code, run `claude`
once to sign in; detect with `claude --version` (installed) and `claude auth status` (UNVERIFIED command
name; check the CLI reference). Do not read `.credentials.json` to check sign-in.

### 2. Codex (OpenAI)

**What it is / routes.** OpenAI's coding agent: CLI (`codex`), IDE extension, desktop app, cloud, and SDKs.
Docs moved to https://learn.chatgpt.com/docs/* (developers.openai.com/codex/* returns a 308 redirect).
- OpenAI API (chat completions / Responses): standard, key-based; Sage's existing online brain already
  speaks chat completions.
- `codex exec`: "Non-interactive mode lets you run Codex from scripts (for example, continuous integration
  (CI) jobs) without opening the interactive TUI. You invoke it with `codex exec`."
  (https://learn.chatgpt.com/docs/non-interactive-mode). Flags: `--json`, `--output-schema`
  ("request a final response that conforms to a JSON Schema"), `--ephemeral` (no session files),
  `--skip-git-repo-check`, `--sandbox read-only|workspace-write|danger-full-access`.
- Codex SDK: `npm install @openai/codex-sdk` (Node 18+, server side) and `pip install openai-codex`
  (Python 3.10+, bundles a pinned CLI runtime). (https://learn.chatgpt.com/docs/codex-sdk)
- The old `codex mcp-server` command has been removed; the SDK page points to the "Codex app server" for
  integrations. I did not read that page.

**Sign-in.** "Sign in with ChatGPT for subscription access" and "Sign in with an API key for usage-based
access"; device-code login is "beta" (`codex login --device-auth`, must be enabled in ChatGPT security
settings). Storage: "Codex caches login details locally in a plaintext file at `~/.codex/auth.json` or in
your OS-specific credential store" (summary). Docs say treat `auth.json` "like a password" (summary).
(https://learn.chatgpt.com/docs/auth)

**Cost.** Plans (pricing page, summary): Free $0, Go $8, Plus $20, Pro from $100, Business $20/user.
"ChatGPT Work and Codex share usage." Usage is limited per five-hour window and weekly (Plus: tens to
hundreds of messages by model). API-key use: "Pay for Codex usage based on API pricing." Models differ by
sign-in type: for example, one model was retired for ChatGPT sign-in on 2026-10-14 while "The OpenAI API and
Codex sessions authenticated with an API key aren't affected." (https://learn.chatgpt.com/docs/pricing)

**ToS.** The OpenAI Terms of Use page (https://openai.com/policies/terms-of-use/) returned HTTP 403 to the
fetcher, so **I did not read it**. The Codex docs I read do not say whether a ChatGPT subscription may power a
third-party app; they steer automation to keys: "Use API key authentication for programmatic Codex CLI
workflows, such as CI/CD jobs" and "Don't expose Codex execution in untrusted or public environments."
Secondary reading (hosting vendor blog, not OpenAI): no OpenAI document addresses third parties using
plan-authenticated Codex (https://proxyllm.ai/blog/is-codex-hosted-against-openai-terms). **Verdict: grey,
undocumented; API key is clean.** A human should read the Terms of Use "automated access / account sharing"
clauses before any subscription route is built.

**Chat-only.** `codex exec` defaults to a read-only sandbox (summary), but "read-only" still lets Codex "read
files and run commands within the read-only sandbox" (summary). There is no documented no-tools flag. For
Sage that means a Codex CLI brain could read the user's files on its own; the ask-first gate would not see
that. Also needs `--skip-git-repo-check` outside a repo.

**Windows / install.** Standalone installer for macOS/Linux (`curl -fsSL https://chatgpt.com/codex/install.sh | sh`);
the Windows, npm and Homebrew tab contents did not load for me, so the Windows install command is UNVERIFIED.
Windows sandbox modes `elevated`/`unelevated` exist; WSL1 no longer supported (summary).

### 3. GitHub Copilot

**What it is now.** Copilot plans (plans page): Free, Pro $10/month, Pro+ $39, Max $100, Business $19/seat,
Enterprise $39/seat; quotas are now "GitHub AI Credits" (Pro 1,500 total, Pro+ 7,000, Max 20,000; Free has a
smaller allowance and "Auto model selection only"). (https://docs.github.com/en/copilot/get-started/plans;
I read only the first part of the page.)

**Routes.**
- **Copilot SDK** (https://github.com/github/copilot-sdk): "The GitHub Copilot SDK is generally available and
  follows semantic versioning." Languages: TypeScript, Python, Go, .NET, Java, Rust, all talking JSON-RPC to
  the Copilot CLI server. Node and .NET bundle the CLI; "The SDKs do not look up `copilot` on your PATH."
  README notice: "GitHub Copilot SDK is becoming Microsoft Copilot SDK" and "No immediate changes are
  required for existing users": expect renames.
- **Copilot CLI programmatic mode**: `copilot -p "..." -s --no-ask-user --output-format json` (JSONL).
  (https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference)
- **GitHub Models API: retired.** "As of July 30, 2026, GitHub Models has been fully retired." Do not build on
  it. (https://docs.github.com/en/github-models/prototyping-with-ai-models)

**Sign-in** (https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate): "GitHub Signed-in
User" ("Users authenticate via GitHub OAuth device flow ... Credentials are stored securely in the system
keychain"), GitHub OAuth App (token `gho_`/`ghu_`), fine-grained PAT with the "Copilot Requests" permission
(classic `ghp_` PATs not supported), env var `COPILOT_GITHUB_TOKEN`, and BYOK (own key for Foundry/OpenAI etc.,
no Copilot subscription needed). README: "a GitHub Copilot subscription is required to use the GitHub Copilot
SDK, unless you are using BYOK". CLI credentials: "stored securely in the system credential store. If a
credential store is not found, the token is stored in a plain text configuration file under ~/.copilot/".

**ToS.** The SDK auth docs describe the OAuth App mode for "SaaS applications building on top of Copilot" and
"Any multi-user application where you need to make requests on behalf of different users", with the end
user's own subscription. That is the only one of the four vendors whose docs openly describe a third-party
app using the end user's own subscription. GitHub Terms of Service section H (API): "You may not share API
tokens to exceed GitHub's rate limitations." I found no clause that bans embedded or scripted Copilot use, but
I did not read the full Copilot-specific terms or the Generative AI Services terms, and the SDK was a
technical preview until recently. (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service,
https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features)
**Verdict: acceptable per the docs as read; ask the owner to accept the residual doubt.**

**Chat-only.** `--available-tools=TOOL ...`: "Restrict the model to only the tools you list; all other tools
are unavailable." Also `--excluded-tools`, `--deny-tool`, `--allow-tool`, `--no-ask-user`. Whether an empty
`--available-tools` gives a true no-tools chat, and whether the SDK lets Sage register its own tools and turn
off all built-ins, is UNVERIFIED. This must be tested with the real SDK before design is frozen.

**Windows / install.** CLI is `npm install -g @github/copilot` (seen on the programmatic page as the pin
command). A Windows statement and winget were NOT found. Needs Node for the SDK route; Electron already
ships Node, but the SDK's bundled CLI is a separate download to ship and update.

**Detect.** `copilot` on PATH or the SDK's bundled binary; sign-in via the SDK's auth status (details
UNVERIFIED).

### 4. Google Antigravity

**What it is now.** Antigravity is Google's agent-first IDE, desktop app and CLI (`agy`, v1.2+), with a
Python SDK (`pip install google-antigravity`, Python 3.10+). It replaces the Gemini CLI as the consumer
product; the Gemini CLI is still mentioned in Terms section 6 and the docs have a "Migrating from Gemini CLI"
page, but I found no official statement that it is retired. (https://antigravity.google/docs/getting-started,
https://antigravity.google/docs/cli/gcli-migration)

**Routes.**
- **Gemini API key (Google AI Studio)**: official route for anything third-party. FAQ: "To use a third-party
  coding agent with Gemini, we recommend using a Gemini Enterprise or Google AI Studio API key."
  (https://antigravity.google/docs/faq). Plain HTTPS with function calling. (Gemini also offers an
  OpenAI-compatible endpoint; UNVERIFIED this session; check before reusing the existing online brain.)
- **Antigravity SDK** with `GEMINI_API_KEY` or Vertex credentials. Python only.
- **`agy -p`**: "Runs a single prompt non-interactively and prints the response"; formats `text|json|stream-json`,
  `--json-schema`, `--sandbox`, `--dangerously-skip-permissions`. "Headless mode uses your cached credentials."
  (https://antigravity.google/docs/cli/headless)

**Sign-in** (getting-started table): `oauth-personal` (Free/Pro/Ultra Google accounts), `oauth-business`
(Gemini Enterprise), `gemini-api-key`, `agent-platform` (Vertex). Credentials: "Antigravity CLI uses secure
keychain libraries" (Windows Credential Manager, macOS Keychain, Linux secret-service); settings at
`~/.gemini/antigravity-cli/settings.json`. (https://antigravity.google/docs/cli/troubleshooting)

**Cost.** Gemini API: a free tier exists for several current Flash-class models ("Gemini 4 Carbon is not
available on the Free tier"), with content used to improve Google's products; paid tier has higher limits and
no training use (https://aistudio.google.com/docs/pricing). Per-model free-tier request limits were NOT in
the fetched text (live limits at https://aistudio.google.com/rate-limit). Rate limits are per project
(https://aistudio.google.com/docs/rate-limits). Free-tier function-calling status UNVERIFIED. Antigravity
subscription prices: not read (Plans page not fetched).

**ToS (official).**
- Terms section 6 (https://antigravity.google/terms): "This includes, but is not limited to, using the Service
  in connection with products not provided by us. Using third party software, tools, or services to access
  the Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement. Such actions may be
  grounds for suspension or termination of your Antigravity and/or Gemini CLI accounts."
- FAQ: "Using third-party software, tools, or services to access Antigravity is a violation of our Terms of
  Service." And: "Antigravity CLI headless mode (`agy -p`) is intended for direct scripting and CI workflows.
  Wrapping `agy` inside third-party coding agents or applications, or automating account rotation, is not
  supported under consumer plans."
- Forum answers (community forum, replies not labelled as staff in what I read, but consistent with the FAQ):
  a third-party desktop app wrapping `agy` with a user's Pro/Ultra login "violates the Antigravity Terms of
  Service" and "can get your users' Google accounts suspended"
  (https://discuss.ai.google.dev/t/can-a-third-party-desktop-app-run-the-official-antigravity-cli-with-the-user-s-own-google-ai-pro-ultra-subscription/190447,
  https://discuss.ai.google.dev/t/clarification-on-subscription-based-agy-p-integration-with-a-local-multi-agent-framework/196472).
**Verdict: wrapping `agy` with a consumer login is forbidden and risks the user's Google account. Use an API
key.**

**Chat-only.** No documented read-only flag for the CLI; only deny/ask/allow rules in `settings.json` and
`--mode`. Not relevant if we use the API key route, where Sage sends its own tools and the vendor runs none.

---

## jarvis-agent.tech: how it connects

Read: https://jarvis-agent.tech/ (home with FAQ), /terms, /privacy. No /docs, /faq or /pricing pages (404).
- "JARVIS drives the official ChatGPT or Claude app under your own login," and "Setup installs the official
  app if it is missing and starts the sign-in for you, so there is no key and no terminal."
- "JARVIS runs on your own computer and drives the official Claude Code or Codex app" (the page is
  inconsistent between "ChatGPT or Claude app" and "Claude Code or Codex app").
- "No server of mine is in the loop; JARVIS never reads a credential file or copies a token."
- "An API key stays as a small Advanced option if you prefer it." Cost: "that bill stays between you and
  OpenAI or Anthropic"; "Plus and Pro start at $20/month".
- Terms: "JARVIS thinks on AI subscriptions and API keys that you own and pay for directly." The site says
  nothing about the vendors' terms for this use. Setup telemetry includes "which AI provider you selected".
So their approach is the "drive the vendor's CLI/app under the buyer's own login" route. For Claude and
Google that is the route the vendors' own text restricts (see above); the site makes no ToS argument. I would
not treat it as evidence that the route is allowed.

---

## Recommended design for Sage

**Principle.** The vendor must be only a text-in/text-out (plus tool-call-out) model. Sage's own skills and its
ask-first gate stay the only thing that changes the computer. Prefer routes where the vendor runs no tools at
all (plain HTTPS APIs). CLI routes are only acceptable where the CLI can be switched into a no-tools mode and
where the terms allow it.

**Provider list in Settings and on the Welcome screen** (one radio list, same wording in both places):
1. **On this computer** (default, unchanged).
2. **Claude** (Anthropic key): "Use your own Anthropic API key. You pay Anthropic per use."
3. **ChatGPT / OpenAI** (OpenAI key): same, uses the existing online brain with the OpenAI preset address.
4. **Gemini** (Google AI Studio key): free tier available for some models; same.
5. **GitHub Copilot** (sign in with GitHub): "Use your Copilot subscription." Shown as "Beta".
6. **Another online service** (existing OpenAI-compatible address + key).
Do **not** list Antigravity-subscription, Claude-subscription or ChatGPT-subscription logins as separate
choices. On the Welcome screen each choice gets a short "what it costs, where your key is kept, what leaves
your computer" line, and a "Get a key" link opened only after Sage's own asking box.

**Build order.**
1. Provider presets for the existing online brain (OpenAI address and model list), plus provider name stored
   with the key; zero new code paths for ToS risk. Check whether Gemini's OpenAI-compatible endpoint is
   usable (UNVERIFIED) so it too is a preset.
2. Native Anthropic brain over HTTPS (Messages API, own `fetch`, no SDK), key bound to `https://api.anthropic.com`
   by the existing origin binding. This is the one Claude route that is plainly allowed.
3. Native Gemini brain if the compatible endpoint is not good enough.
4. Copilot brain via the SDK, after a spike that proves: (a) no built-in tools can run, (b) Sage's tools can be
   passed in and come back as tool calls without the SDK executing them, (c) sign-in works with Electron on
   Windows with no terminal, (d) install size. If the spike fails, drop it rather than run an agent.
5. Subscription-driven CLIs for Claude/Codex/Gemini: **not built** unless the owner decides after reading the
   vendors' terms (Codex Terms of Use remain unread).

**Keeping ask-first.** Brain interface stays `chat(messages, tools)`. For API brains, map tool calls to the
vendor's native tool format and never auto-execute anything. For any CLI/SDK brain: pass `--tools ""`-style
flags, give the process an empty temp working directory, no environment secrets, a short timeout, kill on
New chat, redact output, and treat the process's output as untrusted text exactly like web text. Never use
the `--dangerously-*`, `danger-full-access`, `--allow-all` flags. Add a test that fails if the argument
list lacks the no-tools flags. Because Sage's tool list is dynamic, the CLI routes would need a "reply with JSON in this
schema" protocol (`--output-schema` / `--json-schema` exist for Codex and `agy`); that is more fragile than
native tool calling, which is another reason to build the API routes first.

**Key and credential storage.** Keep one key per provider, each bound to its origin as today (the current
store holds a single key; extend to one file/record per provider, not one shared slot). Same Linux rule:
refuse to store without a real keyring. Sage must never read or copy `~/.claude/.credentials.json`,
`~/.codex/auth.json`, `~/.copilot/` or the GitHub token; for CLI/SDK routes the vendor tool keeps its own
sign-in, and Sage only asks the tool whether it is signed in. For Copilot, prefer the SDK's device flow (its
credentials go to the system keychain) over asking users to paste a PAT.

**Detection.** API providers: "key saved" plus a cheap test call after the user presses Test. CLI/SDK
providers: binary found (`--version`) and signed-in check through the vendor's own status command, never by
reading credential files. Show a plain "Not installed / Not signed in / Ready" line with one fixed install
link, opened after asking.

**Errors.** Reuse the current set (bad key, address, busy/quota, took too long) and add: "signed out",
"quota used up" (distinct from busy), "model retired" (model names change often: 2026 already retired several;
keep the model name editable and show a model list from the provider when possible), and "this provider
needs the vendor's tool installed". Never show or log an error body.

---

## Risks and open questions for the owner

1. **Do you want subscription routes at all?** For Claude and Google the vendors' text points against it for a
   third-party app; for OpenAI I could not read the Terms. A user's account could be suspended (Google says so
   explicitly). Recommended answer: API keys for Claude/OpenAI/Gemini; subscription only for Copilot.
2. **Copilot spike.** Is a no-tools, Sage-tools-only mode possible in the SDK? Unverified; a day of spike work.
3. **OpenAI Terms of Use** returned 403 to the fetcher; someone with a browser should read the clauses on
   automated access and account sharing before any ChatGPT-login route is considered.
4. **Costs to the user.** API routes are pay-per-token with no hard cap Sage can enforce. Consider a per-chat
   "tokens used" line and a note on the Welcome screen.
5. **Privacy line in the README** ("Nothing you type leaves your computer") stays true only for the local
   brain; online brains send the chat and tool results to the vendor. Free-tier Gemini content may be used to
   improve Google's products. Wording and a first-use asking box are needed per provider.
6. **Names and models change quickly** (Copilot SDK renamed, GitHub Models retired, Codex models retired,
   Gemini CLI vs Antigravity). Keep providers behind a small interface and no hard-coded model lists.
7. **jarvis-agent.tech** takes the CLI-under-your-login route; if the owner sees it as a competitor model,
   note it is also the route most exposed to vendor policy changes.
8. **Public repo hygiene:** nothing here names the private stack; docs written from this report must use the
   repo's own wording rules.
9. Unverified items: Copilot Windows/winget install, Codex Windows install command, OpenAI-compatible Gemini
   endpoint, `claude auth status`, Antigravity plan prices, free-tier request limits and function calling.

---

## Sources

Anthropic
- https://code.claude.com/docs/en/legal-and-compliance
- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/authentication
- https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546

OpenAI / Codex
- https://learn.chatgpt.com/docs/auth (was developers.openai.com/codex/auth)
- https://learn.chatgpt.com/docs/non-interactive-mode
- https://learn.chatgpt.com/docs/codex-sdk
- https://learn.chatgpt.com/docs/agent-approvals-security
- https://learn.chatgpt.com/docs/pricing
- https://learn.chatgpt.com/docs/cli
- https://openai.com/policies/terms-of-use/ (HTTP 403, not read)
- https://proxyllm.ai/blog/is-codex-hosted-against-openai-terms (secondary)

GitHub
- https://github.com/github/copilot-sdk
- https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference (partly read)
- https://docs.github.com/en/github-models/prototyping-with-ai-models
- https://docs.github.com/en/copilot/get-started/plans
- https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features
- https://github.blog/changelog/2026-01-14-copilot-sdk-in-technical-preview/

Google
- https://antigravity.google/terms
- https://antigravity.google/docs/faq
- https://antigravity.google/docs/getting-started
- https://antigravity.google/docs/cli/headless
- https://antigravity.google/docs/cli/gcli-migration
- https://antigravity.google/docs/cli/troubleshooting
- https://antigravity.google/docs/permissions
- https://aistudio.google.com/docs/pricing
- https://aistudio.google.com/docs/rate-limits
- https://discuss.ai.google.dev/t/can-a-third-party-desktop-app-run-the-official-antigravity-cli-with-the-user-s-own-google-ai-pro-ultra-subscription/190447
- https://discuss.ai.google.dev/t/clarification-on-subscription-based-agy-p-integration-with-a-local-multi-agent-framework/196472

Other
- https://jarvis-agent.tech/, /terms, /privacy
- Repo files read: README.md, docs/architecture.md, src/core/brain/{brain,online,local}.ts, src/core/keystore.ts
