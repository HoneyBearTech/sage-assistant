import assert from "node:assert/strict";
import { test } from "node:test";
import { ASKING_TEXT } from "../src/renderer/asking-text.js";
import { settled } from "./helpers.js";
import { startWindow } from "./window.js";

// The asking card in the chat (src/renderer/asking-cards.ts), run in the real window script on the
// fake DOM. The news comes in as the preload hands it over.

test("while Sage's box asks, the chat shows the same question in an amber card, then the answer", async (t) => {
  const { el, emitAsking } = await startWindow(t, async () => "");
  emitAsking({ id: "ask-1", state: "open", text: 'Open the app "Notepad".' });
  const card = el("messages").children[0]!;
  assert.equal(card.tag, "li");
  assert.equal(card.classList.contains("asking"), true);
  assert.equal(card.classList.contains("open"), true);
  const [question, state] = card.children;
  assert.equal(question!.textContent, 'Sage is asking: Open the app "Notepad".');
  assert.equal(state!.textContent, ASKING_TEXT.waiting);
  // Only news: the card has no buttons or anything else to press.
  assert.deepEqual(
    card.children.map((child) => child.tag),
    ["p", "p"],
  );

  emitAsking({ id: "ask-1", state: "closed", allowed: true });
  assert.equal(card.classList.contains("open"), false);
  assert.equal(card.classList.contains("allowed"), true);
  assert.equal(state!.textContent, "Allowed");

  emitAsking({ id: "ask-2", state: "open", text: 'Delete the note "Shopping".' });
  emitAsking({ id: "ask-2", state: "closed", allowed: false });
  const second = el("messages").children[1]!;
  assert.equal(second.classList.contains("declined"), true);
  assert.equal(second.children[1]!.textContent, "Not allowed");
});

test("news that doesn't fit is ignored: a second open, an unknown close, a close after New chat", async (t) => {
  const { el, emitAsking } = await startWindow(t, async () => "");
  emitAsking({ id: "ask-1", state: "open", text: "Open it?" });
  emitAsking({ id: "ask-1", state: "open", text: "Open it?" });
  assert.equal(el("messages").children.length, 1);
  emitAsking({ id: "ask-9", state: "closed", allowed: true });
  assert.equal(el("messages").children[0]!.classList.contains("open"), true);

  el("new-chat").click();
  await settled();
  assert.equal(el("messages").children.length, 0);
  emitAsking({ id: "ask-1", state: "closed", allowed: true });
  assert.equal(el("messages").children.length, 0, "nothing comes back");
  // The same question asked again after New chat gets a card of its own.
  emitAsking({ id: "ask-1", state: "open", text: "Open it?" });
  assert.equal(el("messages").children.length, 1);
});

test("the question is shown as text, whatever it contains", async (t) => {
  const { el, emitAsking } = await startWindow(t, async () => "");
  const text = 'Open the file "<img src=x onerror=alert(1)>.pdf".';
  emitAsking({ id: "ask-1", state: "open", text });
  assert.equal(el("messages").children[0]!.children[0]!.textContent, `Sage is asking: ${text}`);
});
