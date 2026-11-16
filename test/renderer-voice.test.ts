import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  appendTranscript,
  formatSeconds,
  micErrorMessage,
  shouldSpeak,
  VOICE_TEXT,
} from "../src/renderer/voice-text.js";
import { MAX_MESSAGE_CHARS, MAX_VOICE_SAMPLES, type TranscribeResult } from "../src/shared/api.js";
import { blurWindow, pressKey, setWindowVisibility } from "./fake-dom.js";
import { FakeStream, micError, voice } from "./fake-media.js";
import { deferred, settled } from "./helpers.js";
import { startWindow, type WindowOptions } from "./window.js";

// The window's voice code (src/renderer/renderer.ts and voice.ts), run against the fake DOM and
// stand-ins for the microphone, the recorder, audio decoding and the built-in speech.

const ctrlSpace = { ctrlKey: true, code: "Space", key: " " };

async function voiceWindow(
  t: Parameters<typeof startWindow>[0],
  options: {
    transcribe?: (pcm: Int16Array) => Promise<TranscribeResult>;
    send?: (text: string) => Promise<string>;
    overrides?: Parameters<typeof startWindow>[2];
    settings?: WindowOptions["settings"];
    before?: WindowOptions["before"];
  } = {},
) {
  const sent: Int16Array[] = [];
  const win = await startWindow(
    t,
    options.send ?? (async () => "The reply."),
    {
      transcribe: async (pcm) => {
        sent.push(pcm);
        return options.transcribe ? options.transcribe(pcm) : { ok: true, text: "hello Sage" };
      },
      ...options.overrides,
    },
    {
      ...(options.settings ? { settings: options.settings } : {}),
      ...(options.before ? { before: options.before } : {}),
    },
  );
  const status = () => win.el("voice-status").textContent;
  /** Holds Ctrl+Space for `ms`, then lets go of `release`. */
  const hold = async (ms: number, release: "Control" | " " = "Control") => {
    pressKey("keydown", ctrlSpace);
    await settled();
    t.mock.timers.tick(ms);
    pressKey(
      "keyup",
      release === "Control" ? { key: "Control", code: "ControlLeft" } : { key: " ", code: "Space" },
    );
    await settled();
    await settled();
  };
  return { ...win, sent, status, hold };
}

test("holding Ctrl+Space records, shows a timer, and puts the words in the message box without sending", async (t) => {
  const { el, media, sent, status, calls, texts } = await voiceWindow(t);
  const down = pressKey("keydown", ctrlSpace);
  assert.equal(down.prevented, true, "Ctrl+Space is taken by Sage, not typed or passed on");
  await settled();
  assert.deepEqual(media.constraints, [{ audio: true }], "only the microphone, nothing else");
  assert.equal(media.streams[0]!.open, true);
  assert.equal(status(), "Listening… 0:00");
  assert.equal(el("talk").classList.contains("active"), true);
  t.mock.timers.tick(3_000);
  assert.equal(status(), "Listening… 0:03");

  // Held keys repeat: the repeats don't start anything new.
  pressKey("keydown", { ...ctrlSpace, repeat: true });
  await settled();
  assert.equal(media.streams.length, 1);

  const up = pressKey("keyup", { key: "Control", code: "ControlLeft" });
  assert.equal(up.prevented, true);
  assert.equal(media.streams[0]!.open, false, "the microphone closes the moment the key is let go");
  assert.equal(status(), "Working out what you said…");
  await settled();
  await settled();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.length, 2 * 16_000, "two seconds of 16 kHz sound, one channel");
  assert.equal(sent[0]![0], Math.round(0.5 * 32_767));
  assert.equal(el("input").value, "hello Sage");
  assert.equal(status(), "");
  assert.deepEqual(calls.send, [], "never sent by itself");
  assert.deepEqual(texts(), []);
  assert.equal(el("talk").classList.contains("active"), false);
});

test("letting go of Space also stops it, and the words go after what is already typed", async (t) => {
  const { el, media, hold } = await voiceWindow(t);
  el("input").value = "Remind me";
  await hold(1_500, " ");
  assert.equal(media.streams[0]!.open, false);
  assert.equal(el("input").value, "Remind me hello Sage");
  // Other keys let go while not talking change nothing.
  pressKey("keyup", { key: "a", code: "KeyA" });
  pressKey("keydown", { key: " ", code: "Space" });
  pressKey("keydown", { ...ctrlSpace, shiftKey: true });
  await settled();
  assert.equal(media.streams.length, 1);
});

test("a quick tap is ignored: the microphone closes and nothing is sent", async (t) => {
  const { sent, status, media, hold } = await voiceWindow(t);
  await hold(100);
  assert.deepEqual(sent, []);
  assert.equal(media.streams[0]!.open, false);
  assert.equal(status(), VOICE_TEXT.tap);
});

test("letting go while the microphone is still opening closes it as soon as it opens", async (t) => {
  const opening = deferred<FakeStream>();
  const { sent, status, media } = await voiceWindow(t, {
    before: (m) => {
      m.nextMic = () => opening.promise;
    },
  });
  pressKey("keydown", ctrlSpace);
  await settled();
  t.mock.timers.tick(2_000);
  pressKey("keyup", { key: "Control" });
  await settled();
  assert.equal(status(), VOICE_TEXT.tap);
  const stream = new FakeStream();
  opening.resolve(stream);
  await settled();
  assert.equal(stream.open, false, "closed at once");
  assert.equal(media.streams.length, 1);
  assert.deepEqual(sent, []);
});

test("recording stops by itself after 30 seconds and is worked out", async (t) => {
  const { sent, media, status } = await voiceWindow(t, {
    before: (m) => {
      m.recordingSeconds = 31;
    },
  });
  pressKey("keydown", ctrlSpace);
  await settled();
  t.mock.timers.tick(29_000);
  assert.equal(media.streams[0]!.open, true);
  t.mock.timers.tick(1_000);
  assert.equal(media.streams[0]!.open, false, "closed at 30 seconds while the key is still held");
  await settled();
  await settled();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.length, MAX_VOICE_SAMPLES, "never more than 30 seconds of sound");
  pressKey("keyup", { key: "Control" });
  await settled();
  assert.equal(sent.length, 1, "letting go afterwards does nothing more");
  assert.equal(status(), "");
});

test("losing focus, hiding the window or New chat closes the microphone and drops the recording", async (t) => {
  const { sent, media, status, el } = await voiceWindow(t);
  for (const [i, stop] of [
    () => blurWindow(),
    () => setWindowVisibility("hidden"),
    () => el("new-chat").click(),
  ].entries()) {
    setWindowVisibility("visible");
    pressKey("keydown", ctrlSpace);
    await settled();
    t.mock.timers.tick(2_000);
    stop();
    assert.equal(media.streams[i]!.open, false, `closed (${i})`);
    pressKey("keyup", { key: "Control" });
    await settled();
    await settled();
  }
  assert.deepEqual(sent, [], "nothing recorded is worked out");
  assert.equal(status(), "");
  // Showing the window again doesn't start anything.
  setWindowVisibility("visible");
  blurWindow();
  assert.equal(media.streams.length, 3);
});

test("New chat while a recording is being worked out drops its words and clears the status", async (t) => {
  const answer = deferred<TranscribeResult>();
  const { el, hold, status } = await voiceWindow(t, { transcribe: () => answer.promise });
  await hold(2_000);
  assert.equal(status(), "Working out what you said…");
  el("new-chat").click();
  assert.equal(status(), "", "the status doesn't stay on screen");
  answer.resolve({ ok: true, text: "old words" });
  await settled();
  assert.equal(el("input").value, "");
  assert.equal(status(), "");
});

test("pressing the talk key while the last recording is worked out says so", async (t) => {
  const answer = deferred<TranscribeResult>();
  const { el, hold, status, media } = await voiceWindow(t, { transcribe: () => answer.promise });
  await hold(2_000);
  pressKey("keydown", ctrlSpace);
  await settled();
  assert.equal(status(), VOICE_TEXT.stillWorking);
  assert.equal(media.streams.length, 1, "no second recording");
  pressKey("keyup", { key: "Control" });
  answer.resolve({ ok: true, text: "done" });
  await settled();
  assert.equal(el("input").value, "done");
});

test("words that would push the message box past its limit aren't added, and the draft is kept", async (t) => {
  const { el, hold, status } = await voiceWindow(t);
  const draft = "x".repeat(MAX_MESSAGE_CHARS - 5);
  el("input").value = draft;
  await hold(1_000);
  assert.equal(el("input").value, draft, "the draft is untouched");
  assert.equal(status(), VOICE_TEXT.tooLong);
  // Words that just fit are added.
  el("input").value = "x".repeat(MAX_MESSAGE_CHARS - "hello Sage".length - 1);
  await hold(1_000);
  assert.equal(el("input").value.length, MAX_MESSAGE_CHARS);
  assert.equal(status(), "");
});

test("New chat clears the mark that the words came from talking", async (t) => {
  const { el, media, hold, calls } = await voiceWindow(t);
  await hold(1_000);
  el("new-chat").click();
  await settled();
  el("input").dispatch("keydown", { key: "Enter" });
  await settled();
  assert.deepEqual(calls.send, ["hello Sage"]);
  assert.equal(media.speech.spoken.length, 0, "not counted as a voice message after New chat");
});

test("the message box's limit is the one the main process accepts", async () => {
  const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  assert.match(html, new RegExp(`<textarea id="input"[^>]*maxlength="${MAX_MESSAGE_CHARS}"`));
});

test("one recording at a time: talking again while the last one is worked out does nothing", async (t) => {
  const answer = deferred<TranscribeResult>();
  const answers = [answer.promise, Promise.resolve<TranscribeResult>({ ok: true, text: "second" })];
  const { media, hold, el } = await voiceWindow(t, { transcribe: () => answers.shift()! });
  await hold(2_000);
  await hold(2_000);
  assert.equal(media.streams.length, 1);
  answer.resolve({ ok: true, text: "first" });
  await settled();
  await hold(2_000);
  assert.equal(media.streams.length, 2, "works again once the first one is done");
  assert.equal(el("input").value, "first second");
});

test("the Talk button works by press and hold, and from the keyboard", async (t) => {
  const { el, media, sent } = await voiceWindow(t);
  const talk = el("talk");
  talk.dispatch("pointerdown", { button: 2, pointerId: 1 });
  await settled();
  assert.equal(media.streams.length, 0, "only the main button");
  talk.dispatch("pointerdown", { button: 0, pointerId: 7 });
  await settled();
  assert.deepEqual(talk.captured, [7], "keeps the pointer while held");
  assert.equal(talk.classList.contains("active"), true);
  t.mock.timers.tick(1_000);
  pressKey("keyup", { key: "Control" });
  assert.equal(media.streams[0]!.open, true, "the talk key's release doesn't stop a button recording");
  talk.dispatch("pointerup");
  assert.equal(media.streams[0]!.open, false);
  await settled();
  await settled();
  assert.equal(sent.length, 1);

  // Space on the focused button: hold, repeats ignored, let go.
  talk.dispatch("keydown", { key: " " });
  await settled();
  talk.dispatch("keydown", { key: " ", repeat: true });
  t.mock.timers.tick(1_000);
  talk.dispatch("pointerup");
  assert.equal(media.streams[1]!.open, true, "a pointer release doesn't stop a keyboard recording");
  // Key events bubble from the button to the page, where letting go is watched.
  pressKey("keyup", { key: "a" });
  pressKey("keyup", { key: "Enter" });
  pressKey("keyup", { key: "Control" });
  assert.equal(media.streams[1]!.open, true, "only the key that started it");
  assert.equal(pressKey("keyup", { key: " " }).prevented, true);
  assert.equal(media.streams[1]!.open, false);
  await settled();
  await settled();
  assert.equal(sent.length, 2);
  assert.equal(media.streams.length, 2);
  talk.dispatch("keydown", { key: "a" });
  talk.dispatch("pointercancel");
  await settled();
  assert.equal(media.streams.length, 2);
  assert.equal(el("input").value, "hello Sage hello Sage");
});

test("held from the keyboard on the Talk button, letting go stops it wherever the focus has moved", async (t) => {
  const { el, media, sent } = await voiceWindow(t);
  const talk = el("talk");
  // Hold Enter on the button, press Tab (the focus moves on, but the key events still reach the
  // page), let go of Enter somewhere else.
  talk.dispatch("keydown", { key: "Enter" });
  await settled();
  t.mock.timers.tick(1_000);
  pressKey("keyup", { key: "Enter" });
  assert.equal(media.streams[0]!.open, false);
  await settled();
  await settled();
  assert.equal(sent.length, 1, "what was said is worked out");
});

test("held from the keyboard on the Talk button, the button losing focus stops it", async (t) => {
  const { el, media, sent, status } = await voiceWindow(t);
  const talk = el("talk");
  talk.dispatch("keydown", { key: " " });
  await settled();
  t.mock.timers.tick(1_000);
  // A reply arrives and focuses the message box, or Tab moves on.
  talk.dispatch("blur");
  assert.equal(media.streams[0]!.open, false, "not left running to the 30-second cap");
  await settled();
  await settled();
  assert.equal(sent.length, 1);
  assert.equal(el("input").value, "hello Sage");
  pressKey("keyup", { key: " " });
  await settled();
  assert.equal(sent.length, 1, "the later key release does nothing more");
  assert.equal(status(), "");
  // A button recording made with the mouse isn't stopped by a blur: the pointer is held.
  talk.dispatch("pointerdown", { button: 0, pointerId: 1 });
  await settled();
  talk.dispatch("blur");
  assert.equal(media.streams[1]!.open, true);
  talk.dispatch("pointerup");
  assert.equal(media.streams[1]!.open, false);
});

test("microphone errors give plain messages, and nothing is left open", async (t) => {
  for (const [name, expected] of [
    ["NotAllowedError", /blocked\. On Windows, open Settings > Privacy & security > Microphone/],
    ["NotFoundError", /can't find a microphone/],
    ["NotReadableError", /busy or isn't working/],
    ["TypeError", /couldn't start the microphone/],
  ] as const) {
    await t.test(name, async (t) => {
      const { status, el, sent } = await voiceWindow(t, {
        before: (m) => {
          m.nextMic = micError(name);
        },
      });
      pressKey("keydown", ctrlSpace);
      await settled();
      assert.match(status(), expected);
      assert.equal(el("talk").classList.contains("active"), false);
      pressKey("keyup", { key: "Control" });
      await settled();
      assert.deepEqual(sent, []);
    });
  }
  assert.match(micErrorMessage(new DOMException("x", "SecurityError")), /blocked/);
  assert.match(micErrorMessage("not an error"), /couldn't start the microphone/);
});

test("nothing heard, a refused recording and an unreadable one give plain messages", async (t) => {
  const answers: TranscribeResult[] = [
    { ok: true, text: "   " },
    { ok: false, message: "Sage is still working out the last recording. Try again in a moment." },
  ];
  const { status, hold, el, media } = await voiceWindow(t, { transcribe: async () => answers.shift()! });
  await hold(1_000);
  assert.equal(status(), VOICE_TEXT.nothingHeard);
  await hold(1_000);
  assert.equal(status(), "Sage is still working out the last recording. Try again in a moment.");
  media.recordingSeconds = 0;
  await hold(1_000);
  assert.equal(status(), VOICE_TEXT.nothingHeard, "an empty recording isn't sent");
  assert.equal(el("input").value, "");
});

test("an error while turning the recording into sound gives a plain message", async (t) => {
  const { status, hold } = await voiceWindow(t, {
    transcribe: async () => {
      throw new Error("the main process didn't answer");
    },
  });
  await hold(1_000);
  assert.equal(status(), VOICE_TEXT.badRecording);
});

test("with no speech file, talking offers the download; the main process asks, then it downloads", async (t) => {
  let model: "missing" | "downloading" | "ready" = "missing";
  let received = 0;
  const download = deferred<{ status: "done" }>();
  let downloads = 0;
  let cancels = 0;
  const { el, status, media, hold } = await voiceWindow(t, {
    overrides: {
      voiceStatus: async () => ({ model, received, total: 44_000_000 }),
      downloadVoice: () => {
        downloads++;
        return download.promise;
      },
      cancelVoiceDownload: async () => {
        cancels++;
      },
    },
  });
  await hold(1_000);
  assert.equal(media.streams.length, 0, "the microphone isn't opened without the speech file");
  assert.equal(status(), VOICE_TEXT.offer);
  assert.equal(el("voice-download").hidden, false);
  assert.equal(el("voice-download").textContent, "Download");

  el("voice-download").click();
  el("voice-download").click();
  await settled();
  assert.equal(downloads, 1, "one download at a time");
  assert.equal(status(), VOICE_TEXT.asking);
  model = "downloading";
  received = 22_000_000;
  t.mock.timers.tick(500);
  await settled();
  assert.equal(status(), "Downloading the speech file… 22 of 44 MB");
  assert.equal(el("voice-cancel").hidden, false);
  el("voice-cancel").click();
  await settled();
  assert.equal(cancels, 1);
  pressKey("keydown", ctrlSpace);
  await settled();
  assert.equal(status(), VOICE_TEXT.waitForDownload);
  assert.equal(media.streams.length, 0);
  pressKey("keyup", { key: "Control" });

  model = "ready";
  download.resolve({ status: "done" });
  await settled();
  assert.equal(status(), VOICE_TEXT.ready);
  assert.equal(el("voice-download").hidden, true);
  assert.equal(el("voice-cancel").hidden, true);
  await hold(1_000);
  assert.equal(el("input").value, "hello Sage");
});

test("a declined, cancelled or failed download says so and offers to try again", async (t) => {
  const results = [
    { status: "declined" as const },
    { status: "cancelled" as const },
    { status: "failed" as const, message: "Sage couldn't reach Hugging Face." },
  ];
  const { el, status, hold } = await voiceWindow(t, {
    overrides: {
      voiceStatus: async () => ({ model: "missing", received: 0, total: 1 }),
      downloadVoice: async () => {
        const next = results.shift();
        if (!next) throw new Error("the main process didn't answer");
        return next;
      },
    },
  });
  await hold(1_000);
  const expected = [
    [VOICE_TEXT.declined, "Download"],
    [VOICE_TEXT.cancelled, "Try again"],
    ["Sage couldn't reach Hugging Face.", "Try again"],
    [VOICE_TEXT.downloadFailed, "Try again"],
  ];
  for (const [text, button] of expected) {
    el("voice-download").click();
    await settled();
    assert.equal(status(), text);
    assert.equal(el("voice-download").textContent, button);
    assert.equal(el("voice-download").hidden, false);
  }
});

test("if the speech file has gone when a recording is sent, the download is offered", async (t) => {
  const { el, status, hold } = await voiceWindow(t, {
    transcribe: async () => ({
      ok: false,
      message: "Voice needs its speech file first.",
      needsDownload: true,
    }),
  });
  await hold(1_000);
  assert.equal(status(), "Voice needs its speech file first.");
  assert.equal(el("voice-download").hidden, false);
  await hold(1_000);
  assert.equal(status(), VOICE_TEXT.offer, "the next press offers the download straight away");
});

test("a reply to a voice message is read aloud with a voice on this PC; a typed one isn't", async (t) => {
  const { el, media, hold } = await voiceWindow(t, {
    before: (m) => {
      m.speech.voices = [
        voice("Online voice", { localService: false, default: true }),
        voice("French", { lang: "fr-FR" }),
        voice("Local English"),
      ];
    },
  });
  el("input").value = "typed";
  el("input").dispatch("keydown", { key: "Enter" });
  await settled();
  assert.equal(media.speech.spoken.length, 0, "typed message: not read aloud");

  await hold(1_000);
  el("input").value += " please";
  el("input").dispatch("keydown", { key: "Enter" });
  await settled();
  assert.equal(media.speech.spoken.length, 1, "edited after talking still counts as a voice message");
  const spoken = media.speech.spoken[0]!;
  assert.equal(spoken.text, "The reply.");
  assert.equal(spoken.voice?.name, "Local English", "never an online voice");
  assert.equal(el("stop-speaking").hidden, false);
  el("stop-speaking").click();
  assert.equal(media.speech.speaking, false);
  assert.equal(el("stop-speaking").hidden, true);

  // Words from talking, all deleted, then typed: not a voice message.
  await hold(1_000);
  el("input").value = "";
  el("input").dispatch("input");
  el("input").value = "typed instead";
  el("input").dispatch("keydown", { key: "Enter" });
  await settled();
  assert.equal(media.speech.spoken.length, 1);
});

test("Read replies aloud: always, never, and a failed send is never read", async (t) => {
  await t.test("always", async (t) => {
    const { el, media } = await voiceWindow(t, { settings: { speakReplies: "always" } });
    el("input").value = "typed";
    el("input").dispatch("keydown", { key: "Enter" });
    await settled();
    assert.deepEqual(
      media.speech.spoken.map((u) => u.text),
      ["The reply."],
    );
    media.speech.finish();
    assert.equal(el("stop-speaking").hidden, true);
  });
  await t.test("never", async (t) => {
    const { el, media, hold } = await voiceWindow(t, { settings: { speakReplies: "never" } });
    await hold(1_000);
    el("input").dispatch("keydown", { key: "Enter" });
    await settled();
    assert.equal(media.speech.spoken.length, 0);
  });
  await t.test("failed send", async (t) => {
    const { el, media, hold, texts } = await voiceWindow(t, {
      send: async () => {
        throw new Error("down");
      },
    });
    await hold(1_000);
    el("input").dispatch("keydown", { key: "Enter" });
    await settled();
    assert.deepEqual(texts(), ["hello Sage", "Something went wrong. Try again."]);
    assert.equal(media.speech.spoken.length, 0);
  });
  assert.equal(shouldSpeak("voice", false), false);
  assert.equal(shouldSpeak("voice", true), true);
  assert.equal(shouldSpeak("always", false), true);
  assert.equal(shouldSpeak("never", true), false);
});

test("the talk key and New chat stop Sage speaking, so it never hears itself", async (t) => {
  const { el, media } = await voiceWindow(t, { settings: { speakReplies: "always" } });
  const say = async () => {
    el("input").value = "hi";
    el("input").dispatch("keydown", { key: "Enter" });
    await settled();
    assert.equal(media.speech.speaking, true);
  };
  await say();
  pressKey("keydown", ctrlSpace);
  assert.equal(media.speech.speaking, false, "stopped by the talk key");
  await settled();
  pressKey("keyup", { key: "Control" });
  await settled();
  await say();
  el("new-chat").click();
  assert.equal(media.speech.speaking, false, "stopped by New chat");
  assert.equal(el("stop-speaking").hidden, true);
});

test("a reply that arrives while Sage is listening isn't read aloud", async (t) => {
  const reply = deferred<string>();
  const { el, media } = await voiceWindow(t, {
    send: () => reply.promise,
    settings: { speakReplies: "always" },
  });
  el("input").value = "hi";
  el("input").dispatch("keydown", { key: "Enter" });
  await settled();
  pressKey("keydown", ctrlSpace);
  await settled();
  reply.resolve("Answer");
  await settled();
  assert.equal(media.speech.spoken.length, 0);
});

test("Settings waits for the voice list before saying there is no voice", async (t) => {
  await t.test("a late list with a voice: no note, and replies are spoken", async (t) => {
    const { el, media } = await voiceWindow(t, {
      settings: { speakReplies: "always" },
      before: (m) => {
        m.speech.voices = [];
      },
    });
    assert.equal(el("voice-note").textContent, "", "not decided yet");
    media.speech.loadVoices([voice("Late voice")]);
    assert.equal(el("voice-note").textContent, "");
    t.mock.timers.tick(10_000);
    assert.equal(el("voice-note").textContent, "");
    el("input").value = "hi";
    el("input").dispatch("keydown", { key: "Enter" });
    await settled();
    assert.equal(media.speech.spoken[0]?.voice?.name, "Late voice");
  });
  await t.test("a list with only online voices: the note, and nothing is spoken", async (t) => {
    const { el, media } = await voiceWindow(t, {
      settings: { speakReplies: "always" },
      before: (m) => {
        m.speech.voices = [];
      },
    });
    media.speech.loadVoices([voice("Online", { localService: false })]);
    assert.equal(el("voice-note").textContent, VOICE_TEXT.noVoice);
    el("input").value = "hi";
    el("input").dispatch("keydown", { key: "Enter" });
    await settled();
    assert.equal(media.speech.spoken.length, 0);
  });
  await t.test("no list at all: the note after waiting", async (t) => {
    const { el } = await voiceWindow(t, {
      before: (m) => {
        m.speech.voices = [];
      },
    });
    t.mock.timers.tick(9_999);
    assert.equal(el("voice-note").textContent, "");
    t.mock.timers.tick(1);
    assert.equal(el("voice-note").textContent, VOICE_TEXT.noVoice);
  });
});

test("the Read replies aloud setting is shown and saved with the other settings", async (t) => {
  const { el, calls } = await voiceWindow(t, { settings: { speakReplies: "never" } });
  assert.equal(el("speak-replies").value, "never");
  for (const [shown, saved] of [
    ["always", "always"],
    ["voice", "voice"],
    ["something else", "voice"],
  ]) {
    el("speak-replies").value = shown!;
    el("settings-form").dispatch("submit");
    await settled();
    assert.equal((calls.saved.at(-1) as { speakReplies: string }).speakReplies, saved);
  }
});

test("small helpers: the timer, and adding words to the message box", () => {
  assert.equal(formatSeconds(0), "0:00");
  assert.equal(formatSeconds(65_400), "1:05");
  assert.equal(formatSeconds(-5), "0:00");
  assert.equal(appendTranscript("", " hi "), "hi");
  assert.equal(appendTranscript("Note:", "buy milk"), "Note: buy milk");
  assert.equal(appendTranscript("Note:\n", "buy milk"), "Note:\nbuy milk");
  assert.equal(appendTranscript("kept", "  "), "kept");
});

test("the window's voice code uses no worklets, workers or blob addresses, and never logs", async () => {
  for (const file of ["renderer.ts", "voice.ts", "voice-text.ts", "voice-controls.ts"]) {
    const source = await readFile(new URL(`../src/renderer/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /AudioWorklet|audioWorklet|new Worker|SharedWorker|createObjectURL|console\./,
      file,
    );
  }
});
