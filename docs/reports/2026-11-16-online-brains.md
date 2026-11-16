# Research: more online brains for Sage

Research report, 2026-11-16. The owner asked for Sage to use the big online model services as well as
local models, including through the subscriptions people already pay for. This report keeps only what
matters for Sage's design. The companies' terms change, so check them again before relying on this.

## What Sage had

One brain interface: Sage sends the conversation and its skills, and gets back text or requests to use
skills. Two brains: the local model runner on this computer, and one "online service" with an address, a
model and one key, bound to that address and kept in the system's protected storage. Sage's own skills and
its ask-first rule are the only things that change the computer.

## Findings

| Service | Route | Verdict |
|---|---|---|
| Claude (Anthropic) | Messages API with the user's own API key | **Build.** The supported way for any app. Native tool use, plain HTTPS. |
| Claude | Signing in with a consumer subscription | **Not allowed.** Anthropic's terms say other developers may not offer subscription sign-in in their apps or route requests through users' subscription plans. |
| OpenAI | API with the user's own API key | **Build.** The supported way. Sage's existing online brain already speaks its chat format. |
| OpenAI | Signing in with a consumer subscription | **Not built.** No OpenAI text was found that allows another app to use a consumer subscription; its documentation steers automation to API keys. |
| Gemini (Google) | Gemini API with a Google AI Studio key | **Build.** Google's recommended route for other apps. A free tier exists for some models (free-tier content may be used to improve Google's products). |
| Google | Driving Google's own agent tools with a consumer sign-in | **Not allowed.** Google's terms and FAQ say using other software to access it with a consumer account breaks the terms and can get the account suspended. |
| GitHub Copilot | Copilot SDK with the user's own GitHub sign-in | **Later job, after a trial.** GitHub's documentation describes apps that act for each user with that user's own subscription. The SDK runs an agent with its own tools, so a trial must first prove it can be limited to answering, with only Sage's skills. |
| GitHub Copilot | GitHub Models API | **Not available.** Retired on 2026-07-30. |

## Design for Sage

- **The service only answers.** It sends back text and requests to use Sage's skills; it runs nothing on
  the computer. Routes where the company's own tool would act on the computer are not used.
- **A brain list** in Settings and on the Welcome screen: On this computer (default), Claude, OpenAI,
  Gemini, and Another online service. No subscription sign-in choices for Claude, OpenAI or Google.
- **One key per company**, each bound to that company's fixed address and kept in the system's protected
  storage; on Linux, refused without a real keyring. Sage never reads other programs' sign-in files.
- **Model names change often**, so the model stays editable and Sage asks the company for its current list.
- **Errors** in plain words: a wrong key, credit or quota used up, a retired model, a busy or slow service.
  The service's own error text is never shown or saved.
- **Privacy:** "nothing you type leaves your computer" stays true only for the local brain; each online
  brain sends the conversation and the results of Sage's skills to that company.
- **Cost:** API keys are paid per use, separately from any subscription, and Sage can't cap spending; the
  companies' own spending limits are the way to do that.

## Sources

- Anthropic: the Claude developer docs' legal and compliance page ("Authentication and credential use"),
  and the API reference.
- OpenAI: the developer docs on authentication and automation (the Terms of Use page could not be read).
- Google: the terms (section 6) and FAQ of its agent tools, and the Google AI Studio docs on pricing and rate
  limits.
- GitHub: the Copilot SDK repository and its authentication docs, and the GitHub Models retirement notice.
- Sage: README.md, docs/architecture.md, src/core/brain/*.ts, src/core/keystore.ts.
