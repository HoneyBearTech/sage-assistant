import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { privacyLine } from "../src/shared/api.js";
import type { FakeElement } from "./fake-dom.js";
import { deferred, settled } from "./helpers.js";
import { startWindow } from "./window.js";

// The brain list in Settings, run in the real window script on the fake DOM.

const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

function pick(el: (id: string) => FakeElement, brain: string): void {
  for (const radio of el("settings-form").radios) radio.checked = radio.value === brain;
  el("settings-form")
    .radios.find((radio) => radio.value === brain)!
    .dispatch("change");
}

test("the list offers five brains, each with a note on cost, the key's storage and what is sent", () => {
  const radios = [
    ...html.matchAll(/<input type="radio" name="brain" value="(\w+)" aria-describedby="([\w-]+)"/g),
  ];
  assert.deepEqual(
    radios.map((match) => match[1]),
    ["local", "claude", "openai", "gemini", "other"],
  );
  for (const [, value, note] of radios) {
    assert.equal(note, `brain-note-${value}`);
    const text = html.slice(html.indexOf(`id="${note}"`), html.indexOf("</p>", html.indexOf(`id="${note}"`)));
    if (value === "local") {
      assert.match(text, /nothing you type leaves this PC/);
      continue;
    }
    assert.match(text, value === "other" ? /its own prices/ : /per use/, `${value}: what it costs`);
    assert.match(text, /protected\s+storage/, `${value}: where the key is kept`);
    assert.match(
      text,
      /What you type and the\s+results of Sage's skills go to|What you type and the results of Sage's skills\s+go to/,
      value,
    );
  }
  assert.match(html, /id="brain-note-gemini" class="choice-note">\s*Free tier for some models/);
  assert.match(html, /Sage can't cap what you spend/);
  // The Welcome screen's online step names the choices, says what it costs, and leads to Settings.
  const place = html.slice(html.indexOf('id="step-place"'), html.indexOf('id="step-runner"'));
  assert.match(place, /An online service \(Claude, OpenAI, Gemini or another\)/);
  assert.match(place, /charges per use/);
  assert.match(place, /Sage can't cap what you spend, so set a limit on the company's own\s+website/);
  assert.match(place, /in Settings\./);
  // Every new control has a label or text of its own.
  for (const id of ["service-model", "model-list", "online-key"])
    assert.match(html, new RegExp(`for="${id}"`));
});

test("each brain shows its own fields; the model box keeps each company's model apart", async (t) => {
  const { el } = await startWindow(t, async () => "");
  el("tab-settings").click();
  assert.equal(el("brain-local").hidden, false);
  assert.equal(el("brain-key").hidden, true, "no key on this computer");
  assert.equal(el("brain-service").hidden, true);

  pick(el, "claude");
  assert.equal(el("brain-local").hidden, true);
  assert.equal(el("brain-service").hidden, false);
  assert.equal(el("brain-key").hidden, false);
  assert.equal(el("brain-other").hidden, true);
  assert.equal(el("service-model-label").textContent, "Claude model");
  assert.equal(el("online-key-label").textContent, "Claude key");
  assert.equal(el("service-model").value, "claude-model");
  assert.equal(el("key-status").textContent, "No key saved.");
  assert.equal(el("test-key").hidden, false);
  assert.equal(el("get-key-row").hidden, false);
  el("service-model").value = "typed-for-claude";

  pick(el, "gemini");
  assert.equal(el("service-model").value, "gemini-model");
  assert.equal(el("service-model-label").textContent, "Gemini model");
  pick(el, "other");
  assert.equal(el("brain-other").hidden, false);
  assert.equal(el("brain-service").hidden, true);
  assert.equal(el("test-key").hidden, true, "Test and Get a key are for the ready-made services");
  assert.equal(el("get-key-row").hidden, true);
  assert.equal(el("online-key-label").textContent, "Online service key");
  pick(el, "claude");
  assert.equal(el("service-model").value, "typed-for-claude", "nothing typed is lost by switching");
});

test("picking an online brain says in one line what goes where; Save sends each model", async (t) => {
  const { el, calls } = await startWindow(t, async () => "");
  el("tab-settings").click();
  pick(el, "openai");
  assert.equal(el("brain-notice").textContent, privacyLine("openai"));
  pick(el, "local");
  assert.equal(el("brain-notice").textContent, "");
  pick(el, "gemini");
  assert.equal(el("brain-notice").textContent, privacyLine("gemini"));
  el("service-model").value = "  gemini-3.6-flash ";
  el("settings-form").dispatch("submit");
  await settled();
  const saved = calls.saved.at(-1) as Record<string, unknown>;
  assert.equal(saved.brain, "gemini");
  assert.deepEqual(saved.services, {
    claude: { model: "claude-model" },
    openai: { model: "openai-model" },
    gemini: { model: "gemini-3.6-flash" },
  });
  assert.equal("keys" in saved, false, "the window never sends anything about keys with the settings");
});

test("the line isn't shown for the brain already saved", async (t) => {
  const { el } = await startWindow(t, async () => "", {}, { settings: { brain: "claude" } });
  el("tab-settings").click();
  assert.equal(el("brain-notice").textContent, "");
  pick(el, "claude");
  assert.equal(el("brain-notice").textContent, "");
  assert.equal(el("brain-status").textContent, "Brain: Claude (claude-model)");
});

test("Save key, Remove key and Test name the brain picked; only the key's status comes back", async (t) => {
  const { el, calls } = await startWindow(t, async () => "");
  el("tab-settings").click();
  pick(el, "claude");
  el("online-key").value = "fake-claude-key-for-tests";
  el("save-key").click();
  await settled();
  assert.deepEqual(calls.keys, [["claude", "fake-claude-key-for-tests"]]);
  assert.equal(el("online-key").value, "");
  assert.match(el("key-status").textContent, /A key is saved/);
  pick(el, "openai");
  assert.equal(el("key-status").textContent, "No key saved.", "each company's key is its own");
  pick(el, "claude");
  el("test-key").click();
  assert.match(el("key-result").textContent, /Checking the key with Claude/);
  await settled();
  assert.deepEqual(calls.testKey, ["claude"]);
  assert.equal(el("key-result").textContent, "The key works.");
  el("clear-key").click();
  await settled();
  assert.deepEqual(calls.cleared, ["claude"]);
  assert.equal(el("key-status").textContent, "No key saved.");
  // On this computer there is no key to save or remove.
  pick(el, "local");
  el("online-key").value = "fake-claude-key-for-tests";
  el("save-key").click();
  el("clear-key").click();
  await settled();
  assert.equal(calls.keys.length, 1);
  assert.equal(calls.cleared.length, 1);
});

test("Load models fills a list to pick from; the model box stays editable", async (t) => {
  const { el, calls } = await startWindow(t, async () => "");
  el("tab-settings").click();
  pick(el, "openai");
  assert.equal(el("model-list").hidden, true);
  el("load-models").click();
  assert.equal(el("load-models").disabled, true);
  await settled();
  assert.deepEqual(calls.listModels, ["openai"]);
  assert.equal(el("load-models").disabled, false);
  assert.equal(el("model-list").hidden, false);
  assert.equal(el("model-list-label").hidden, false);
  assert.deepEqual(
    el("model-list").children.map((option) => option.textContent),
    ["Pick a model…", "openai-a", "openai-b"],
  );
  assert.match(el("models-status").textContent, /^2 models\. Pick one, or type a name/);
  el("model-list").value = "openai-b";
  el("model-list").dispatch("change");
  assert.equal(el("service-model").value, "openai-b");
  el("service-model").value = "my-own-model";
  // Another company: the list was OpenAI's, so it goes.
  pick(el, "claude");
  assert.equal(el("model-list").hidden, true);
  assert.deepEqual(el("model-list").children, []);
  pick(el, "openai");
  assert.equal(el("service-model").value, "my-own-model");
});

test("a model list or a test result that arrives after another company was picked is dropped", async (t) => {
  const slow = deferred<{ ok: true; models: string[] }>();
  const { el } = await startWindow(t, async () => "", { listModels: () => slow.promise });
  el("tab-settings").click();
  pick(el, "claude");
  el("load-models").click();
  pick(el, "gemini");
  slow.resolve({ ok: true, models: ["claude-late"] });
  await settled();
  assert.equal(el("model-list").hidden, true);
  assert.equal(el("service-model").value, "gemini-model");
  assert.equal(el("models-status").textContent, "");
});

test("a failed model list or test shows Sage's plain message", async (t) => {
  const { el } = await startWindow(t, async () => "", {
    listModels: async () => ({ ok: false, message: "Save a Gemini key first." }),
    testKey: async () => {
      throw new Error("gone");
    },
  });
  el("tab-settings").click();
  pick(el, "gemini");
  el("load-models").click();
  await settled();
  assert.equal(el("models-status").textContent, "Save a Gemini key first.");
  assert.equal(el("model-list").hidden, true);
  el("test-key").click();
  await settled();
  assert.equal(el("key-result").textContent, "Sage couldn't check the key. Try again.");
});

test("Get a key asks the main process with the company's id only, and says what happened", async (t) => {
  let answer: "opened" | "declined" | "failed" = "declined";
  const sent: unknown[][] = [];
  const { el } = await startWindow(t, async () => "", {
    openKeyPage: async (...args: unknown[]) => {
      sent.push(args);
      return answer === "failed"
        ? {
            status: "failed",
            message: "Sage couldn't open your web browser. The page is at the address.",
            address: "x",
          }
        : { status: answer };
    },
  });
  el("tab-settings").click();
  pick(el, "gemini");
  el("get-key").click();
  assert.match(el("key-result").textContent, /asking whether to open the key page/);
  await settled();
  assert.deepEqual(sent, [["gemini"]]);
  assert.equal(el("key-result").textContent, "The key page wasn't opened.");
  answer = "opened";
  el("get-key").click();
  await settled();
  assert.match(el("key-result").textContent, /^The key page opened in your web browser/);
  answer = "failed";
  el("get-key").click();
  await settled();
  assert.match(el("key-result").textContent, /^Sage couldn't open your web browser/);
});
