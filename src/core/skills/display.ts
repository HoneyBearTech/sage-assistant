/**
 * Text for the confirmation box. Anything that came from the model, a note, a reminder, Settings
 * or a file name is flattened to one plain line (no control characters, line breaks, or invisible
 * direction and formatting characters that could make the box say something it doesn't),
 * shortened, and put inside quotes, so the box stays short and reads the way it will be acted on.
 */

// Control characters (Cc), invisible formatting characters including bidirectional overrides and
// zero-width characters (Cf), and the Unicode line and paragraph separators (Zl, Zp).
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

// Characters that draw nothing but aren't counted as spaces or formatting: the Hangul fillers
// (U+115F, U+1160, U+3164, U+FFA0), the blank Braille pattern (U+2800), the combining grapheme
// joiner (U+034F), the Khmer inherent vowels (U+17B4, U+17B5) and the variation selectors. They
// could pad a title so the real action is pushed out of sight, or hide a gap that looks like text.
const BLANK_POINTS = [0x034f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x2800, 0x3164, 0xffa0];
const BLANK_RANGES: [number, number][] = [
  [0xfe00, 0xfe0f],
  [0xe0100, 0xe01ef],
];
const LOOKALIKE_BLANKS = new RegExp(
  `[${BLANK_POINTS.map((point) => String.fromCodePoint(point)).join("")}${BLANK_RANGES.map(
    ([from, to]) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`,
  ).join("")}]`,
  "gu",
);

/**
 * At most this many combining marks are kept on one letter; more can smear over nearby text.
 * Three leaves room for real accents and the vowel signs of scripts such as Devanagari.
 */
export const MAX_COMBINING_MARKS = 3;
const STACKED_MARKS = new RegExp(`(\\p{M}{${MAX_COMBINING_MARKS}})\\p{M}+`, "gu");

export function flatten(text: string): string {
  return text
    .replace(HIDDEN, " ")
    .replace(LOOKALIKE_BLANKS, " ")
    .replace(STACKED_MARKS, "$1")
    .replace(/\s+/g, " ")
    .trim();
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

// Straight and curly double quotes, and the guillemets: anything that could look like the end of
// the quoted text. Inside the quotes they become a plain single quote.
const QUOTE_LIKE = /["“”„‟«»＂]/g;

/** User-supplied text for the box: one plain line, inside double quotes, with no quotes inside. */
export function quoted(text: string, max = 80): string {
  return `"${plainText(text, max).replace(QUOTE_LIKE, "'")}"`;
}

/** A user-supplied path for the box: shortened like plainPath, inside double quotes. */
export function quotedPath(path: string, max = 200): string {
  return `"${plainPath(path, max).replace(QUOTE_LIKE, "'")}"`;
}

/** The whole sentence shown in the box: one plain line, at most 600 characters. */
export function dialogText(summary: string): string {
  return plainText(summary, 600);
}
