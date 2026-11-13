export * from "./crypto.js";
export * from "./paths.js";
export * from "./types.js";
export * from "./store.js";
export * from "./session.js";
export * from "./redact.js";
export * from "./inject.js";
export * from "./unlock-guard.js";

import { VaultStore } from "./store.js";
import { clearSession, type SessionTtlMs } from "./session.js";
import {
  defaultDataDir,
  secretsStorePath,
  sessionPath,
  vaultDbPath,
} from "./paths.js";
import { clearExpiredInjectFiles } from "./inject.js";
import { VaultError } from "./types.js";

export type OpenVaultOptions = {
  dataDir?: string;
  /** Ignored for plain store (kept for call-site compatibility). */
  useSession?: boolean;
};

/** Open the plain-text secret store under the data directory. */
export function openVault(opts: OpenVaultOptions = {}): VaultStore {
  const dataDir = opts.dataDir ?? defaultDataDir();
  return new VaultStore(secretsStorePath(dataDir));
}

/**
 * Soft-compat: plain store needs no unlock session.
 * Ensures the store exists and clears any leftover legacy session file.
 */
export async function unlockVaultToSession(
  _passphrase: string,
  opts: { dataDir?: string; ttlMs?: SessionTtlMs } = {},
): Promise<{ expiresAt: string | null; untilLock: boolean }> {
  const dataDir = opts.dataDir ?? defaultDataDir();
  clearExpiredInjectFiles(dataDir);
  const store = new VaultStore(secretsStorePath(dataDir));
  try {
    if (!store.isInitialized()) {
      throw new VaultError(
        "Store not initialized. Run: password-space setup",
        "NOT_INITIALIZED",
      );
    }
    await store.unlock();
    clearSession(sessionPath(dataDir));
    return { expiresAt: null, untilLock: true };
  } finally {
    store.close();
  }
}

/** Soft-compat: passphrase change is not used for plain text. */
export async function changeVaultPassphrase(
  _currentPassphrase: string,
  _nextPassphrase: string,
  opts: { dataDir?: string; ttlMs?: SessionTtlMs } = {},
): Promise<{ expiresAt: string | null; untilLock: boolean }> {
  const dataDir = opts.dataDir ?? defaultDataDir();
  const store = new VaultStore(secretsStorePath(dataDir));
  try {
    await store.changePassphrase("", "");
    return { expiresAt: null, untilLock: true };
  } finally {
    store.close();
  }
}

/** Soft-compat: clears leftover session / inject files; store stays readable. */
export function lockVaultSession(opts: { dataDir?: string } = {}): void {
  const dataDir = opts.dataDir ?? defaultDataDir();
  clearSession(sessionPath(dataDir));
  clearExpiredInjectFiles(dataDir);
}

/** @deprecated Use secretsStorePath — alias for status fields. */
export function storeFilePath(dataDir: string): string {
  return secretsStorePath(dataDir);
}

export { vaultDbPath };
