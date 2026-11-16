import assert from "node:assert/strict";
import { test } from "node:test";
import { createSounds, TONES, type ToneContext } from "../src/renderer/sounds.js";
import { deferred, settled } from "./helpers.js";
import { startWindow } from "./window.js";

// The window's sound effects (src/renderer/sounds.ts): made with oscillators, off by default, and no
// audio at all until a sound is wanted while sound is on.

function fakeContext(state = "running") {
  const started: { wave: string; from: number }[] = [];
  let resumed = 0;
  const param = () => {
    const values: number[] = [];
    return {
      values,
      setValueAtTime: (value: number) => values.push(value),
      linearRampToValueAtTime: (value: number) => values.push(value),
      exponentialRampToValueAtTime: (value: number) => values.push(value),
    };
  };
  const context: ToneContext = {
    currentTime: 3,
    destination: {},
    state,
    resume: async () => {
      resumed++;
    },
    createOscillator() {
      const oscillator = {
        type: "",
        frequency: param(),
        connect() {},
        start() {
          started.push({ wave: oscillator.type, from: oscillator.frequency.values[0]! });
        },
        stop() {},
      };
      return oscillator;
    },
    createGain: () => ({ gain: param(), connect() {} }),
  };
  return { context, started, resumed: () => resumed };
}

test("the sounds are short, quiet notes: a blip, two rising notes, and a low tone", () => {
  for (const tones of Object.values(TONES)) {
    for (const tone of tones) {
      assert.ok(tone.length <= 0.4 && tone.peak <= 0.1, JSON.stringify(tone));
    }
  }
  assert.equal(TONES.send.length, 1);
  assert.equal(TONES.allowed.length, 2);
  assert.ok(TONES.allowed[1]!.from > TONES.allowed[0]!.from, "the confirm notes rise");
  assert.ok(TONES.asking[0]!.from < 250, "the asking tone is low");
});

test("off: nothing plays and no audio context is made; on: one context, made when first needed", () => {
  const fake = fakeContext();
  let made = 0;
  const sounds = createSounds(() => {
    made++;
    return fake.context;
  });
  assert.equal(sounds.on, false, "off by default");
  sounds.play("send");
  assert.equal(made, 0);
  sounds.setOn(true);
  assert.equal(made, 0, "switching on makes nothing yet");
  sounds.play("send");
  sounds.play("allowed");
  sounds.play("asking");
  assert.equal(made, 1);
  assert.deepEqual(
    fake.started.map((tone) => tone.from),
    [740, 523.25, 783.99, 196],
  );
  assert.deepEqual(
    fake.started.map((tone) => tone.wave),
    ["sine", "triangle", "triangle", "sine"],
  );
  sounds.setOn(false);
  sounds.play("send");
  assert.equal(fake.started.length, 4);
});

test("no audio, broken audio or a sleeping context: no error, and it wakes the context", () => {
  const none = createSounds(() => undefined);
  none.setOn(true);
  none.play("send");
  const broken = createSounds(() => {
    throw new Error("no audio device");
  });
  broken.setOn(true);
  broken.play("asking");
  const sleeping = fakeContext("suspended");
  const sounds = createSounds(() => sleeping.context);
  sounds.setOn(true);
  sounds.play("send");
  assert.equal(sleeping.resumed(), 1);
  assert.equal(sleeping.started.length, 1);
});

test("in the window, sound is off by default: sending makes no audio at all", async (t) => {
  const { el, media } = await startWindow(t, async () => "ok");
  assert.equal(el("sound-toggle").getAttribute("aria-pressed"), "false");
  el("input").value = "hello";
  el("composer").dispatch("submit");
  await settled();
  assert.deepEqual(media.audioContexts, []);
  assert.deepEqual(media.tones, []);
});

test("the Sound switch saves itself, plays a blip, and the sounds follow sending and asking", async (t) => {
  const { el, media, calls, emitAsking } = await startWindow(t, async () => "ok");
  el("sound-toggle").click();
  await settled();
  assert.deepEqual(calls.sound, [true]);
  assert.equal(el("sound-toggle").getAttribute("aria-pressed"), "true");
  assert.deepEqual(media.tones, [740], "a blip to say it is on");
  assert.equal(calls.saved.length, 0, "the Settings form isn't saved");

  el("input").value = "hello";
  el("composer").dispatch("submit");
  await settled();
  assert.deepEqual(media.tones, [740, 740]);

  emitAsking({ id: "ask-1", state: "open", text: "Open it?" });
  assert.deepEqual(media.tones.slice(2), [196], "a low tone when the card appears");
  emitAsking({ id: "ask-1", state: "closed", allowed: true });
  assert.deepEqual(media.tones.slice(3), [523.25, 783.99], "two notes when allowed");
  emitAsking({ id: "ask-2", state: "open", text: "Delete it?" });
  emitAsking({ id: "ask-2", state: "closed", allowed: false });
  assert.deepEqual(media.tones.slice(5), [196], "nothing when not allowed");
  assert.equal(media.audioContexts.length, 1, "one audio context, reused");

  el("sound-toggle").click();
  await settled();
  assert.deepEqual(calls.sound, [true, false]);
  emitAsking({ id: "ask-3", state: "open", text: "Open it?" });
  assert.equal(media.tones.length, 6, "quiet again");
});

test("sound saved as on is shown on, and a switch that can't be saved goes back", async (t) => {
  let fail = false;
  const { el, media } = await startWindow(
    t,
    async () => "ok",
    {
      setSound: async () => {
        if (fail) throw new Error("no answer");
        return { ok: false, message: "not saved" };
      },
    },
    { settings: { sound: true } },
  );
  assert.equal(el("sound-toggle").getAttribute("aria-pressed"), "true");
  assert.deepEqual(media.audioContexts, [], "nothing made until a sound is wanted");
  el("sound-toggle").click();
  assert.equal(el("sound-toggle").getAttribute("aria-pressed"), "false");
  await settled();
  assert.equal(el("sound-toggle").getAttribute("aria-pressed"), "true", "refused, so back on");
  fail = true;
  el("sound-toggle").click();
  await settled();
  assert.equal(el("sound-toggle").getAttribute("aria-pressed"), "true", "failed, so back on");
});

test("with sound on but no audio in the window, nothing breaks", async (t) => {
  const { el, texts } = await startWindow(
    t,
    async () => "ok",
    {},
    {
      settings: { sound: true },
      before: () => {
        delete (globalThis as { AudioContext?: unknown }).AudioContext;
      },
    },
  );
  el("input").value = "hello";
  el("composer").dispatch("submit");
  await settled();
  assert.deepEqual(texts(), ["hello", "ok"]);
});

test("a settings read that started before the Sound switch was used doesn't undo it", async (t) => {
  // The first read answers at once (sound on); the reload after Save settings is held.
  const reads: ReturnType<typeof deferred<void>>[] = [];
  const { el, media } = await startWindow(t, async () => "ok", {
    getSettings: async () => {
      const held = deferred<void>();
      reads.push(held);
      if (reads.length > 1) await held.promise;
      return {
        brain: "local",
        local: { model: "small-model" },
        online: { baseUrl: "", model: "", hasKey: false },
        apps: [],
        folders: [],
        speakReplies: "voice",
        setupDone: true,
        theme: "dark",
        sound: true,
      };
    },
  });
  assert.equal(el("sound-toggle").getAttribute("aria-pressed"), "true");
  el("settings-form").dispatch("submit");
  await settled();
  assert.equal(reads.length, 2, "the reload after saving is on its way");

  el("sound-toggle").click();
  assert.equal(el("sound-toggle").getAttribute("aria-pressed"), "false", "muted");
  reads[1]!.resolve();
  await settled();
  assert.equal(el("sound-toggle").getAttribute("aria-pressed"), "false", "still muted");
  el("input").value = "hello";
  el("composer").dispatch("submit");
  await settled();
  assert.deepEqual(media.tones, [], "and quiet");

  // A read that starts after the switch was used shows what was saved.
  el("settings-form").dispatch("submit");
  await settled();
  reads[2]!.resolve();
  await settled();
  assert.equal(el("sound-toggle").getAttribute("aria-pressed"), "true", "the saved value, read afresh");
});
