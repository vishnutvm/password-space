import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  encrypt,
  decrypt,
  packBlob,
  unpackBlob,
  randomKey,
  KEY_LEN,
} from "./crypto.js";
import { VaultError } from "./types.js";

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

/**
 * Session file holds the vault key wrapped with a random file key.
 * The file key is stored in the same file (local-only MVP trust: OS file perms 0600).
 * This is equivalent to an unlocked password-manager session on disk — lock when done.
 */
type SessionFile = {
  version: 1;
  expiresAt: string;
  dataDir: string;
  /** base64 random key that wraps the vault key */
  fileKey: string;
  wrappedVaultKey: string;
};

export function writeSession(
  sessionFilePath: string,
  vaultKey: Buffer,
  dataDir: string,
  ttlMs = DEFAULT_TTL_MS,
): void {
  mkdirSync(dirname(sessionFilePath), { recursive: true });
  const fileKey = randomKey();
  const wrapped = encrypt(vaultKey, fileKey);
  const payload: SessionFile = {
    version: 1,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    dataDir,
    fileKey: fileKey.toString("base64"),
    wrappedVaultKey: packBlob(wrapped).toString("base64"),
  };
  writeFileSync(sessionFilePath, JSON.stringify(payload), { mode: 0o600 });
  try {
    chmodSync(sessionFilePath, 0o600);
  } catch {
    // best-effort on platforms without chmod
  }
  fileKey.fill(0);
}

export function readSession(sessionFilePath: string): { vaultKey: Buffer; dataDir: string; expiresAt: string } {
  if (!existsSync(sessionFilePath)) {
    throw new VaultError("No unlock session. Call vault_unlock (or CLI: password-space unlock)", "LOCKED");
  }
  const raw = readFileSync(sessionFilePath, "utf8");
  let payload: SessionFile;
  try {
    payload = JSON.parse(raw) as SessionFile;
  } catch {
    throw new VaultError("Corrupt session file", "INVALID");
  }
  if (payload.version !== 1) {
    throw new VaultError("Unsupported session version", "INVALID");
  }
  if (new Date(payload.expiresAt).getTime() < Date.now()) {
    clearSession(sessionFilePath);
    throw new VaultError("Unlock session expired. Call vault_unlock (or CLI: password-space unlock)", "LOCKED");
  }
  const fileKey = Buffer.from(payload.fileKey, "base64");
  if (fileKey.length !== KEY_LEN) {
    throw new VaultError("Corrupt session key", "INVALID");
  }
  try {
    const vaultKey = decrypt(unpackBlob(Buffer.from(payload.wrappedVaultKey, "base64")), fileKey);
    return { vaultKey, dataDir: payload.dataDir, expiresAt: payload.expiresAt };
  } finally {
    fileKey.fill(0);
  }
}

export function clearSession(sessionFilePath: string): void {
  if (existsSync(sessionFilePath)) {
    unlinkSync(sessionFilePath);
  }
}

export function hasValidSession(sessionFilePath: string): boolean {
  try {
    const s = readSession(sessionFilePath);
    s.vaultKey.fill(0);
    return true;
  } catch {
    return false;
  }
}
