export * from "./crypto.js";
export * from "./paths.js";
export * from "./types.js";
export * from "./store.js";
export * from "./session.js";
export * from "./redact.js";
export * from "./inject.js";
export * from "./unlock-guard.js";

import { VaultStore } from "./store.js";
import { clearSession, readSession, writeSession, hasValidSession } from "./session.js";
import { defaultDataDir, sessionPath, vaultDbPath } from "./paths.js";
import { clearExpiredInjectFiles } from "./inject.js";
import {
  beforeUnlockAttempt,
  recordUnlockFailure,
  recordUnlockSuccess,
} from "./unlock-guard.js";
import { VaultError } from "./types.js";

export type OpenVaultOptions = {
  dataDir?: string;
  /** If true, load unlock session from disk */
  useSession?: boolean;
};

/** Open vault DB; optionally restore unlock from session file. */
export function openVault(opts: OpenVaultOptions = {}): VaultStore {
  const dataDir = opts.dataDir ?? defaultDataDir();
  const store = new VaultStore(vaultDbPath(dataDir));
  if (opts.useSession !== false && hasValidSession(sessionPath(dataDir))) {
    try {
      const session = readSession(sessionPath(dataDir));
      store.unlockWithKey(session.vaultKey);
      session.vaultKey.fill(0);
    } catch {
      // leave locked
    }
  }
  return store;
}

export async function unlockVaultToSession(
  passphrase: string,
  opts: { dataDir?: string; ttlMs?: number } = {},
): Promise<{ expiresAt: string }> {
  const dataDir = opts.dataDir ?? defaultDataDir();
  await beforeUnlockAttempt(dataDir);
  clearExpiredInjectFiles(dataDir);
  const store = new VaultStore(vaultDbPath(dataDir));
  try {
    const vaultKey = await store.unlock(passphrase);
    writeSession(sessionPath(dataDir), vaultKey, dataDir, opts.ttlMs);
    const session = readSession(sessionPath(dataDir));
    vaultKey.fill(0);
    session.vaultKey.fill(0);
    recordUnlockSuccess(dataDir);
    return { expiresAt: session.expiresAt };
  } catch (err) {
    if (err instanceof VaultError && err.code === "WRONG_PASSPHRASE") {
      recordUnlockFailure(dataDir);
    }
    throw err;
  } finally {
    store.close();
  }
}

export async function changeVaultPassphrase(
  currentPassphrase: string,
  nextPassphrase: string,
  opts: { dataDir?: string; ttlMs?: number } = {},
): Promise<{ expiresAt: string }> {
  const dataDir = opts.dataDir ?? defaultDataDir();
  await beforeUnlockAttempt(dataDir);
  const store = new VaultStore(vaultDbPath(dataDir));
  try {
    const vaultKey = await store.changePassphrase(currentPassphrase, nextPassphrase);
    writeSession(sessionPath(dataDir), vaultKey, dataDir, opts.ttlMs);
    const session = readSession(sessionPath(dataDir));
    vaultKey.fill(0);
    session.vaultKey.fill(0);
    recordUnlockSuccess(dataDir);
    return { expiresAt: session.expiresAt };
  } catch (err) {
    if (err instanceof VaultError && err.code === "WRONG_PASSPHRASE") {
      recordUnlockFailure(dataDir);
    }
    throw err;
  } finally {
    store.close();
  }
}

export function lockVaultSession(opts: { dataDir?: string } = {}): void {
  const dataDir = opts.dataDir ?? defaultDataDir();
  clearSession(sessionPath(dataDir));
  clearExpiredInjectFiles(dataDir);
}
