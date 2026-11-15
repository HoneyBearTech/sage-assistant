import { readFile, rm } from "node:fs/promises";
import { writeFileAtomic } from "./json-file.js";

/** Where the online service key is kept. The app uses an encrypted file; tests use a fake. */
export interface KeyStore {
  has(): Promise<boolean>;
  get(): Promise<string | null>;
  set(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** Encrypts with the operating system's protection (Electron safeStorage in the app). */
export interface Encryptor {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export class KeyStoreError extends Error {}

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

  async get(): Promise<string | null> {
    let data: Buffer;
    try {
      data = await readFile(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!this.encryptor.isAvailable()) return null;
    try {
      return this.encryptor.decrypt(data);
    } catch {
      // Encrypted under another user or machine: treat as no key, so the user can add it again.
      return null;
    }
  }

  async set(key: string): Promise<void> {
    const clean = validateKey(key);
    if (!this.encryptor.isAvailable()) {
      throw new KeyStoreError(
        "This computer has no system key protection available, so Sage won't store the key. On Linux, unlock your keyring (for example GNOME Keyring or KWallet) and try again.",
      );
    }
    await writeFileAtomic(this.path, this.encryptor.encrypt(clean));
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
