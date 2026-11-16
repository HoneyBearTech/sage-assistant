// How fast Sage's newest reply types itself out, without the DOM, so the tests can check the
// numbers directly. typing.ts does the typing.

/** Each character takes this long... */
export const TYPE_MS_PER_CHAR = 12;
/** ...but a whole reply never takes longer than this. */
export const TYPE_MAX_MS = 1_200;
/** How often the typed text grows: about once a frame. */
export const TYPE_FRAME_MS = 16;

/** How long typing out `length` characters takes. */
export function typingDuration(length: number): number {
  return Math.min(TYPE_MAX_MS, Math.max(0, length) * TYPE_MS_PER_CHAR);
}

/** How many of `length` characters are shown `elapsed` ms after typing started. */
export function typedCount(length: number, elapsed: number): number {
  const duration = typingDuration(length);
  if (duration === 0) return length;
  return Math.min(length, Math.ceil((length * Math.max(0, elapsed)) / duration));
}
