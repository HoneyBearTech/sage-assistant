import { stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import type { AppEntry } from "./settings.js";

/** Starts a program with an argument list. In the app: child_process.spawn with shell: false. */
export type Launcher = (command: string, args: readonly string[]) => Promise<void>;

/** Finds an app on the user's list by name (ignoring case). Nothing else can ever be opened. */
export function findApp(apps: readonly AppEntry[], name: string): AppEntry | undefined {
  const wanted = name.trim().toLowerCase();
  return apps.find((app) => app.name.trim().toLowerCase() === wanted);
}

/**
 * Checks an app entry can be launched safely: a full path to a program that exists. On Windows
 * only .exe files, because batch and script files would run through a command interpreter.
 */
export async function checkAppEntry(
  app: AppEntry,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  if (!isAbsolute(app.path)) return `The app "${app.name}" needs a full path in Settings.`;
  if (platform === "win32" && extname(app.path).toLowerCase() !== ".exe") {
    return `The app "${app.name}" must point to an .exe file.`;
  }
  try {
    const info = await stat(app.path);
    if (!info.isFile()) return `The path for "${app.name}" isn't a program file.`;
  } catch {
    return `The program for "${app.name}" wasn't found at ${app.path}.`;
  }
  return null;
}

export function describeLaunch(app: AppEntry): string {
  const args = app.args.length
    ? ` with the arguments ${app.args.map((a) => JSON.stringify(a)).join(" ")}`
    : "";
  return `Open the app "${app.name}" (${app.path}${args}).`;
}
