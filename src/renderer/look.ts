import type { PublicSettings } from "../shared/api.js";

// The window's look: the theme on the page's <html> element (styles.css picks the colours from it),
// and whether animation should be left out.

export type Theme = PublicSettings["theme"];

/** Sets the theme: "dark", "light", or "system" (follows the system's light or dark choice). */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Reads a theme from a form value; anything unknown is the default, dark. */
export function toTheme(value: string): Theme {
  return value === "light" || value === "system" ? value : "dark";
}

/**
 * True when the system asks for less motion. Where the page can't ask (no `matchMedia`), it is
 * treated as true: nothing then moves that doesn't have to.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
