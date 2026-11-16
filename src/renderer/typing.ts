import { TYPE_FRAME_MS, typedCount } from "./typing-time.js";

// Sage's newest reply types itself out, quickly. The row already holds the whole reply as its text
// from the start (screen readers get it at once, and the row has its final size, so nothing jumps);
// the typing is a copy laid over it that grows to full length, while the row's own text is drawn
// transparent. Any click or key shows the whole reply at once, and with reduced motion there is no
// typing at all.

export interface Typist {
  /** Types `text` out over `item`, which already holds it. Ends any typing still running. */
  type(item: HTMLElement, text: string): void;
  /** Shows the reply being typed in full, at once. */
  finish(): void;
  readonly typing: boolean;
}

export function createTypist(reducedMotion: () => boolean): Typist {
  let current: { item: HTMLElement; overlay: HTMLElement; timer: ReturnType<typeof setInterval> } | null =
    null;

  function finish(): void {
    if (!current) return;
    clearInterval(current.timer);
    current.overlay.remove();
    current.item.classList.remove("typing");
    current = null;
  }

  function type(item: HTMLElement, text: string): void {
    finish();
    // By characters, not code units, so an emoji is never shown half drawn.
    const characters = Array.from(text);
    if (reducedMotion() || characters.length < 2) return;
    const overlay = document.createElement("span");
    overlay.className = "typed";
    // The row's own text is what screen readers read; this copy is only for the eye.
    overlay.setAttribute("aria-hidden", "true");
    item.classList.add("typing");
    item.append(overlay);
    const started = Date.now();
    const step = () => {
      const shown = typedCount(characters.length, Date.now() - started);
      overlay.textContent = characters.slice(0, shown).join("");
      if (shown >= characters.length) finish();
    };
    current = { item, overlay, timer: setInterval(step, TYPE_FRAME_MS) };
    step();
  }

  // Any click or key: the whole reply, now.
  document.addEventListener("pointerdown", finish);
  document.addEventListener("keydown", finish);

  return {
    type,
    finish,
    get typing() {
      return current !== null;
    },
  };
}
