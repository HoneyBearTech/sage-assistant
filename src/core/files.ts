import { realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";

/**
 * The only file types open_file will open: documents, pictures, sound and video. Anything else,
 * including programs, scripts, shortcuts, installers and files with no extension, is refused even
 * inside an approved folder: opening a document should never start a program.
 */
export const ALLOWED_EXTENSIONS = new Set([
  // Text and documents
  ".txt",
  ".md",
  ".pdf",
  ".rtf",
  ".csv",
  ".docx",
  ".xlsx",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  // Pictures
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  // Sound
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
  ".m4a",
  ".aac",
  ".opus",
  // Video
  ".mp4",
  ".m4v",
  ".mkv",
  ".webm",
  ".mov",
  ".avi",
]);

export type FileCheck = { ok: true; path: string } | { ok: false; message: string };

/** True when `child` is `folder` itself or somewhere inside it. Both must be real paths. */
export function isInside(folder: string, child: string): boolean {
  const rel = relative(folder, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * True for a file name Sage will open: an allowed extension, and not ending in a dot or a space
 * (Windows ignores those, so "report.txt." or "x.exe " could open as something else).
 */
export function isAllowedFileName(name: string): boolean {
  if (/[. ]$/.test(name)) return false;
  return ALLOWED_EXTENSIONS.has(extname(name).toLowerCase());
}

/**
 * On Windows a ":" after the drive letter names an alternate data stream ("report.exe:notes.txt"
 * is a hidden part of report.exe, not a text file), so any path with one is refused there.
 */
export function hasStreamName(path: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32") return false;
  return path.replace(/^[A-Za-z]:/, "").includes(":");
}

const NOT_A_DOCUMENT =
  "Sage only opens documents, pictures, sound and video (for example .pdf, .docx, .txt, .jpg, .mp3, .mp4), never programs, scripts or shortcuts.";

/**
 * Resolves a requested path (following every symlink and "..") and accepts it only if the real
 * file is inside one of the approved folders (also resolved) and is an allowed type. Returns the
 * real path to open.
 */
export async function resolveApprovedFile(
  requested: string,
  folders: readonly string[],
  platform: NodeJS.Platform = process.platform,
): Promise<FileCheck> {
  if (requested.includes("\0")) return { ok: false, message: "That isn't a valid file path." };
  if (hasStreamName(requested, platform)) {
    return { ok: false, message: 'Sage doesn\'t open file names with ":" in them.' };
  }
  if (!isAbsolute(requested)) {
    return { ok: false, message: "Give the file's full path, inside one of the approved folders." };
  }
  // Both the name asked for and the real file it leads to must be allowed types.
  if (!isAllowedFileName(basename(requested))) return { ok: false, message: NOT_A_DOCUMENT };
  let real: string;
  try {
    real = await realpath(resolve(requested));
  } catch {
    return { ok: false, message: `There's no file at ${requested}.` };
  }
  const info = await stat(real);
  if (!info.isFile()) return { ok: false, message: `${requested} isn't a file.` };
  if (!isAllowedFileName(basename(real))) return { ok: false, message: NOT_A_DOCUMENT };
  if (hasStreamName(real, platform)) {
    return { ok: false, message: 'Sage doesn\'t open file names with ":" in them.' };
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
