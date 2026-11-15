/**
 * Just enough HTML handling to read a search results page, with no dependencies. It never builds
 * a DOM or runs anything: it finds tags with regular expressions and returns plain text.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** The visible text of an HTML fragment: tags removed, entities decoded, spaces collapsed. */
export function textOf(html: string): string {
  const withoutScripts = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ");
  return decodeEntities(withoutScripts.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads the attributes of an opening tag such as `<a class="x" href="y">`. */
export function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-z][a-z0-9_:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  for (const match of tag.matchAll(pattern)) {
    const name = match[1];
    if (name) attributes[name.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

export function hasClass(attributes: Record<string, string>, className: string): boolean {
  return (attributes.class ?? "").split(/\s+/).includes(className);
}

export interface Element {
  attributes: Record<string, string>;
  inner: string;
}

/** Every `<tag ...>...</tag>` in `html` (not nested ones of the same tag), in order. */
export function elements(html: string, tag: string): Element[] {
  const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
  return [...html.matchAll(pattern)].map((match) => ({
    attributes: attributesOf(match[1] ?? ""),
    inner: match[2] ?? "",
  }));
}
