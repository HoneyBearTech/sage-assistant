import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { windowOptions } from "../src/main/security.js";

// The window's look (src/renderer/styles.css): readable in both themes. The colours are tokens
// written as light-dark(<light>, <dark>), read here straight from the stylesheet.

const css = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function rootBlock(): string {
  const start = css.indexOf(":root {");
  assert.ok(start >= 0, "styles.css starts its tokens with :root");
  return css.slice(start, css.indexOf("\n}", start));
}

/** Each colour token, as [light, dark]. */
function tokens(): Map<string, [string, string]> {
  const found = new Map<string, [string, string]>();
  for (const match of rootBlock().matchAll(
    /--([\w-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi,
  )) {
    found.set(match[1]!, [match[2]!, match[3]!]);
  }
  return found;
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The WCAG contrast ratio of two colours. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

test("the contrast check itself gives the known answers", () => {
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#ffffff", "#ffffff"), 1);
  assert.ok(Math.abs(contrast("#767676", "#ffffff") - 4.54) < 0.01);
});

test("text, labels and the accent keep at least 4.5 to 1 on every background, in both themes", () => {
  const colours = tokens();
  const pairs: [string, string][] = [];
  for (const foreground of ["text", "muted", "accent", "amber", "danger"]) {
    for (const background of ["ground", "panel", "panel-2"]) pairs.push([foreground, background]);
  }
  // The text on the main (filled) buttons.
  pairs.push(["accent-ink", "accent"]);
  for (const [index, theme] of ["light", "dark"].entries()) {
    for (const [foreground, background] of pairs) {
      const fg = colours.get(foreground)?.[index];
      const bg = colours.get(background)?.[index];
      assert.ok(fg && bg, `--${foreground} and --${background} are light-dark() tokens`);
      const ratio = contrast(fg, bg);
      assert.ok(ratio >= 4.5, `${theme}: --${foreground} on --${background} is ${ratio.toFixed(2)} to 1`);
    }
  }
});

test("dark is the default look; light and system are chosen on <html>", () => {
  assert.match(rootBlock(), /color-scheme: dark;/);
  assert.match(css, /:root\[data-theme="light"\] \{\s*color-scheme: light;\s*\}/);
  assert.match(css, /:root\[data-theme="system"\] \{\s*color-scheme: light dark;\s*\}/);
  // The window's background before the page paints matches the dark ground.
  const ground = tokens().get("ground")?.[1];
  assert.equal(windowOptions("/p", false, "/i").backgroundColor, ground);
});

test("no text is smaller than 12 px, and only the PC's own fonts are used", () => {
  const label = rootBlock().match(/--label-size: (\d+)px;/);
  assert.ok(label && Number(label[1]) >= 12);
  const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1]!.trim());
  assert.ok(sizes.length > 5);
  for (const size of sizes) {
    if (size === "var(--label-size)") continue;
    const px = size.match(/^(\d+(?:\.\d+)?)px$/);
    assert.ok(px, `font sizes are in px or the label size: ${size}`);
    assert.ok(Number(px[1]) >= 12, `${size} is at least 12 px`);
  }
  // No font shorthand that could hide a size, and nothing loaded from elsewhere.
  assert.ok(!/^\s*font:(?!\s*inherit;)/m.test(css), "no font shorthand with a size in it");
  assert.ok(!/@font-face|@import|url\(/.test(css), "no font files, imports or addresses");
});

test("all motion stops when the system asks for reduced motion", () => {
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(block, /animation: none !important;/);
  assert.match(block, /transition: none !important;/);
});

test("the hidden attribute wins over every display rule, so held notices stay hidden", () => {
  // renderer.ts hides a held notice with item.hidden = true, and .message sets display: grid; the
  // views, Welcome steps, voice buttons and tabs are hidden the same way.
  const rule = css.match(/^\[hidden\] \{([^}]*)\}/m);
  assert.ok(rule, "a top-level [hidden] rule");
  assert.match(rule[1]!, /display: none !important;/);
  // Nothing else may give a hidden element a display of its own with !important.
  const important = [...css.matchAll(/display: (\w+) !important;/g)].map((match) => match[1]);
  assert.deepEqual(important, ["none"]);
  assert.match(css, /\.message \{[^}]*display: grid;/, "the case that needed it");
});

test("Home's clock, greeting, panels and brief use only the checked colours, at 12 px or more", () => {
  // The rules for Home's own elements, outside the reduced-motion and short-window blocks too.
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) =>
    /\.home|\.panel|\.brief-text|\.orb-large/.test(match[1]!),
  );
  assert.ok(rules.length >= 15, `found ${rules.length} Home rules`);
  // The text colours whose contrast the test above checks on every background, in both themes.
  const checked = new Set(["var(--text)", "var(--muted)", "var(--accent)", "var(--amber)", "transparent"]);
  const seen = new Set<string>();
  for (const [, selector, body] of rules) {
    for (const color of body!.matchAll(/(?:^|[\s;])color:\s*([^;]+);/g)) {
      assert.ok(checked.has(color[1]!.trim()), `${selector!.trim()}: color ${color[1]}`);
      seen.add(color[1]!.trim());
    }
    for (const size of body!.matchAll(/font-size:\s*([^;]+);/g)) {
      const value = size[1]!.trim();
      if (value === "var(--label-size)") continue;
      assert.ok(Number(value.match(/^(\d+)px$/)?.[1]) >= 12, `${selector!.trim()}: ${value}`);
    }
  }
  for (const used of ["var(--text)", "var(--muted)", "var(--accent)", "var(--amber)"])
    assert.ok(seen.has(used));
  // The typed brief's own text is transparent only while its copy is drawn over it.
  assert.match(css, /\.brief-text\.typing \{\s*color: transparent;\s*\}/);
  assert.match(css, /\.brief-text \.typed \{[^}]*color: var\(--text\);/);
  // The panels get the corner ticks, like the other panels.
  assert.match(css, /fieldset::before,\s*\.step::before,\s*\.composer::before,\s*\.panel::before,/);
});

test("the Welcome screen's numbers, check lines, support codes and diagnostics use only checked colours, at 12 px or more", () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) =>
    /\.step-number|\.check-l|\.support-code|\.diagnostics-text/.test(match[1]!),
  );
  assert.ok(rules.length >= 14, `found ${rules.length} Welcome rules`);
  // Each of these has its contrast checked above, on every background and in both themes.
  const checked = new Set([
    "var(--text)",
    "var(--muted)",
    "var(--accent)",
    "var(--amber)",
    "var(--danger)",
    "transparent",
  ]);
  const seen = new Set<string>();
  for (const [, selector, body] of rules) {
    for (const color of body!.matchAll(/(?:^|[\s;])color:\s*([^;]+);/g)) {
      assert.ok(checked.has(color[1]!.trim()), `${selector!.trim()}: color ${color[1]}`);
      seen.add(color[1]!.trim());
    }
    for (const size of body!.matchAll(/font-size:\s*([^;]+);/g)) {
      const value = size[1]!.trim();
      if (value === "var(--label-size)") continue;
      assert.ok(Number(value.match(/^(\d+)px$/)?.[1]) >= 12, `${selector!.trim()}: ${value}`);
    }
  }
  for (const used of ["var(--text)", "var(--muted)", "var(--accent)", "var(--amber)", "var(--danger)"]) {
    assert.ok(seen.has(used), used);
  }
  // A typing line's own text is transparent only while its copy is drawn over it.
  assert.match(css, /\.check-line\.typing \{\s*color: transparent;\s*\}/);
  assert.match(css, /\.check-line \.typed \{[^}]*color: var\(--text\);/);
  // The diagnostics box has the panel colours, and the support code is a label in amber.
  assert.match(css, /\.diagnostics-text \{[^}]*background: var\(--panel-2\);/);
  assert.match(css, /\.support-code \{[^}]*font-size: var\(--label-size\);[^}]*color: var\(--amber\);/);
});
