# Plan: brains-api

## What the owner asked for

Sage should be able to use the big online model services (Anthropic's, OpenAI's, GitHub's and Google's),
not just local open-source models. After the research, the owner chose: **API keys for Claude, OpenAI and
Gemini, and the subscription only for GitHub Copilot** ("Yes that is ok"). This job is the API-key part;
Copilot is the next job.

## What we found

The full research is in [docs/reports/2026-11-16-online-brains.md](../reports/2026-11-16-online-brains.md).

- **Claude:** Anthropic's terms don't allow other apps to sign in with a Claude Pro/Max subscription or
  route requests through it. An Anthropic API key (pay per use) is the supported way.
- **OpenAI:** an OpenAI API key is the supported way. Sage's online brain already speaks OpenAI's
  format; it just needs OpenAI as a ready-made choice.
- **Google:** Google's terms forbid other apps from driving its own agent tools with a consumer sign-in.
  Its models (Gemini) are available with a Google AI Studio key, which has a free tier for some models.
- **Copilot:** GitHub's official kit for apps uses the user's Copilot subscription. It runs an agent, so a
  short trial must first prove it can be limited to answering; that is the next job.
- Today Sage has two brains: "On this computer" (the local model runner) and one "online service" with an
  address, a model and one saved key. Sage's own skills and its ask-first rule are the only things that
  change the computer, and that stays true for every new brain: the services only send back text and
  requests to use Sage's skills.

## What we'll change

1. **A list of brains.** Settings and the Welcome screen offer: **On this computer** (default),
   **Claude** (Anthropic key), **OpenAI** (OpenAI key), **Gemini** (Google AI Studio key) and **Another
   online service** (today's address-and-key option). Each has a one-line note on what it costs, that the
   key is kept in Windows' protected storage, and that what you type is sent to that company. Existing
   settings move over unchanged: today's online service becomes "Another online service" with the same
   address, model and key.

   *Check:* settings tests, including loading a settings file from 0.1.1.
2. **One key per company, locked to that company.** Each key is saved separately and can only ever be sent
   to that company's fixed address (`api.anthropic.com`, `api.openai.com`, Google's
   `generativelanguage.googleapis.com`), like today's binding of a key to one address. On Linux, keys are
   still refused without a real keyring.

   *Check:* key store tests: a key can't be sent anywhere else, switching brains doesn't mix keys, removing
   one keeps the others.
3. **Claude brain.** A new brain that talks to Anthropic's Messages API directly (no extra libraries),
   including tool use, mapped to Sage's skills, with the same time limits, error messages and secret
   scrubbing as the online brain.

   *Check:* tests with recorded replies: plain answers, a skill request, a refused key, quota used up, a
   retired model, a time-out.
4. **OpenAI and Gemini.** Ready-made choices for the existing online brain: OpenAI's address, and Google's
   OpenAI-compatible Gemini address, if it handles Sage's skill requests correctly (the team checks this
   against Google's documentation; if it doesn't, a small Gemini brain is added the same way as Claude's).

   *Check:* tests with recorded replies for both.
5. **Models.** A model box with a sensible default for each company and a **Load models** button that
   asks the company for its current list, because model names change often.
6. **Getting a key.** A **Get a key** link for each company opens its key page in the browser, only after
   Sage's own asking box, and only to a fixed address. **Test** checks the key with one small request.
7. **Clear errors** for a wrong key, quota or credit used up, a model that no longer exists, and the
   service being busy or slow. Error details from the service are never shown or saved.
8. **Privacy wording.** The README's "nothing you type leaves your computer" is true only for "On this
   computer"; it will say what each online brain sends where. The first time you pick an online brain,
   Sage says the same in one line.
9. **Notes.** Roadmap, changelog, `docs/architecture.md`, `docs/assurance-case.md` (where key handling is
   described) and the Windows checklist (choose each brain, test a key, ask a question, use a skill).

## Who's on it

CEO, Engineer, QA, Security Officer, Auditor and a Plain-English Reader. No Researcher: the research is
done. This handles keys and network access, so it counts as security-sensitive; the second security
reviewer is unavailable this month, so the Security Officer and Auditor both review the key handling.

## Order

This job is built after "Sage's new look, part 1" (#24) is merged, because both change the Settings and
Welcome screens.

## Risks

- **Cost.** API keys are paid per use, separately from any subscriptions. Sage can't cap spending, so the
  notes and the Welcome screen say so, and point to each company's own spending limits.
- **Privacy.** With an online brain, your messages and the results of Sage's skills (for example a list of
  files it found) go to that company. The asking box and the one-line notice make this clear.
- **Changing services.** Companies rename and retire models and addresses. Sage keeps the model name
  editable and loads the current list instead of relying on a fixed one.

## Out of scope

- GitHub Copilot (the next job, starting with a short trial).
- Signing in with Anthropic, OpenAI or Google consumer subscriptions (not allowed by those companies, or
  unclear).
- Spending limits inside Sage.
