/**
 * The public-repo checker's rules. This repository is public, so nothing in it may point at a
 * private network or a person: no private IP addresses, no LAN host names, no home folders with a
 * real user name in them, and no e-mail addresses other than no-reply and example ones.
 */

export type FindingKind = "private-ip" | "lan-hostname" | "home-path" | "email";

export interface Finding {
  file: string;
  line: number;
  kind: FindingKind;
  match: string;
}

/** User names that are obviously placeholders in a home path. */
export const PLACEHOLDER_USERS = new Set([
  "user",
  "username",
  "you",
  "yourname",
  "your-name",
  "your_name",
  "yourusername",
  "me",
  "name",
  "example",
  "someone",
  "alice",
  "bob",
  "public",
  "default",
  "shared",
  "runner",
  "xxx",
  "...",
]);

const IPV4 = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d]|\.\d)/g;
const LAN_HOST =
  /(?<![\w.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:local|lan|internal|home)(?![\w-]|\.[a-z0-9])/gi;
const POSIX_HOME = /(?<![\w.:])\/(home|Users)\/([A-Za-z0-9._-]+)/g;
const WINDOWS_HOME =
  /\b[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)([A-Za-z0-9._ -]+?)(?=\\|\/|["'`\s)\]>,;]|$)/gi;
const EMAIL = /(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g;

export function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0] = octets;
  if (octets.some((o) => o > 255)) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isAllowedEmail(address: string): boolean {
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at).toLowerCase();
  const domain = address.slice(at + 1).toLowerCase();
  if (local === "noreply" || local === "no-reply" || local.endsWith("+noreply")) return true;
  if (domain === "users.noreply.github.com" || domain === "noreply.github.com") return true;
  if (["example.com", "example.org", "example.net"].includes(domain)) return true;
  if (domain.endsWith(".example.com") || domain.endsWith(".example") || domain.endsWith(".invalid"))
    return true;
  if (domain.endsWith(".test") || domain === "localhost") return true;
  if (address.toLowerCase() === "git@github.com") return true;
  return false;
}

export function isPlaceholderUser(name: string): boolean {
  return PLACEHOLDER_USERS.has(name.trim().toLowerCase());
}

/**
 * True for a `"deprecated":` notice in package-lock.json. npm copies these from the registry, and
 * some name the package author's public contact address. Only e-mail findings are skipped there, and
 * only when the whole line is that one string property, so nothing placed after it is skipped.
 */
const LOCKFILE_DEPRECATION = /^\s*"deprecated": "(?:[^"\\]|\\.)*",?\s*$/;

function isLockfileDeprecation(file: string, content: string): boolean {
  return /(^|[\\/])package-lock\.json$/.test(file) && LOCKFILE_DEPRECATION.test(content);
}

/**
 * The escapes the checker decodes, as JSON writes them: backslash-u with four hex digits (group 1),
 * an escaped backslash (two backslashes), and backslash-slash. Nothing else is decoded.
 */
const ESCAPE = /\\(?:\\|\/|u([0-9a-fA-F]{4}))/g;

/** Marks a finding that only shows once the line's escapes are decoded. */
export const ESCAPES_NOTE = " (written with escapes)";

export interface Decoded {
  /** The line as JSON would read it. */
  text: string;
  /** True if it holds a backslash-u or backslash-slash escape (a lone backslash pair doesn't count). */
  escaped: boolean;
  /** For each decoded character, where it starts and ends in the written line. */
  spans: Array<[number, number]>;
}

/**
 * Decodes the escapes in one line in a single pass, the way JSON does: a backslash pair becomes one
 * backslash, backslash-slash becomes a slash, backslash-u and four hex digits becomes that character.
 * What a replacement produces is never decoded again. Surrogates are kept as written, so they can't crash.
 */
export function decodeEscapes(content: string): Decoded {
  let text = "";
  let escaped = false;
  let last = 0;
  const spans: Array<[number, number]> = [];
  const plain = (start: number, end: number) => {
    for (let i = start; i < end; i++) spans.push([i, i + 1]);
    text += content.slice(start, end);
  };
  const decoded = (char: string, start: number, end: number) => {
    spans.push([start, end]);
    text += char;
  };
  for (const match of content.matchAll(ESCAPE)) {
    const start = match.index ?? 0;
    plain(last, start);
    const hex = match[1];
    if (hex) escaped = true;
    else if (match[0] === "\\/") escaped = true;
    const end = start + match[0].length;
    decoded(hex ? String.fromCharCode(Number.parseInt(hex, 16)) : match[0].slice(1), start, end);
    last = end;
  }
  plain(last, content.length);
  return { text, escaped, spans };
}

type Hit = Pick<Finding, "kind" | "match"> & { index: number };

/** Runs every rule on one line of text. */
function scanLine(content: string, skipEmail: boolean): Hit[] {
  const hits: Hit[] = [];
  const at = (kind: FindingKind, match: RegExpMatchArray) =>
    hits.push({ kind, match: match[0], index: match.index ?? 0 });
  for (const match of content.matchAll(IPV4)) {
    const octets = match.slice(1, 5).map(Number);
    if (isPrivateIpv4(octets)) at("private-ip", match);
  }
  for (const match of content.matchAll(LAN_HOST)) at("lan-hostname", match);
  for (const match of content.matchAll(POSIX_HOME)) {
    if (!isPlaceholderUser(match[2] ?? "")) at("home-path", match);
  }
  for (const match of content.matchAll(WINDOWS_HOME)) {
    if (!isPlaceholderUser(match[1] ?? "")) at("home-path", match);
  }
  for (const match of content.matchAll(EMAIL)) {
    if (!skipEmail && !isAllowedEmail(match[0])) at("email", match);
  }
  return hits;
}

/**
 * Finds every problem in one file's text. A line with a backslash-u or backslash-slash escape is
 * scanned a second time, decoded, and every hit is placed by its span in the written line. A plain hit
 * that overlaps a decoded hit of the same kind is the same problem seen in part, so it is dropped. A
 * decoded hit on exactly a plain hit's span, with the same text, is reported plain; any other decoded
 * hit gets ESCAPES_NOTE after the match. So each finding is one position in the line.
 */
export function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  text.split(/\r?\n/).forEach((content, index) => {
    const skipEmail = isLockfileDeprecation(file, content);
    const line = index + 1;
    let plain = scanLine(content, skipEmail);
    const decoded = decodeEscapes(content);
    const extra: Finding[] = [];
    if (decoded.escaped) {
      const hits = scanLine(decoded.text, skipEmail).map((hit) => ({
        ...hit,
        from: decoded.spans[hit.index]?.[0] ?? 0,
        to: decoded.spans[hit.index + hit.match.length - 1]?.[1] ?? content.length,
      }));
      const overlaps = (p: Hit, d: (typeof hits)[number]) =>
        p.kind === d.kind && p.index < d.to && d.from < p.index + p.match.length;
      const same = (p: Hit, d: (typeof hits)[number]) =>
        p.index === d.from && p.index + p.match.length === d.to && p.match === d.match;
      const kept = plain.filter((p) => !hits.some((d) => overlaps(p, d)));
      const unchanged = plain.filter((p) => hits.some((d) => overlaps(p, d) && same(p, d)));
      for (const d of hits) {
        if (unchanged.some((p) => p.kind === d.kind && same(p, d))) continue;
        extra.push({ file, line, kind: d.kind, match: d.match + ESCAPES_NOTE });
      }
      plain = [...kept, ...unchanged];
    }
    for (const hit of plain) findings.push({ file, line, kind: hit.kind, match: hit.match });
    findings.push(...extra);
  });
  return findings;
}

/** True for files that look binary (a NUL byte near the start); those aren't scanned. */
export function looksBinary(data: Uint8Array): boolean {
  return data.subarray(0, 8000).includes(0);
}
