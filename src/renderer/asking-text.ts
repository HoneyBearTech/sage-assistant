// The words on the asking card, without the DOM, so the tests can use them.

export const ASKING_TEXT = {
  /** Before the question, word for word as Sage's box shows it. */
  prefix: "Sage is asking: ",
  waiting: "Answer in the box Sage opened",
  allowed: "Allowed",
  declined: "Not allowed",
} as const;

export function askingLine(question: string): string {
  return `${ASKING_TEXT.prefix}${question}`;
}
