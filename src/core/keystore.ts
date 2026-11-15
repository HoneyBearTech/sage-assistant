import { readFile, rm } from "node:fs/promises";
import { z } from "zod";
import { writeFileAtomic } from "./json-file.js";
import { Serial } from "./serial.js";

/**
 * A saved key and the online service it belongs to: the origin (scheme, host and port) of the
 * address it was entered for, or null when no address was saved yet. Sage sends a key only to the
 * service it belongs to.
 */
export interface SavedKey {
  key: string;
  origin: string | null;
}

/** Where the online service key is kept. The app uses an encrypted file; tests use a fake. */
export interface KeyStore {
  has(): Promise<boolean>;
  get(): Promise<SavedKey | null>;
  set(key: string, origin: string | null): Promise<void>;
  clear(): Promise<void>;
}

const savedKeyFile = z.strictObject({
  version: z.literal(1),
  key: z.string().min(1),
  origin: z.string().min(1).nullable(),
});

/** What is encrypted: the key and its service together, so they can never get out of step. */
export function encodeSavedKey(saved: SavedKey): string {
  return JSON.stringify({ version: 1, key: saved.key, origin: saved.origin });
}

/** Reads what encodeSavedKey wrote. Anything else is not a usable key. */
export function decodeSavedKey(text: string): SavedKey | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = savedKeyFile.safeParse(parsed);
  return result.success ? { key: result.data.key, origin: result.data.origin } : null;
}

/** Encrypts with the operating system's protection (Electron safeStorage in the app). */
export interface Encryptor {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export class KeyStoreError extends Error {}

/** What happened to the saved key when the online address was saved. */
export type KeyAfterSave = "none" | "kept" | "bound" | "removed";

/**
 * The key as the rest of Sage uses it. Each key belongs to one service, and is handed out only for
 * that service; key operations run one at a time, so a read can't land between two writes.
 */
export class ServiceKeys {
  private readonly serial = new Serial();

  constructor(
    private readonly store: KeyStore,
    /** Told about every key Sage handles, so the log redactor can remove it. */
    private readonly seen: (key: string) => void = () => {},
  ) {}

  has(): Promise<boolean> {
    return this.serial.run(() => this.store.has());
  }

  /** Saves a key for the service at `origin` (null when no address is saved yet). */
  async set(key: string, origin: string | null): Promise<void> {
    const clean = validateKey(key);
    this.seen(clean);
    await this.serial.run(() => this.store.set(clean, origin));
  }

  clear(): Promise<void> {
    return this.serial.run(() => this.store.clear());
  }

  /** The key, but only if it belongs to the service at `origin`; otherwise null. */
  keyFor(origin: string): Promise<string | null> {
    return this.serial.run(async () => {
      const saved = await this.store.get();
      if (!saved) return null;
      this.seen(saved.key);
      return saved.origin === origin ? saved.key : null;
    });
  }

  /**
   * Called after the online address is saved, with the new address's origin. A key saved before
   * any address belongs to the first one saved; a key for another service is removed, so it can
   * never be sent to the new one.
   */
  afterAddressSaved(origin: string | null): Promise<KeyAfterSave> {
    return this.serial.run(async () => {
      const saved = await this.store.get();
      if (!saved) return "none";
      this.seen(saved.key);
      if (saved.origin === origin) return "kept";
      if (saved.origin === null) {
        if (origin === null) return "kept";
        await this.store.set(saved.key, origin);
        return "bound";
      }
      await this.store.clear();
      return "removed";
    });
  }
}

/** Checks a key before it is stored: one line, no spaces, a sensible length. */
export function validateKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length < 8 || trimmed.length > 500) {
    throw new KeyStoreError("That doesn't look like a key: it should be 8 to 500 characters.");
  }
  if (/\s/.test(trimmed)) throw new KeyStoreError("A key can't contain spaces or line breaks.");
  return trimmed;
}

/**
 * Electron's safeStorage on Linux falls back to a fixed, well-known password when no keyring is
 * running ("basic_text"). That isn't protection, so Sage refuses to store the key then.
 */
export function osEncryptionUsable(platform: string, available: boolean, backend: string): boolean {
  if (!available) return false;
  if (platform === "linux" && (backend === "basic_text" || backend === "unknown")) return false;
  return true;
}

export class EncryptedFileKeyStore implements KeyStore {
  constructor(
    private readonly path: string,
    private readonly encryptor: Encryptor,
  ) {}

  async has(): Promise<boolean> {
    return (await this.get()) !== null;
  }

  async get(): Promise<SavedKey | null> {
    let data: Buffer;
    try {
      data = await readFile(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!this.encryptor.isAvailable()) return null;
    try {
      // A file from before keys were tied to a service doesn't decode, and counts as no key.
      return decodeSavedKey(this.encryptor.decrypt(data));
    } catch {
      // Encrypted under another user or machine: treat as no key, so the user can add it again.
      return null;
    }
  }

  async set(key: string, origin: string | null): Promise<void> {
    const clean = validateKey(key);
    if (!this.encryptor.isAvailable()) {
      throw new KeyStoreError(
        "This computer has no system key protection available, so Sage won't store the key. On Linux, unlock your keyring (for example GNOME Keyring or KWallet) and try again.",
      );
    }
    await writeFileAtomic(this.path, this.encryptor.encrypt(encodeSavedKey({ key: clean, origin })));
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
