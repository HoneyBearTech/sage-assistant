import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

/**
 * File types that run code when "opened". open_file refuses them even inside an approved
 * folder: opening a document should never start a program.
 */
export const BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".com",
  ".bat",
  ".cmd",
  ".msi",
  ".msix",
  ".msp",
  ".scr",
  ".pif",
  ".cpl",
  ".lnk",
  ".url",
  ".ps1",
  ".psm1",
  ".vbs",
  ".vbe",
  ".js",
  ".jse",
  ".wsf",
  ".wsh",
  ".hta",
  ".jar",
  ".reg",
  ".appx",
  ".appimage",
  ".sh",
  ".run",
  ".desktop",
  ".deb",
  ".rpm",
  ".app",
  ".scf",
  ".inf",
  ".application",
]);

export type FileCheck = { ok: true; path: string } | { ok: false; message: string };

/** True when `child` is `folder` itself or somewhere inside it. Both must be real paths. */
export function isInside(folder: string, child: string): boolean {
  const rel = relative(folder, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Resolves a requested path (following every symlink and "..") and accepts it only if the real
 * file is inside one of the approved folders (also resolved). Returns the real path to open.
 */
export async function resolveApprovedFile(requested: string, folders: readonly string[]): Promise<FileCheck> {
  if (requested.includes("\0")) return { ok: false, message: "That isn't a valid file path." };
  if (!isAbsolute(requested)) {
    return { ok: false, message: "Give the file's full path, inside one of the approved folders." };
  }
  let real: string;
  try {
    real = await realpath(resolve(requested));
  } catch {
    return { ok: false, message: `There's no file at ${requested}.` };
  }
  const info = await stat(real);
  if (!info.isFile()) return { ok: false, message: `${requested} isn't a file.` };
  if (BLOCKED_EXTENSIONS.has(extname(real).toLowerCase())) {
    return { ok: false, message: "Sage doesn't open programs or scripts, only documents and media." };
  }
  for (const folder of folders) {
    let realFolder: string;
    try {
      realFolder = await realpath(resolve(folder));
    } catch {
      continue;
    }
    if (isInside(realFolder, real)) return { ok: true, path: real };
  }
  return {
    ok: false,
    message: "That file isn't in one of the folders approved in Settings, so Sage can't open it.",
  };
}
