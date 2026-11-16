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

/** A JSON/JavaScript escape: backslash-u and four hex digits, or backslash-slash. Two backslashes in a row are skipped whole. */
const ESCAPE = /\\(?:\\|\/|u([0-9a-fA-F]{4}))/g;

/** Marks a finding that only shows once the line's escapes are decoded. */
export const ESCAPES_NOTE = " (written with escapes)";

/** Decodes the escapes in one line; an escaped backslash stays as written, so a backslash pair before u is not an escape. */
export function decodeEscapes(content: string): string {
  return content.replace(ESCAPE, (all, hex?: string) =>
    hex ? String.fromCharCode(Number.parseInt(hex, 16)) : all === "\\/" ? "/" : all,
  );
}

type Hit = Pick<Finding, "kind" | "match">;

/** Runs every rule on one line of text. */
function scanLine(content: string, skipEmail: boolean): Hit[] {
  const hits: Hit[] = [];
  for (const match of content.matchAll(IPV4)) {
    const octets = match.slice(1, 5).map(Number);
    if (isPrivateIpv4(octets)) hits.push({ kind: "private-ip", match: match[0] });
  }
  for (const match of content.matchAll(LAN_HOST)) {
    hits.push({ kind: "lan-hostname", match: match[0] });
  }
  for (const match of content.matchAll(POSIX_HOME)) {
    if (!isPlaceholderUser(match[2] ?? "")) hits.push({ kind: "home-path", match: match[0] });
  }
  for (const match of content.matchAll(WINDOWS_HOME)) {
    if (!isPlaceholderUser(match[1] ?? "")) hits.push({ kind: "home-path", match: match[0] });
  }
  for (const match of content.matchAll(EMAIL)) {
    if (!skipEmail && !isAllowedEmail(match[0])) hits.push({ kind: "email", match: match[0] });
  }
  return hits;
}

/**
 * Finds every problem in one file's text. A line with escapes is scanned a second time, decoded;
 * what only shows up there is reported once, with ESCAPES_NOTE after the match.
 */
export function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  text.split(/\r?\n/).forEach((content, index) => {
    const skipEmail = isLockfileDeprecation(file, content);
    const line = index + 1;
    const plain = scanLine(content, skipEmail);
    for (const hit of plain) findings.push({ file, line, ...hit });
    const decoded = decodeEscapes(content);
    if (decoded === content) return;
    const seen = new Set(plain.map((hit) => `${hit.kind}\0${hit.match}`));
    for (const hit of scanLine(decoded, skipEmail)) {
      const key = `${hit.kind}\0${hit.match}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ file, line, kind: hit.kind, match: hit.match + ESCAPES_NOTE });
    }
  });
  return findings;
}

/** True for files that look binary (a NUL byte near the start); those aren't scanned. */
export function looksBinary(data: Uint8Array): boolean {
  return data.subarray(0, 8000).includes(0);
}
