import type { AskingEvent } from "../shared/api.js";
import { ASKING_TEXT, askingLine } from "./asking-text.js";

// The amber card in the chat while Sage's own box asks before it acts, and afterwards the answer.
// The card only shows the news: it has no buttons, and the box is answered in the box. Text is
// set with textContent only.

export interface AskingCards {
  /** Shows the news; says what changed, for the sounds ("opened", "allowed", "declined"). */
  handle(event: AskingEvent): "opened" | "allowed" | "declined" | null;
  /** New chat: the cards are gone with the rest of the chat. */
  clear(): void;
}

export function createAskingCards(list: HTMLElement): AskingCards {
  const open = new Map<string, { card: HTMLElement; state: HTMLElement }>();
  return {
    handle(event) {
      if (event.state === "open") {
        if (open.has(event.id)) return null;
        const card = document.createElement("li");
        card.className = "message asking";
        card.classList.add("open");
        const question = document.createElement("p");
        question.className = "asking-question";
        question.textContent = askingLine(event.text);
        const state = document.createElement("p");
        state.className = "asking-state";
        state.textContent = ASKING_TEXT.waiting;
        card.append(question, state);
        list.append(card);
        card.scrollIntoView({ block: "end" });
        open.set(event.id, { card, state });
        return "opened";
      }
      const shown = open.get(event.id);
      if (!shown) return null;
      open.delete(event.id);
      shown.card.classList.remove("open");
      shown.card.classList.add(event.allowed ? "allowed" : "declined");
      shown.state.textContent = event.allowed ? ASKING_TEXT.allowed : ASKING_TEXT.declined;
      return event.allowed ? "allowed" : "declined";
    },
    clear() {
      open.clear();
    },
  };
}
