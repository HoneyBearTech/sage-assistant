// A tiny stand-in for the browser's DOM: just the parts src/renderer/renderer.ts uses, so the real
// window script can run under the tests without Electron or a browser.

type Listener = (event: FakeEvent) => void;

export interface FakeEvent {
  key?: string;
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
  button?: number;
  pointerId?: number;
  preventDefault(): void;
}

let focused: FakeElement | undefined;

/** The element focused last, as `document.activeElement` would say. */
export function focusedElement(): FakeElement | undefined {
  return focused;
}

class FakeClassList {
  private readonly names = new Set<string>();
  constructor(private readonly element: FakeElement) {}
  add(name: string) {
    this.names.add(name);
  }
  remove(name: string) {
    this.names.delete(name);
  }
  toggle(name: string, on: boolean) {
    if (on) this.names.add(name);
    else this.names.delete(name);
  }
  contains(name: string) {
    return this.names.has(name) || this.element.className.split(" ").includes(name);
  }
}

export class FakeElement {
  value = "";
  textContent = "";
  disabled = false;
  hidden = false;
  checked = false;
  className = "";
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList(this);
  private readonly listeners = new Map<string, Listener[]>();
  private readonly attributes = new Map<string, string>();
  /** For the form: the brain radio buttons. */
  radios: FakeElement[] = [];

  constructor(readonly tag: string) {}

  parent: FakeElement | undefined;

  append(...items: FakeElement[]) {
    for (const item of items) item.parent = this;
    this.children.push(...items);
  }
  replaceChildren() {
    for (const child of this.children) child.parent = undefined;
    this.children.length = 0;
  }
  remove() {
    const siblings = this.parent?.children;
    const index = siblings?.indexOf(this) ?? -1;
    if (index >= 0) siblings!.splice(index, 1);
    this.parent = undefined;
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  dispatch(type: string, init: Partial<FakeEvent> = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener({ preventDefault: () => {}, ...init });
  }
  click() {
    this.dispatch("click");
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  scrollIntoView() {}
  focus() {
    focused = this;
  }
  /** Pointer ids captured by the Talk button. */
  readonly captured: number[] = [];
  setPointerCapture(id: number) {
    this.captured.push(id);
  }
  querySelectorAll() {
    return this.radios;
  }
  querySelector() {
    return this.radios.find((radio) => radio.checked) ?? null;
  }
}

/** Builds the elements the window script looks up, and installs `document` and `window`. */
export function installFakeDom(ids: readonly string[], sage: unknown): Map<string, FakeElement> {
  const elements = new Map<string, FakeElement>();
  for (const id of ids) elements.set(id, new FakeElement(id));
  const form = elements.get("settings-form");
  if (form) {
    form.radios = ["local", "claude", "openai", "gemini", "other"].map((value) => {
      const radio = new FakeElement("input");
      radio.value = value;
      return radio;
    });
  }
  const globals = globalThis as Record<string, unknown>;
  globals.document = fakeDocument(elements);
  const windowEvents = new FakeElement("window");
  globals.window = {
    sage,
    addEventListener: (type: string, listener: Listener) => windowEvents.addEventListener(type, listener),
    dispatch: (type: string, init?: Partial<FakeEvent>) => windowEvents.dispatch(type, init),
  };
  return elements;
}

function fakeDocument(elements: Map<string, FakeElement>) {
  const listeners = new FakeElement("document");
  return {
    /** The page's <html> element: the theme is set on it. */
    documentElement: new FakeElement("html"),
    visibilityState: "visible" as "visible" | "hidden",
    get activeElement() {
      return focused ?? null;
    },
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => new FakeElement(tag),
    addEventListener: (type: string, listener: Listener) => listeners.addEventListener(type, listener),
    dispatch: (type: string, init?: Partial<FakeEvent>) => listeners.dispatch(type, init),
  };
}

/** A key event on the whole page, as the window script sees it on `document`. */
export function pressKey(type: "keydown" | "keyup", init: Partial<FakeEvent>): { prevented: boolean } {
  const document = (globalThis as { document?: ReturnType<typeof fakeDocument> }).document;
  if (!document) throw new Error("the fake DOM isn't installed");
  const result = { prevented: false };
  document.dispatch(type, {
    ...init,
    preventDefault: () => {
      result.prevented = true;
    },
  });
  return result;
}

/** The page's <html> element, where the window sets its theme. */
export function rootElement(): FakeElement {
  const document = (globalThis as { document?: ReturnType<typeof fakeDocument> }).document;
  if (!document) throw new Error("the fake DOM isn't installed");
  return document.documentElement;
}

/**
 * The system's "reduce motion" setting, as the page's matchMedia reports it. Without this the fake
 * window has no matchMedia, which the window treats as reduced motion.
 */
export function setReducedMotion(reduce: boolean): void {
  const window = (globalThis as { window?: Record<string, unknown> }).window;
  if (!window) throw new Error("the fake DOM isn't installed");
  window.matchMedia = (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" && reduce,
  });
}

/** The window loses focus (another app was clicked). */
export function blurWindow(): void {
  const window = (globalThis as { window?: { dispatch(type: string): void } }).window;
  if (!window) throw new Error("the fake DOM isn't installed");
  window.dispatch("blur");
}

/** Hides or shows the whole window (minimised, or behind another one), as the browser reports it. */
export function setWindowVisibility(state: "visible" | "hidden"): void {
  const document = (globalThis as { document?: ReturnType<typeof fakeDocument> }).document;
  if (!document) throw new Error("the fake DOM isn't installed");
  document.visibilityState = state;
  document.dispatch("visibilitychange");
}

export function removeFakeDom(): void {
  focused = undefined;
  const globals = globalThis as Record<string, unknown>;
  delete globals.document;
  delete globals.window;
}
