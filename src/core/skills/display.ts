/**
 * Text for the confirmation box. Anything that came from the model, a note, a reminder or a file
 * name is flattened to one plain line (no control characters, line breaks, or invisible
 * direction and formatting characters that could make the box say something it doesn't) and
 * shortened, so the box stays short and reads the way it will be acted on.
 */

// Control characters (Cc), invisible formatting characters including bidirectional overrides and
// zero-width characters (Cf), and the Unicode line and paragraph separators (Zl, Zp).
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

export function flatten(text: string): string {
  return text.replace(HIDDEN, " ").replace(/\s+/g, " ").trim();
}

/** One plain line, at most `max` characters, ending in "…" when it was shortened. */
export function plainText(text: string, max = 80): string {
  const flat = flatten(text);
  const chars = [...flat];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : flat;
}

/** A path on one line; a very long one keeps its start and its file name, with "…" between. */
export function plainPath(path: string, max = 200): string {
  const flat = flatten(path);
  const chars = [...flat];
  if (chars.length <= max) return flat;
  const tail = Math.floor((max - 1) / 2);
  return `${chars.slice(0, max - 1 - tail).join("")}…${chars.slice(chars.length - tail).join("")}`;
}

/** The whole sentence shown in the box: one plain line, at most 600 characters. */
export function dialogText(summary: string): string {
  return plainText(summary, 600);
}
