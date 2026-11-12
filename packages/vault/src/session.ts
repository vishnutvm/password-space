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

/** Default unlock window when callers omit TTL (scripts / MCP). */
export const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

/** One calendar day in ms. */
export const SESSION_TTL_1_DAY_MS = 24 * 60 * 60 * 1000;

/** One calendar week in ms. */
export const SESSION_TTL_1_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `null` = stay unlocked until explicit CLI/MCP lock (no auto-expiry).
 * Timed values are milliseconds from write time.
 */
export type SessionTtlMs = number | null;

/**
 * Session file holds the vault key wrapped with a random file key.
 * The file key is stored in the same file (local-only MVP trust: OS file perms 0600).
 * This is equivalent to an unlocked password-manager session on disk — lock when done.
 *
 * Path (default vault home): `~/.password-space/session`
 */
type SessionFile = {
  version: 1;
  /** ISO expiry, or `null` when unlocked until explicit lock. */
  expiresAt: string | null;
  dataDir: string;
  /** base64 random key that wraps the vault key */
  fileKey: string;
  wrappedVaultKey: string;
};

export type SessionInfo = {
  vaultKey: Buffer;
  dataDir: string;
  /** ISO string, or `null` when until-lock. */
  expiresAt: string | null;
  untilLock: boolean;
};

export function writeSession(
  sessionFilePath: string,
  vaultKey: Buffer,
  dataDir: string,
  ttlMs: SessionTtlMs = DEFAULT_TTL_MS,
): void {
  mkdirSync(dirname(sessionFilePath), { recursive: true });
  const fileKey = randomKey();
  const wrapped = encrypt(vaultKey, fileKey);
  const untilLock = ttlMs === null;
  const payload: SessionFile = {
    version: 1,
    expiresAt: untilLock ? null : new Date(Date.now() + ttlMs).toISOString(),
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

export function readSession(sessionFilePath: string): SessionInfo {
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
  const untilLock = payload.expiresAt === null || payload.expiresAt === undefined;
  if (!untilLock) {
    const exp = new Date(payload.expiresAt!).getTime();
    if (!Number.isFinite(exp) || exp < Date.now()) {
      clearSession(sessionFilePath);
      throw new VaultError("Unlock session expired. Call vault_unlock (or CLI: password-space unlock)", "LOCKED");
    }
  }
  const fileKey = Buffer.from(payload.fileKey, "base64");
  if (fileKey.length !== KEY_LEN) {
    throw new VaultError("Corrupt session key", "INVALID");
  }
  try {
    const vaultKey = decrypt(unpackBlob(Buffer.from(payload.wrappedVaultKey, "base64")), fileKey);
    return {
      vaultKey,
      dataDir: payload.dataDir,
      expiresAt: untilLock ? null : payload.expiresAt!,
      untilLock,
    };
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

/** Human-readable unlock window for CLI / status. */
export function formatSessionExpiry(expiresAt: string | null): string {
  if (expiresAt === null) return "until you run lock (no auto-expiry)";
  return expiresAt;
}

/**
 * Parse CLI / flag TTL input.
 * Accepts: hours number, `1d`/`day`, `1w`/`week`, `until-lock`/`never`/`lock`.
 */
export function parseSessionTtlInput(raw: string | number | boolean | undefined): SessionTtlMs {
  if (raw === undefined || raw === true || raw === false) return DEFAULT_TTL_MS;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new VaultError("TTL must be a positive number of hours, or until-lock", "INVALID");
    }
    return raw * 60 * 60 * 1000;
  }
  const s = String(raw).trim().toLowerCase();
  if (!s) return DEFAULT_TTL_MS;
  if (s === "until-lock" || s === "until_lock" || s === "never" || s === "lock" || s === "none") {
    return null;
  }
  if (s === "1d" || s === "day" || s === "1day" || s === "24h") {
    return SESSION_TTL_1_DAY_MS;
  }
  if (s === "1w" || s === "week" || s === "1week" || s === "7d") {
    return SESSION_TTL_1_WEEK_MS;
  }
  const hours = Number(s);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new VaultError(
      "Invalid --ttl (use hours, 1d, 1w, or until-lock)",
      "INVALID",
    );
  }
  return hours * 60 * 60 * 1000;
}
