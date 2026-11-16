import assert from "node:assert/strict";
import { test } from "node:test";
import { PULL_POLL_MS, WELCOME_TEXT } from "../src/renderer/welcome-text.js";
import type { Notice, PullResult, PullStatus, RunnerStatus, SageApi } from "../src/shared/api.js";
import { focusedElement, pressKey } from "./fake-dom.js";
import { deferred, settled } from "./helpers.js";
import { startWindow } from "./window.js";

// The Welcome screen (src/renderer/welcome.ts, wired up in renderer.ts), run against the fake DOM
// with a fake window.sage. New windows here start "not set up yet".

const STEPS = ["step-place", "step-runner", "step-model", "step-done"] as const;

function runner(
  state: RunnerStatus["state"],
  downloaded = { standard: false, smaller: false },
): RunnerStatus {
  return { state, model: "qwen3:4b", downloaded };
}

async function welcomeWindow(
  t: Parameters<typeof startWindow>[0],
  overrides: Partial<SageApi> = {},
  setupDone = false,
) {
  const win = await startWindow(t, async () => "The reply.", overrides, { settings: { setupDone } });
  const visibleStep = () => STEPS.filter((id) => !win.el(id).hidden);
  const click = async (id: string) => {
    win.el(id).click();
    await settled();
    await settled();
  };
  return { ...win, visibleStep, click };
}

test("a first start opens the Welcome screen, with Chat hidden and no tabs", async (t) => {
  const { el, visibleStep } = await welcomeWindow(t);
  assert.equal(el("view-welcome").hidden, false);
  assert.equal(el("view-chat").hidden, true);
  assert.equal(el("view-settings").hidden, true);
  assert.equal(el("tabs").hidden, true);
  assert.deepEqual(visibleStep(), ["step-place"]);
  assert.equal(focusedElement(), el("step-place-heading"), "the focus starts at the step's heading");
  assert.equal(el("welcome-skip").hidden, false);
});

test("once set up, Sage opens on Chat; if the settings can't be read, it opens on Chat too", async (t) => {
  const done = await welcomeWindow(t, {}, true);
  assert.equal(done.el("view-chat").hidden, false);
  assert.equal(done.el("view-welcome").hidden, true);
  assert.equal(done.el("tabs").hidden, false);
});

test("if the settings can't be read, Sage opens on Chat", async (t) => {
  const broken = await welcomeWindow(t, {
    getSettings: async () => {
      throw new Error("no answer");
    },
  });
  assert.equal(broken.el("view-chat").hidden, false);
  assert.equal(broken.el("view-welcome").hidden, true);
});

test("Skip setup saves that setup is done and opens Chat, at any step", async (t) => {
  const { el, click, calls } = await welcomeWindow(t);
  await click("place-local");
  await click("welcome-skip");
  assert.equal(calls.finishSetup, 1);
  assert.equal(el("view-chat").hidden, false);
  assert.equal(el("view-welcome").hidden, true);
  assert.equal(el("tabs").hidden, false);
  assert.equal(el("tab-chat").classList.contains("active"), true);
  assert.deepEqual(calls.pulls, [], "nothing downloaded");
});

test("if setup can't be saved as done, the Welcome screen stays and says so; trying again works", async (t) => {
  const answers: (Error | { ok: false; message: string } | { ok: true })[] = [
    new Error("no answer"),
    { ok: false, message: "Sage couldn't save that setup is done. Try again." },
    { ok: true },
  ];
  const { el, click, calls } = await welcomeWindow(t, {
    finishSetup: async () => {
      calls.finishSetup++;
      const next = answers.shift()!;
      if (next instanceof Error) throw next;
      return next;
    },
  });
  await click("welcome-skip");
  assert.equal(el("view-welcome").hidden, false, "still on the Welcome screen");
  assert.equal(el("view-chat").hidden, true);
  assert.equal(el("welcome-status").textContent, WELCOME_TEXT.notSaved);
  await click("place-online");
  assert.equal(el("view-welcome").hidden, false);
  assert.equal(el("view-settings").hidden, true);
  assert.equal(el("welcome-status").textContent, "Sage couldn't save that setup is done. Try again.");
  await click("welcome-skip");
  assert.equal(el("view-chat").hidden, false);
  assert.equal(el("welcome-status").textContent, "", "the message goes once it worked");
  assert.equal(calls.finishSetup, 3);
});

test("An online service saves that setup is done and opens Settings with the online choice picked", async (t) => {
  const { el, click, calls } = await welcomeWindow(t);
  await click("place-online");
  assert.equal(calls.finishSetup, 1);
  assert.equal(el("view-settings").hidden, false);
  assert.equal(el("view-welcome").hidden, true);
  const radios = el("settings-form").radios;
  assert.deepEqual(
    radios.filter((radio) => radio.checked).map((radio) => radio.value),
    ["online"],
  );
  assert.match(el("settings-status").textContent, /Save settings, then paste the key/);
  assert.equal(calls.saved.length, 0, "nothing saved until the user chooses Save settings");
});

test("the runner step: each answer in plain words, Check again, and the install steps", async (t) => {
  let answer: RunnerStatus | Error = runner("unreachable");
  let asked = 0;
  const { el, click, visibleStep } = await welcomeWindow(t, {
    runnerStatus: async () => {
      asked++;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  await click("place-local");
  assert.deepEqual(visibleStep(), ["step-runner"]);
  assert.equal(focusedElement(), el("step-runner-heading"));
  assert.equal(el("runner-status").textContent, WELCOME_TEXT.unreachable);
  assert.equal(el("runner-install").hidden, false, "install steps and the guide button");
  assert.equal(el("runner-next").disabled, true);

  answer = runner("unreadable");
  await click("runner-check");
  assert.equal(el("runner-status").textContent, WELCOME_TEXT.unreadable);
  assert.equal(el("runner-install").hidden, true);
  assert.equal(el("runner-next").disabled, true);

  answer = new Error("no answer");
  await click("runner-check");
  assert.equal(el("runner-status").textContent, WELCOME_TEXT.checkFailed);

  answer = runner("no-model");
  await click("runner-check");
  assert.equal(el("runner-status").textContent, WELCOME_TEXT.running);
  assert.equal(el("runner-next").disabled, false);
  assert.equal(asked, 4);

  answer = runner("ready", { standard: true, smaller: false });
  await click("runner-check");
  assert.equal(el("runner-next").disabled, false);
  await click("runner-next");
  assert.deepEqual(visibleStep(), ["step-model"]);
  assert.equal(focusedElement(), el("step-model-heading"));
  assert.equal(el("model-standard-mark").textContent, WELCOME_TEXT.downloaded);
  assert.equal(el("model-smaller-mark").textContent, "");
  assert.equal(el("model-download").textContent, WELCOME_TEXT.useModel);
});

test("Open the install guide: the main process asks; opened, declined, or the address to copy", async (t) => {
  let answer: Awaited<ReturnType<SageApi["openInstallGuide"]>> = { status: "opened" };
  const { el, click, calls } = await welcomeWindow(t, {
    runnerStatus: async () => runner("unreachable"),
    openInstallGuide: async () => {
      calls.openGuide++;
      return answer;
    },
  });
  await click("place-local");
  await click("open-guide");
  assert.equal(calls.openGuide, 1);
  assert.equal(el("guide-status").textContent, WELCOME_TEXT.guideOpened);
  assert.equal(el("guide-address").hidden, true);

  answer = { status: "declined" };
  await click("open-guide");
  assert.equal(el("guide-status").textContent, WELCOME_TEXT.guideDeclined);

  const address =
    "https://github.com/HoneyBearTech/sage-assistant/blob/main/docs/installing.md#local-model-runner";
  answer = {
    status: "failed",
    message: `Sage couldn't open your web browser. The install guide is at ${address}`,
    address,
  };
  await click("open-guide");
  assert.match(el("guide-status").textContent, /couldn't open your web browser/);
  assert.equal(el("guide-address").hidden, false);
  assert.equal(el("guide-address").textContent, address, "shown as text to copy");
  assert.equal(el("open-guide").disabled, false);
});

test("an install guide request that fails outright says so", async (t) => {
  const { el, click } = await welcomeWindow(t, {
    runnerStatus: async () => runner("unreachable"),
    openInstallGuide: async () => {
      throw new Error("no answer");
    },
  });
  await click("place-local");
  await click("open-guide");
  assert.equal(el("guide-status").textContent, WELCOME_TEXT.guideFailed);
  assert.equal(el("guide-address").hidden, true);
});

async function atModelStep(t: Parameters<typeof startWindow>[0], overrides: Partial<SageApi> = {}) {
  const win = await welcomeWindow(t, { runnerStatus: async () => runner("no-model"), ...overrides });
  await win.click("place-local");
  await win.click("runner-next");
  assert.deepEqual(win.visibleStep(), ["step-model"]);
  return win;
}

test("a download: the main process asks, progress every half second, then the model is ready", async (t) => {
  const result = deferred<PullResult>();
  let progress: PullStatus = { downloading: false, completed: 0, total: 0 };
  const { el, click, calls, visibleStep } = await atModelStep(t, {
    pullModel: async (choice) => {
      calls.pulls.push(choice);
      return result.promise;
    },
    pullStatus: async () => progress,
  });
  assert.equal(el("model-download").textContent, WELCOME_TEXT.download);
  await click("model-download");
  assert.deepEqual(calls.pulls, ["standard"], "the window names a choice, never a model");
  assert.equal(el("model-status").textContent, WELCOME_TEXT.asking);
  assert.equal(el("model-download").disabled, true);
  assert.equal(el("model-cancel").hidden, true, "no Cancel while the box is open");

  progress = { downloading: true, completed: 1_200_000_000, total: 2_500_000_000 };
  t.mock.timers.tick(PULL_POLL_MS);
  await settled();
  assert.equal(PULL_POLL_MS, 500);
  assert.equal(el("model-status").textContent, "Downloading… 1,200 of 2,500 MB");
  assert.equal(el("model-cancel").hidden, false);
  assert.equal(el("model-progress").hidden, false);
  assert.equal((el("model-progress") as unknown as { value: number }).value, 1_200_000_000);
  assert.equal((el("model-progress") as unknown as { max: number }).max, 2_500_000_000);

  progress = { downloading: true, completed: 0, total: 0 };
  t.mock.timers.tick(PULL_POLL_MS);
  await settled();
  assert.equal(el("model-status").textContent, "Downloading…");

  result.resolve({ status: "done", skills: "yes" });
  await settled();
  assert.equal(el("model-status").textContent, "The Standard model is ready.");
  assert.equal(el("model-skills").textContent, "");
  assert.equal(el("model-cancel").hidden, true);
  assert.equal(el("model-progress").hidden, true);
  assert.equal(el("model-download").disabled, false);
  assert.equal(el("model-standard-mark").textContent, WELCOME_TEXT.downloaded);
  assert.equal(el("model-next").hidden, false);

  await click("model-next");
  assert.deepEqual(visibleStep(), ["step-done"]);
  assert.equal(focusedElement(), el("step-done-heading"));
  assert.equal(
    el("done-summary").textContent,
    "Sage will think on this computer, with the Standard model (qwen3:4b).",
  );
  assert.match(
    el("done-voice").textContent,
    /hold Ctrl\+Space\. Sage asks before downloading the speech file/,
  );
  await click("start-chatting");
  assert.equal(calls.finishSetup, 1);
  assert.equal(el("view-chat").hidden, false);
});

test("the Smaller model, and a model the runner says can't use skills", async (t) => {
  const { el, click, calls } = await atModelStep(t, {
    pullModel: async (choice) => {
      calls.pulls.push(choice);
      return { status: "done", skills: "no" };
    },
  });
  el("model-standard").checked = false;
  el("model-smaller").checked = true;
  el("model-smaller").dispatch("change");
  await click("model-download");
  assert.deepEqual(calls.pulls, ["smaller"]);
  assert.equal(el("model-status").textContent, "The Smaller model is ready.");
  assert.equal(el("model-skills").textContent, WELCOME_TEXT.noSkills);
  await click("model-next");
  assert.equal(
    el("done-summary").textContent,
    "Sage will think on this computer, with the Smaller model (qwen3:1.7b).",
  );
});

test("declined, cancelled and failed downloads say so, and Try again works", async (t) => {
  const results: PullResult[] = [
    { status: "declined" },
    { status: "cancelled" },
    {
      status: "failed",
      message: "There isn't enough free disk space for the model. Free up some space, then try again.",
    },
    { status: "done", skills: "unknown" },
  ];
  const { el, click, calls } = await atModelStep(t, {
    pullModel: async (choice) => {
      calls.pulls.push(choice);
      return results.shift()!;
    },
  });
  await click("model-download");
  assert.equal(el("model-status").textContent, WELCOME_TEXT.declined);
  assert.equal(el("model-download").textContent, WELCOME_TEXT.download);
  assert.equal(el("model-next").hidden, true);

  await click("model-download");
  assert.equal(el("model-status").textContent, WELCOME_TEXT.cancelled);
  assert.equal(el("model-download").textContent, WELCOME_TEXT.tryAgain);

  await click("model-download");
  assert.match(el("model-status").textContent, /enough free disk space/);
  assert.equal(el("model-download").textContent, WELCOME_TEXT.tryAgain);
  assert.equal(el("model-next").hidden, true);

  await click("model-download");
  assert.equal(el("model-status").textContent, "The Standard model is ready.");
  assert.equal(el("model-next").hidden, false);
  assert.equal(calls.pulls.length, 4);
});

test("a request that fails outright gives the plain message", async (t) => {
  const { el, click } = await atModelStep(t, {
    pullModel: async () => {
      throw new Error("no answer");
    },
  });
  await click("model-download");
  assert.equal(el("model-status").textContent, WELCOME_TEXT.failed);
  assert.equal(el("model-download").textContent, WELCOME_TEXT.tryAgain);
  // Choosing the other model starts afresh.
  el("model-smaller").checked = true;
  el("model-smaller").dispatch("change");
  assert.equal(el("model-download").textContent, WELCOME_TEXT.download);
});

test("Cancel asks the main process to stop; Skip during a download stops it too", async (t) => {
  const result = deferred<PullResult>();
  const { el, click, calls } = await atModelStep(t, {
    pullModel: async () => result.promise,
    pullStatus: async () => ({ downloading: true, completed: 1, total: 10 }),
  });
  await click("model-download");
  t.mock.timers.tick(PULL_POLL_MS);
  await settled();
  // A second click while downloading does nothing.
  await click("model-download");
  await click("model-cancel");
  assert.equal(calls.cancelPull, 1);
  await click("welcome-skip");
  assert.equal(calls.cancelPull, 2);
  assert.equal(el("view-chat").hidden, false);
  // The cancelled download's answer arrives after the screen was left: nothing is written.
  result.resolve({ status: "cancelled" });
  await settled();
  assert.equal(el("model-status").textContent, "Downloading… 0 of 0 MB");
});

test("Set up Sage in Settings opens the Welcome screen again, from the start", async (t) => {
  const { el, click, visibleStep } = await welcomeWindow(
    t,
    { runnerStatus: async () => runner("unreachable") },
    true,
  );
  el("tab-settings").click();
  await click("setup-again");
  assert.equal(el("view-welcome").hidden, false);
  assert.equal(el("view-settings").hidden, true);
  assert.equal(el("tabs").hidden, true);
  assert.deepEqual(visibleStep(), ["step-place"]);
  await click("place-local");
  await click("open-guide");
  await click("welcome-skip");
  // Opened again: nothing left over from last time.
  await click("tab-settings");
  await click("setup-again");
  assert.deepEqual(visibleStep(), ["step-place"]);
  assert.equal(el("guide-status").textContent, "");
  assert.equal(el("runner-status").textContent, "");
});

test("after a download, Settings shows the new local model without losing other unsaved changes", async (t) => {
  let model = "small-model";
  const { el, click } = await welcomeWindow(t, {
    runnerStatus: async () => runner("no-model"),
    getSettings: async () => ({
      brain: "local",
      local: { model },
      online: { baseUrl: "", model: "", hasKey: false },
      apps: [],
      folders: [],
      speakReplies: "voice",
      setupDone: model !== "small-model",
      theme: "dark",
      sound: false,
    }),
    pullModel: async () => {
      model = "qwen3:1.7b";
      return { status: "done", skills: "yes" };
    },
  });
  el("online-url").value = "https://typed.example";
  await click("place-local");
  await click("runner-next");
  await click("model-download");
  await click("model-next");
  await click("start-chatting");
  assert.equal(el("local-model").value, "qwen3:1.7b");
  assert.equal(el("brain-status").textContent, "Brain: on this computer (qwen3:1.7b)");
  assert.equal(el("online-url").value, "https://typed.example", "other unsaved changes stay");
});

test("notices wait while the Welcome screen is open, and are confirmed when Chat opens", async (t) => {
  const waiting: Notice[] = [{ id: "n1", text: "Sage reminder: Stretch" }];
  const acks: string[][] = [];
  const { el, texts, click } = await welcomeWindow(t, {
    takeNotices: async () => structuredClone(waiting),
    ackNotices: async (ids) => {
      acks.push(ids);
    },
  });
  t.mock.timers.tick(5_000);
  await settled();
  assert.deepEqual(texts(), ["Sage reminder: Stretch"], "added to the chat, behind the Welcome screen");
  assert.deepEqual(acks, [], "not confirmed while Welcome is open");
  await click("welcome-skip");
  assert.equal(el("view-chat").hidden, false);
  assert.deepEqual(acks, [["n1"]], "confirmed once Chat is open");
});

test("Ctrl+Space does nothing on the Welcome screen or Settings, only on Chat", async (t) => {
  const { el, media, click } = await welcomeWindow(t);
  const ctrlSpace = { ctrlKey: true, code: "Space", key: " " };
  const down = pressKey("keydown", ctrlSpace);
  await settled();
  assert.equal(down.prevented, false, "left alone");
  assert.equal(media.streams.length, 0, "no microphone");
  assert.equal(el("voice-status").textContent, "");
  pressKey("keyup", { key: "Control", code: "ControlLeft" });

  await click("welcome-skip");
  el("tab-settings").click();
  pressKey("keydown", ctrlSpace);
  await settled();
  assert.equal(media.streams.length, 0, "not behind Settings either");
  pressKey("keyup", { key: "Control", code: "ControlLeft" });

  el("tab-chat").click();
  assert.equal(pressKey("keydown", ctrlSpace).prevented, true);
  await settled();
  assert.equal(media.streams.length, 1, "Chat: it records");
  pressKey("keyup", { key: "Control", code: "ControlLeft" });
  await settled();
});

test("after Standard is ready, choosing Smaller needs Smaller to be ready before Next", async (t) => {
  const { el, click, calls, visibleStep } = await atModelStep(t, {
    runnerStatus: async () => runner("no-model", { standard: true, smaller: false }),
    pullModel: async (choice) => {
      calls.pulls.push(choice);
      return { status: "done", skills: "yes" };
    },
  });
  await click("model-download");
  assert.equal(el("model-next").hidden, false);
  const choose = (id: "model-standard" | "model-smaller") => {
    el("model-standard").checked = id === "model-standard";
    el("model-smaller").checked = id === "model-smaller";
    el(id).dispatch("change");
  };
  choose("model-smaller");
  assert.equal(el("model-next").hidden, true, "Standard's readiness doesn't count for Smaller");
  assert.equal(el("model-status").textContent, "");
  assert.equal(el("model-download").textContent, WELCOME_TEXT.download);
  // Back to Standard: it is downloaded, but it has to be chosen again.
  choose("model-standard");
  assert.equal(el("model-next").hidden, true);
  assert.equal(el("model-download").textContent, WELCOME_TEXT.useModel);
  await click("model-download");
  assert.equal(el("model-next").hidden, false);
  await click("model-next");
  assert.deepEqual(visibleStep(), ["step-done"]);
  assert.match(el("done-summary").textContent, /Standard model \(qwen3:4b\)/);
  assert.deepEqual(calls.pulls, ["standard", "standard"]);
});

test("Skip changes nothing in the Settings form, including unsaved edits", async (t) => {
  const { el, click } = await welcomeWindow(t, {}, true);
  el("tab-settings").click();
  el("local-model").value = "typed-but-not-saved";
  const radios = el("settings-form").radios;
  for (const radio of radios) radio.checked = radio.value === "online";
  await click("setup-again");
  await click("welcome-skip");
  el("tab-settings").click();
  assert.equal(el("local-model").value, "typed-but-not-saved");
  assert.deepEqual(
    radios.filter((radio) => radio.checked).map((radio) => radio.value),
    ["online"],
  );
  assert.equal(el("brain-status").textContent, "Brain: on this computer (small-model)");
});

test("a late answer after setup doesn't overwrite edits made since", async (t) => {
  let model = "small-model";
  let brain: "local" | "online" = "online";
  let hold: ReturnType<typeof deferred<void>> | undefined;
  const { el, click } = await welcomeWindow(t, {
    runnerStatus: async () => runner("no-model"),
    getSettings: async () => {
      const answer = {
        brain,
        local: { model },
        online: { baseUrl: "https://api.example.com", model: "m", hasKey: false },
        apps: [],
        folders: [],
        speakReplies: "voice" as const,
        setupDone: model !== "small-model",
        theme: "dark" as const,
        sound: false,
      };
      await hold?.promise;
      return answer;
    },
    pullModel: async () => {
      model = "qwen3:1.7b";
      brain = "local";
      return { status: "done", skills: "yes" };
    },
  });
  await click("place-local");
  await click("runner-next");
  await click("model-download");
  await click("model-next");
  hold = deferred<void>();
  await click("start-chatting");
  // While the answer is on its way, the user edits the local model in Settings.
  el("tab-settings").click();
  const radios = el("settings-form").radios;
  assert.deepEqual(
    radios.filter((radio) => radio.checked).map((radio) => radio.value),
    ["online"],
  );
  el("local-model").value = "edited-since";
  hold.resolve();
  await settled();
  assert.equal(el("local-model").value, "edited-since", "the newer edit stays");
  assert.deepEqual(
    radios.filter((radio) => radio.checked).map((radio) => radio.value),
    ["local"],
    "the brain the download switched to, in a field not edited since",
  );
  assert.equal(
    el("brain-status").textContent,
    "Brain: on this computer (qwen3:1.7b)",
    "the saved state is shown",
  );
});

test("Cancel after the download finished is too late: the window keeps the model as chosen", async (t) => {
  const result = deferred<PullResult>();
  const { el, click, calls } = await atModelStep(t, {
    pullModel: async () => result.promise,
    pullStatus: async () => ({ downloading: true, completed: 10, total: 10 }),
    cancelPull: async () => {
      calls.cancelPull++;
      return "too-late";
    },
  });
  await click("model-download");
  t.mock.timers.tick(PULL_POLL_MS);
  await settled();
  await click("model-cancel");
  assert.equal(calls.cancelPull, 1);
  assert.equal(el("model-status").textContent, WELCOME_TEXT.tooLate);
  result.resolve({ status: "done", skills: "yes" });
  await settled();
  assert.equal(el("model-status").textContent, "The Standard model is ready.");
  assert.equal(el("model-next").hidden, false);
});

test("a late setup refresh never overwrites a Settings save that finished first", async (t) => {
  // What the main process has stored; the fake's getSettings answers with it as it was when asked.
  const stored = {
    brain: "online" as "local" | "online",
    local: { model: "small-model" },
    online: { baseUrl: "https://api.example.com", model: "m", hasKey: false },
    apps: [],
    folders: [],
    speakReplies: "voice" as const,
    setupDone: false,
    theme: "dark" as const,
    sound: false,
  };
  let holdNext: ReturnType<typeof deferred<void>> | undefined;
  const { el, click, calls } = await welcomeWindow(t, {
    runnerStatus: async () => runner("no-model"),
    getSettings: async () => {
      const answer = structuredClone(stored);
      const hold = holdNext;
      holdNext = undefined;
      await hold?.promise;
      return answer;
    },
    saveSettings: async (input) => {
      calls.saved.push(structuredClone(input));
      Object.assign(stored, { brain: input.brain, local: { ...input.local } });
      return { ok: true };
    },
    pullModel: async () => {
      Object.assign(stored, { brain: "local", local: { model: "qwen3:1.7b" } });
      return { status: "done", skills: "yes" };
    },
    finishSetup: async () => {
      stored.setupDone = true;
      return { ok: true };
    },
  });
  await click("place-local");
  await click("runner-next");
  await click("model-download");
  await click("model-next");
  // Setup's refresh asks for the settings, and its answer is slow.
  const slow = deferred<void>();
  holdNext = slow;
  await click("start-chatting");
  // Meanwhile the user saves Settings: online again, with a model of their own. The save and its
  // reload finish first.
  el("tab-settings").click();
  for (const radio of el("settings-form").radios) radio.checked = radio.value === "online";
  el("local-model").value = "users-own-model";
  el("settings-form").dispatch("submit");
  await settled();
  await settled();
  assert.equal(el("brain-status").textContent, "Brain: online (m)");
  // The old answer (local, qwen3:1.7b) arrives last: it is dropped.
  slow.resolve();
  await settled();
  assert.equal(el("brain-status").textContent, "Brain: online (m)");
  assert.equal(el("local-model").value, "users-own-model");
  assert.deepEqual(
    el("settings-form")
      .radios.filter((radio) => radio.checked)
      .map((radio) => radio.value),
    ["online"],
  );
  // The next save sends what the user stored, not the stale answer.
  el("settings-form").dispatch("submit");
  await settled();
  assert.equal((calls.saved.at(-1) as { brain: string }).brain, "online");
});
