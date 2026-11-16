import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Company, OnlineBrainChoice } from "../shared/api.js";
import { requestOrigin, SERVICES } from "./brain/services.js";
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

/** Where one online brain's key is kept. The app uses an encrypted file each; tests use a fake. */
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

/** One key per online brain: each company's, and another online service's. */
export type KeySlot = OnlineBrainChoice;
export type KeyStores = Readonly<Record<KeySlot, KeyStore>>;

/**
 * Where each key is kept in Sage's folder. "other" keeps the file from before there was a list of
 * brains, so the key saved by Sage 0.1.1 still works.
 */
export const KEY_FILES: Readonly<Record<KeySlot, string>> = {
  other: "online-key.bin",
  claude: "claude-key.bin",
  openai: "openai-key.bin",
  gemini: "gemini-key.bin",
};

export function encryptedKeyStores(dataDir: string, encryptor: Encryptor): KeyStores {
  const store = (slot: KeySlot) => new EncryptedFileKeyStore(join(dataDir, KEY_FILES[slot]), encryptor);
  return { other: store("other"), claude: store("claude"), openai: store("openai"), gemini: store("gemini") };
}

/** The origin a company's key is bound to: fixed, never taken from settings or the window. */
export function companyOrigin(slot: KeySlot): string | null {
  return slot === "other" ? null : SERVICES[slot].origin;
}

/**
 * The keys as the rest of Sage uses them. Each key belongs to one service, and is handed out only
 * for a request to that service: a company's key only for its own fixed address, another online
 * service's key only for the address it was entered for. Keys are kept apart, so switching brains
 * never mixes them, and removing one leaves the others. Key operations run one at a time, so a read
 * can't land between two writes.
 */
export class ServiceKeys {
  private readonly serial = new Serial();

  constructor(
    private readonly stores: KeyStores,
    /** Told about every key Sage handles, so the log redactor can remove it. */
    private readonly seen: (key: string) => void = () => {},
  ) {}

  has(slot: KeySlot): Promise<boolean> {
    return this.serial.run(() => this.stores[slot].has());
  }

  /** Whether each online brain has a key saved: all the window may learn about keys. */
  hasKeys(): Promise<Record<KeySlot, boolean>> {
    return this.serial.run(async () => ({
      claude: await this.stores.claude.has(),
      openai: await this.stores.openai.has(),
      gemini: await this.stores.gemini.has(),
      other: await this.stores.other.has(),
    }));
  }

  /** Saves a company's key, bound to that company's fixed address. */
  async setCompanyKey(company: Company, key: string): Promise<void> {
    const clean = validateKey(key);
    this.seen(clean);
    await this.serial.run(() => this.stores[company].set(clean, SERVICES[company].origin));
  }

  /** Saves another online service's key for the service at `origin` (null when no address is saved yet). */
  async setOtherKey(key: string, origin: string | null): Promise<void> {
    const clean = validateKey(key);
    this.seen(clean);
    await this.serial.run(() => this.stores.other.set(clean, origin));
  }

  /** Removes one brain's key; the others stay. */
  clear(slot: KeySlot): Promise<void> {
    return this.serial.run(() => this.stores[slot].clear());
  }

  /**
   * The key for a request about to be sent to `url`, or null. Checked at the point of the request:
   * the address must be https (or http to this computer), a company's key goes only to that
   * company's fixed origin, and any key only to the origin it was saved for.
   */
  keyForRequest(slot: KeySlot, url: string): Promise<string | null> {
    return this.serial.run(async () => {
      const origin = requestOrigin(url);
      if (!origin) return null;
      const fixed = companyOrigin(slot);
      if (fixed !== null && origin !== fixed) return null;
      const saved = await this.stores[slot].get();
      if (!saved) return null;
      this.seen(saved.key);
      return saved.origin === origin ? saved.key : null;
    });
  }

  /**
   * Called after another online service's address is saved, with the new address's origin. A key
   * saved before any address belongs to the first one saved; a key for another service is removed,
   * so it can never be sent to the new one. The companies' keys aren't touched.
   */
  afterAddressSaved(origin: string | null): Promise<KeyAfterSave> {
    const store = this.stores.other;
    return this.serial.run(async () => {
      const saved = await store.get();
      if (!saved) return "none";
      this.seen(saved.key);
      if (saved.origin === origin) return "kept";
      if (saved.origin === null) {
        if (origin === null) return "kept";
        await store.set(saved.key, origin);
        return "bound";
      }
      await store.clear();
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
  // Keys are plain letters, digits and ordinary symbols (all three companies' are); anything else
  // was pasted by mistake, and couldn't be sent in a request header anyway.
  if (!/^[\x21-\x7e]+$/.test(trimmed)) {
    throw new KeyStoreError(
      "That doesn't look like a key: it can only contain letters, digits and ordinary symbols such as - and _.",
    );
  }
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
