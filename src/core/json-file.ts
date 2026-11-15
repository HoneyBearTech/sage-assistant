import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { z } from "zod";

/**
 * Writes `data` to `path` so that a crash or power cut leaves either the old file or the new one,
 * never half of each: write a temporary file in the same folder, flush it to disk, then rename it
 * over the target.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  const handle = await open(temp, "w", 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await renameWithRetry(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

// On Windows a rename can fail for a moment while another program (an antivirus scanner, the
// search indexer) has the target open.
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 4 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export type ReadJsonResult<T> =
  | { status: "ok"; value: T }
  | { status: "missing" }
  | { status: "invalid"; movedTo: string };

/**
 * Reads and validates a JSON file. A missing file is normal (first run). A file that isn't valid
 * JSON or doesn't match the schema is moved aside, not deleted, so nothing is lost.
 */
export async function readJson<T>(
  path: string,
  schema: z.ZodType<T>,
  now: () => Date = () => new Date(),
): Promise<ReadJsonResult<T>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const result = schema.safeParse(parsed);
  if (result.success) return { status: "ok", value: result.data };
  const movedTo = `${path}.invalid-${now().toISOString().replace(/[:.]/g, "-")}`;
  await rename(path, movedTo);
  return { status: "invalid", movedTo };
}
