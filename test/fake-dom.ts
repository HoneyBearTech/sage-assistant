// A tiny stand-in for the browser's DOM: just the parts src/renderer/renderer.ts uses, so the real
// window script can run under the tests without Electron or a browser.

type Listener = (event: FakeEvent) => void;

export interface FakeEvent {
  key?: string;
  shiftKey?: boolean;
  preventDefault(): void;
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

  append(...items: FakeElement[]) {
    this.children.push(...items);
  }
  replaceChildren() {
    this.children.length = 0;
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
  scrollIntoView() {}
  focus() {}
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
    form.radios = ["local", "online"].map((value) => {
      const radio = new FakeElement("input");
      radio.value = value;
      return radio;
    });
  }
  const globals = globalThis as Record<string, unknown>;
  globals.document = {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => new FakeElement(tag),
  };
  globals.window = { sage };
  return elements;
}

export function removeFakeDom(): void {
  const globals = globalThis as Record<string, unknown>;
  delete globals.document;
  delete globals.window;
}
