#!/usr/bin/env node

// packages/cli/src/index.ts
import { createInterface } from "node:readline";
import { stdin as input, stdout as output, exit } from "node:process";

// packages/vault/dist/crypto.js
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
var CRYPTO_VERSION = 1;
var SCRYPT_N = 2 ** 15;
var SCRYPT_R = 8;
var SCRYPT_P = 1;
var KEY_LEN = 32;
var SALT_LEN = 32;
var IV_LEN = 12;
var TAG_LEN = 16;
async function deriveKey(passphrase, salt, opts) {
  const N = opts?.N ?? SCRYPT_N;
  const r = opts?.r ?? SCRYPT_R;
  const p = opts?.p ?? SCRYPT_P;
  return new Promise((resolve, reject) => {
    scryptCb(passphrase, salt, KEY_LEN, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err)
        reject(err);
      else
        resolve(key);
    });
  });
}
function encrypt(plaintext, key) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag };
}
function decrypt(blob, key) {
  const decipher = createDecipheriv("aes-256-gcm", key, blob.iv);
  decipher.setAuthTag(blob.tag);
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
}
function encryptString(plaintext, key) {
  return encrypt(Buffer.from(plaintext, "utf8"), key);
}
function decryptString(blob, key) {
  return decrypt(blob, key).toString("utf8");
}
function randomKey() {
  return randomBytes(KEY_LEN);
}
function randomSalt() {
  return randomBytes(SALT_LEN);
}
function packBlob(blob) {
  return Buffer.concat([blob.iv, blob.tag, blob.ciphertext]);
}
function unpackBlob(packed) {
  if (packed.length < IV_LEN + TAG_LEN) {
    throw new Error("Invalid encrypted blob: too short");
  }
  return {
    iv: packed.subarray(0, IV_LEN),
    tag: packed.subarray(IV_LEN, IV_LEN + TAG_LEN),
    ciphertext: packed.subarray(IV_LEN + TAG_LEN)
  };
}

// packages/vault/dist/paths.js
import { homedir } from "node:os";
import { join } from "node:path";
var UNRESOLVED_ENV_PLACEHOLDER = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
function resolvePasswordSpaceHome(raw) {
  if (raw == null)
    return void 0;
  const trimmed = raw.trim();
  if (!trimmed)
    return void 0;
  if (trimmed === "${PASSWORD_SPACE_HOME}" || UNRESOLVED_ENV_PLACEHOLDER.test(trimmed)) {
    return void 0;
  }
  return trimmed;
}
function defaultDataDir(env = process.env) {
  const fromEnv = resolvePasswordSpaceHome(env.PASSWORD_SPACE_HOME);
  if (fromEnv)
    return fromEnv;
  return join(homedir(), ".password-space");
}
function vaultDbPath(dataDir) {
  return join(dataDir, "vault.db");
}
function sessionPath(dataDir) {
  return join(dataDir, "session");
}
function injectDir(dataDir) {
  return join(dataDir, "inject");
}

// packages/vault/dist/types.js
var VaultError = class extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "VaultError";
  }
};

// packages/vault/dist/store.js
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
var VaultStore = class {
  db;
  vaultKey = null;
  dbPath;
  constructor(dbPath) {
    this.dbPath = dbPath;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.ensureSchema();
  }
  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        tags_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        ciphertext BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        action TEXT NOT NULL,
        secret_id TEXT,
        secret_name TEXT,
        actor TEXT NOT NULL,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_secrets_name ON secrets(name);
      CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at);
    `);
  }
  close() {
    this.lock();
    this.db.close();
  }
  isInitialized() {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'initialized'").get();
    return row?.value === "1";
  }
  getMeta() {
    if (!this.isInitialized())
      return null;
    const get = (key) => this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value;
    const salt = get("kdf_salt");
    const createdAt = get("created_at");
    if (!salt || !createdAt)
      return null;
    return {
      cryptoVersion: Number(get("crypto_version") ?? CRYPTO_VERSION),
      createdAt,
      kdf: {
        algorithm: "scrypt",
        N: Number(get("kdf_N") ?? SCRYPT_N),
        r: Number(get("kdf_r") ?? SCRYPT_R),
        p: Number(get("kdf_p") ?? SCRYPT_P),
        salt
      }
    };
  }
  async init(passphrase) {
    if (this.isInitialized()) {
      throw new VaultError("Vault already initialized", "ALREADY_INITIALIZED");
    }
    if (!passphrase || passphrase.length < 8) {
      throw new VaultError("Passphrase must be at least 8 characters", "INVALID");
    }
    const salt = randomSalt();
    const masterKey = await deriveKey(passphrase, salt);
    const vaultKey = randomKey();
    const wrapped = encrypt(vaultKey, masterKey);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const insert = this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    this.db.exec("BEGIN");
    try {
      insert.run("initialized", "1");
      insert.run("crypto_version", String(CRYPTO_VERSION));
      insert.run("created_at", now);
      insert.run("kdf_algorithm", "scrypt");
      insert.run("kdf_N", String(SCRYPT_N));
      insert.run("kdf_r", String(SCRYPT_R));
      insert.run("kdf_p", String(SCRYPT_P));
      insert.run("kdf_salt", salt.toString("base64"));
      insert.run("wrapped_vault_key", packBlob(wrapped).toString("base64"));
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    masterKey.fill(0);
    vaultKey.fill(0);
  }
  get isUnlocked() {
    return this.vaultKey !== null;
  }
  async unlock(passphrase) {
    if (!this.isInitialized()) {
      throw new VaultError("Vault not initialized. Run: password-space init", "NOT_INITIALIZED");
    }
    const meta = this.getMeta();
    if (!meta) {
      throw new VaultError("Vault metadata corrupt", "INVALID");
    }
    const salt = Buffer.from(meta.kdf.salt, "base64");
    const wrappedB64 = this.db.prepare("SELECT value FROM meta WHERE key = 'wrapped_vault_key'").get().value;
    const wrapped = unpackBlob(Buffer.from(wrappedB64, "base64"));
    const masterKey = await deriveKey(passphrase, salt, {
      N: meta.kdf.N,
      r: meta.kdf.r,
      p: meta.kdf.p
    });
    try {
      const vaultKey = decrypt(wrapped, masterKey);
      this.vaultKey = vaultKey;
      this.audit("unlock", null, null, "human", null);
      return Buffer.from(vaultKey);
    } catch {
      throw new VaultError("Wrong passphrase", "WRONG_PASSPHRASE");
    } finally {
      masterKey.fill(0);
    }
  }
  /** Restore an already-derived vault key (from session file). */
  unlockWithKey(vaultKey) {
    if (!this.isInitialized()) {
      throw new VaultError("Vault not initialized", "NOT_INITIALIZED");
    }
    this.vaultKey = Buffer.from(vaultKey);
  }
  lock() {
    if (this.vaultKey) {
      this.vaultKey.fill(0);
      this.vaultKey = null;
    }
  }
  /**
   * Re-wrap the vault key under a new passphrase-derived master key.
   * Requires the vault to already be unlocked (or pass currentPassphrase to unlock).
   */
  async changePassphrase(currentPassphrase, nextPassphrase) {
    if (!this.isInitialized()) {
      throw new VaultError("Vault not initialized", "NOT_INITIALIZED");
    }
    if (!nextPassphrase || nextPassphrase.length < 8) {
      throw new VaultError("Passphrase must be at least 8 characters", "INVALID");
    }
    if (currentPassphrase === nextPassphrase) {
      throw new VaultError("New passphrase must differ from the current one", "INVALID");
    }
    const meta = this.getMeta();
    if (!meta)
      throw new VaultError("Vault metadata corrupt", "INVALID");
    const salt = Buffer.from(meta.kdf.salt, "base64");
    const wrappedB64 = this.db.prepare("SELECT value FROM meta WHERE key = 'wrapped_vault_key'").get().value;
    const wrapped = unpackBlob(Buffer.from(wrappedB64, "base64"));
    const currentMaster = await deriveKey(currentPassphrase, salt, {
      N: meta.kdf.N,
      r: meta.kdf.r,
      p: meta.kdf.p
    });
    let vaultKey;
    try {
      vaultKey = decrypt(wrapped, currentMaster);
    } catch {
      throw new VaultError("Wrong passphrase", "WRONG_PASSPHRASE");
    } finally {
      currentMaster.fill(0);
    }
    const newSalt = randomSalt();
    const newMaster = await deriveKey(nextPassphrase, newSalt);
    const newWrapped = encrypt(vaultKey, newMaster);
    newMaster.fill(0);
    const upsert = this.db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    this.db.exec("BEGIN");
    try {
      upsert.run("kdf_salt", newSalt.toString("base64"));
      upsert.run("kdf_N", String(SCRYPT_N));
      upsert.run("kdf_r", String(SCRYPT_R));
      upsert.run("kdf_p", String(SCRYPT_P));
      upsert.run("wrapped_vault_key", packBlob(newWrapped).toString("base64"));
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      vaultKey.fill(0);
      throw err;
    }
    if (this.vaultKey) {
      this.vaultKey.fill(0);
    }
    this.vaultKey = vaultKey;
    this.audit("change_passphrase", null, null, "human", null);
    return Buffer.from(vaultKey);
  }
  requireKey() {
    if (!this.vaultKey) {
      throw new VaultError("Vault is locked. Call vault_unlock (or CLI: password-space unlock)", "LOCKED");
    }
    return this.vaultKey;
  }
  rowToMeta(row) {
    return {
      id: row.id,
      name: row.name,
      tags: JSON.parse(row.tags_json),
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  normalizeRow(row) {
    return {
      ...row,
      ciphertext: Buffer.isBuffer(row.ciphertext) ? row.ciphertext : Buffer.from(row.ciphertext)
    };
  }
  listSecrets(tag) {
    this.requireKey();
    const rows = this.db.prepare("SELECT * FROM secrets ORDER BY name COLLATE NOCASE").all();
    const metas = rows.map((r) => this.rowToMeta(this.normalizeRow(r)));
    if (!tag)
      return metas;
    const needle = tag.toLowerCase();
    return metas.filter((m) => m.tags.some((t) => t.toLowerCase() === needle));
  }
  getMetadata(idOrName) {
    this.requireKey();
    const row = this.findRow(idOrName);
    if (!row)
      throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    return this.rowToMeta(row);
  }
  getSecret(idOrName, actor = "human") {
    const key = this.requireKey();
    const row = this.findRow(idOrName);
    if (!row)
      throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    const value = decryptString(unpackBlob(row.ciphertext), key);
    this.audit("get", row.id, row.name, actor, null);
    return { ...this.rowToMeta(row), value };
  }
  setSecret(input2) {
    const key = this.requireKey();
    const name = input2.name.trim();
    if (!name)
      throw new VaultError("Secret name is required", "INVALID");
    if (input2.value === void 0 || input2.value === null) {
      throw new VaultError("Secret value is required", "INVALID");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const tags = input2.tags ?? [];
    const notes = input2.notes ?? null;
    const packed = packBlob(encryptString(input2.value, key));
    const existing = input2.id ? this.findRow(input2.id) : this.findRow(name);
    if (existing) {
      const conflict = this.db.prepare("SELECT id FROM secrets WHERE name = ? COLLATE NOCASE AND id != ?").get(name, existing.id);
      if (conflict)
        throw new VaultError(`Secret name already exists: ${name}`, "DUPLICATE_NAME");
      this.db.prepare(`UPDATE secrets SET name = ?, tags_json = ?, notes = ?, ciphertext = ?, updated_at = ? WHERE id = ?`).run(name, JSON.stringify(tags), notes, packed, now, existing.id);
      this.audit("update", existing.id, name, "human", null);
      return this.getMetadata(existing.id);
    }
    const dup = this.db.prepare("SELECT id FROM secrets WHERE name = ? COLLATE NOCASE").get(name);
    if (dup)
      throw new VaultError(`Secret name already exists: ${name}`, "DUPLICATE_NAME");
    const id = input2.id ?? randomUUID();
    this.db.prepare(`INSERT INTO secrets (id, name, tags_json, notes, ciphertext, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, name, JSON.stringify(tags), notes, packed, now, now);
    this.audit("create", id, name, "human", null);
    return this.getMetadata(id);
  }
  deleteSecret(idOrName) {
    this.requireKey();
    const row = this.findRow(idOrName);
    if (!row)
      throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    this.db.prepare("DELETE FROM secrets WHERE id = ?").run(row.id);
    this.audit("delete", row.id, row.name, "human", null);
  }
  listAudit(limit = 50) {
    const rows = this.db.prepare(`SELECT id, at, action, secret_id, secret_name, actor, detail FROM audit ORDER BY at DESC LIMIT ?`).all(limit);
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      secretId: r.secret_id,
      secretName: r.secret_name,
      actor: r.actor,
      detail: r.detail
    }));
  }
  findRow(idOrName) {
    const byId = this.db.prepare("SELECT * FROM secrets WHERE id = ?").get(idOrName);
    if (byId)
      return this.normalizeRow(byId);
    const byName = this.db.prepare("SELECT * FROM secrets WHERE name = ? COLLATE NOCASE").get(idOrName);
    return byName ? this.normalizeRow(byName) : void 0;
  }
  audit(action, secretId, secretName, actor, detail) {
    this.db.prepare(`INSERT INTO audit (id, at, action, secret_id, secret_name, actor, detail) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), (/* @__PURE__ */ new Date()).toISOString(), action, secretId, secretName, actor, detail);
  }
  static exists(dbPath) {
    return existsSync(dbPath);
  }
};

// packages/vault/dist/session.js
import { chmodSync, existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname as dirname2 } from "node:path";
var DEFAULT_TTL_MS = 8 * 60 * 60 * 1e3;
var SESSION_TTL_1_DAY_MS = 24 * 60 * 60 * 1e3;
var SESSION_TTL_1_WEEK_MS = 7 * 24 * 60 * 60 * 1e3;
function writeSession(sessionFilePath, vaultKey, dataDir, ttlMs = DEFAULT_TTL_MS) {
  mkdirSync2(dirname2(sessionFilePath), { recursive: true });
  const fileKey = randomKey();
  const wrapped = encrypt(vaultKey, fileKey);
  const untilLock = ttlMs === null;
  const payload = {
    version: 1,
    expiresAt: untilLock ? null : new Date(Date.now() + ttlMs).toISOString(),
    dataDir,
    fileKey: fileKey.toString("base64"),
    wrappedVaultKey: packBlob(wrapped).toString("base64")
  };
  writeFileSync(sessionFilePath, JSON.stringify(payload), { mode: 384 });
  try {
    chmodSync(sessionFilePath, 384);
  } catch {
  }
  fileKey.fill(0);
}
function readSession(sessionFilePath) {
  if (!existsSync2(sessionFilePath)) {
    throw new VaultError("No unlock session. Call vault_unlock (or CLI: password-space unlock)", "LOCKED");
  }
  const raw = readFileSync(sessionFilePath, "utf8");
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new VaultError("Corrupt session file", "INVALID");
  }
  if (payload.version !== 1) {
    throw new VaultError("Unsupported session version", "INVALID");
  }
  const untilLock = payload.expiresAt === null || payload.expiresAt === void 0;
  if (!untilLock) {
    const exp = new Date(payload.expiresAt).getTime();
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
      expiresAt: untilLock ? null : payload.expiresAt,
      untilLock
    };
  } finally {
    fileKey.fill(0);
  }
}
function clearSession(sessionFilePath) {
  if (existsSync2(sessionFilePath)) {
    unlinkSync(sessionFilePath);
  }
}
function hasValidSession(sessionFilePath) {
  try {
    const s = readSession(sessionFilePath);
    s.vaultKey.fill(0);
    return true;
  } catch {
    return false;
  }
}
function formatSessionExpiry(expiresAt) {
  if (expiresAt === null)
    return "until you run lock (no auto-expiry)";
  return expiresAt;
}
function parseSessionTtlInput(raw) {
  if (raw === void 0 || raw === true || raw === false)
    return DEFAULT_TTL_MS;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new VaultError("TTL must be a positive number of hours, or until-lock", "INVALID");
    }
    return raw * 60 * 60 * 1e3;
  }
  const s = String(raw).trim().toLowerCase();
  if (!s)
    return DEFAULT_TTL_MS;
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
    throw new VaultError("Invalid --ttl (use hours, 1d, 1w, or until-lock)", "INVALID");
  }
  return hours * 60 * 60 * 1e3;
}

// packages/vault/dist/inject.js
import { chmodSync as chmodSync2, mkdirSync as mkdirSync3, writeFileSync as writeFileSync2, unlinkSync as unlinkSync2, existsSync as existsSync3, readdirSync, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
var DEFAULT_INJECT_TTL_MS = 5 * 60 * 1e3;
function clearExpiredInjectFiles(dataDir, now = Date.now()) {
  const dir = injectDir(dataDir);
  if (!existsSync3(dir))
    return 0;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".env"))
      continue;
    const full = join2(dir, name);
    try {
      const body = readFileSync2(full, "utf8");
      const match = /^# password-space inject — expires (.+)$/m.exec(body);
      const expiresMs = match ? Date.parse(match[1]) : NaN;
      if (Number.isFinite(expiresMs) && expiresMs <= now) {
        unlinkSync2(full);
        removed++;
      }
    } catch {
    }
  }
  return removed;
}

// packages/vault/dist/unlock-guard.js
import { existsSync as existsSync4, mkdirSync as mkdirSync4, readFileSync as readFileSync3, unlinkSync as unlinkSync3, writeFileSync as writeFileSync3, chmodSync as chmodSync3 } from "node:fs";
import { dirname as dirname3, join as join3 } from "node:path";
var FILE_NAME = "unlock-attempts.json";
var MAX_DELAY_MS = 3e4;
var BASE_DELAY_MS = 250;
function pathFor(dataDir) {
  return join3(dataDir, FILE_NAME);
}
function readState(dataDir) {
  const p = pathFor(dataDir);
  if (!existsSync4(p)) {
    return { failures: 0, lastFailureAt: null, lockedUntil: null };
  }
  try {
    const raw = JSON.parse(readFileSync3(p, "utf8"));
    return {
      failures: Number(raw.failures) || 0,
      lastFailureAt: raw.lastFailureAt ?? null,
      lockedUntil: raw.lockedUntil ?? null
    };
  } catch {
    return { failures: 0, lastFailureAt: null, lockedUntil: null };
  }
}
function writeState(dataDir, state) {
  mkdirSync4(dirname3(pathFor(dataDir)), { recursive: true });
  const p = pathFor(dataDir);
  writeFileSync3(p, JSON.stringify(state), { mode: 384 });
  try {
    chmodSync3(p, 384);
  } catch {
  }
}
function delayForFailures(failures) {
  if (failures <= 0)
    return 0;
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(failures - 1, 8));
  return exp;
}
async function beforeUnlockAttempt(dataDir) {
  const state = readState(dataDir);
  const now = Date.now();
  if (state.lockedUntil) {
    const until = Date.parse(state.lockedUntil);
    if (Number.isFinite(until) && until > now) {
      const waitMs = until - now;
      await sleep(waitMs);
    }
  }
  const delay = delayForFailures(state.failures);
  if (delay > 0)
    await sleep(delay);
}
function recordUnlockFailure(dataDir) {
  const state = readState(dataDir);
  const failures = state.failures + 1;
  const delay = delayForFailures(failures);
  const lockedUntil = failures >= 5 ? new Date(Date.now() + Math.min(MAX_DELAY_MS * 2, delay * 2)).toISOString() : null;
  writeState(dataDir, {
    failures,
    lastFailureAt: (/* @__PURE__ */ new Date()).toISOString(),
    lockedUntil
  });
}
function recordUnlockSuccess(dataDir) {
  const p = pathFor(dataDir);
  if (existsSync4(p))
    unlinkSync3(p);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// packages/vault/dist/index.js
function openVault(opts = {}) {
  const dataDir = opts.dataDir ?? defaultDataDir();
  const store = new VaultStore(vaultDbPath(dataDir));
  if (opts.useSession !== false && hasValidSession(sessionPath(dataDir))) {
    try {
      const session = readSession(sessionPath(dataDir));
      store.unlockWithKey(session.vaultKey);
      session.vaultKey.fill(0);
    } catch {
    }
  }
  return store;
}
async function unlockVaultToSession(passphrase, opts = {}) {
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
    return { expiresAt: session.expiresAt, untilLock: session.untilLock };
  } catch (err) {
    if (err instanceof VaultError && err.code === "WRONG_PASSPHRASE") {
      recordUnlockFailure(dataDir);
    }
    throw err;
  } finally {
    store.close();
  }
}
async function changeVaultPassphrase(currentPassphrase, nextPassphrase, opts = {}) {
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
    return { expiresAt: session.expiresAt, untilLock: session.untilLock };
  } catch (err) {
    if (err instanceof VaultError && err.code === "WRONG_PASSPHRASE") {
      recordUnlockFailure(dataDir);
    }
    throw err;
  } finally {
    store.close();
  }
}
function lockVaultSession(opts = {}) {
  const dataDir = opts.dataDir ?? defaultDataDir();
  clearSession(sessionPath(dataDir));
  clearExpiredInjectFiles(dataDir);
}

// packages/cli/src/index.ts
function parseArgs(argv) {
  const [, , command = "", ...rest] = argv;
  const positional = [];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (a.startsWith("-") && a.length === 2) {
      const key = a.slice(1);
      const next = rest[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags };
}
function dataDirFrom(flags) {
  const d = flags["data-dir"] ?? flags.d;
  return typeof d === "string" ? d : defaultDataDir();
}
function selfCmd() {
  return process.argv[1] ? `node "${process.argv[1]}"` : "password-space";
}
async function promptVisible(question) {
  if (!input.isTTY) {
    const rl2 = createInterface({ input, output: void 0, terminal: false });
    return new Promise((resolve, reject) => {
      rl2.once("line", (line) => {
        rl2.close();
        resolve(line.trim());
      });
      rl2.once("close", () => reject(new Error("No input on stdin")));
    });
  }
  const rl = createInterface({ input, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
async function promptHidden(question) {
  if (!input.isTTY) {
    const rl = createInterface({ input, output: void 0, terminal: false });
    return new Promise((resolve, reject) => {
      rl.once("line", (line) => {
        rl.close();
        resolve(line);
      });
      rl.once("close", () => reject(new Error("No passphrase on stdin")));
    });
  }
  return new Promise((resolve, reject) => {
    output.write(question);
    const wasRaw = input.isRaw;
    input.setRawMode?.(true);
    let buf = "";
    const onData = (chunk) => {
      const s = chunk.toString("utf8");
      for (const ch of s) {
        if (ch === "\n" || ch === "\r" || ch === "") {
          cleanup();
          output.write("\n");
          resolve(buf);
          return;
        }
        if (ch === "") {
          cleanup();
          output.write("\n");
          reject(new Error("Interrupted"));
          return;
        }
        if (ch === "\x7F" || ch === "\b") {
          buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode?.(wasRaw ?? false);
    };
    input.on("data", onData);
  });
}
function printHelp() {
  console.log(`password-space \u2014 interactive Terminal vault (humans) + MCP for agents

Usage:
  password-space                 Interactive menu (TTY)
  password-space <command> [options]

Commands:
  setup | init           Create vault + unlock (guided)
  unlock                 Unlock with session duration choice
  lock                   Clear unlock session
  status                 Vault / session status
  change-passphrase      Re-wrap under a new passphrase
  set | add [name]       Store or update a secret (hidden value)
  remove | delete | rm   Delete a secret (prompts for name)
  list                   List secret names only (no values)
  menu | interactive     Full interactive menu
  onboard                Print next Terminal step
  get <name>             Print secret value (human only \u2014 not for agents)
  audit                  Recent access events (no values)
  help                   Show this help

Session duration (unlock / setup / change-passphrase):
  Interactive prompt: 1 day \xB7 1 week \xB7 until lock
  --ttl 1d | 1w | until-lock | <hours>

Options:
  --data-dir, -d         Vault data directory (default: ~/.password-space)
  --value <text>         Secret value for set (prefer prompt)
  --tags <a,b,c>         Tags for set
  --notes <text>         Notes for set
  --tag <tag>            Filter list by tag
  --json                 Machine-readable output
  --yes                  Skip confirm prompts where safe

Environment:
  PASSWORD_SPACE_HOME           Same as --data-dir
  PASSWORD_SPACE_PASSPHRASE     Non-interactive unlock/init (CI / scripts)

Session file:  ~/.password-space/session  (mode 0600)
Agents use MCP inject/list while the session is valid \u2014 no passphrase re-prompt.
`);
}
async function getPassphrase(flags, prompt) {
  if (typeof flags.passphrase === "string") return flags.passphrase;
  if (process.env.PASSWORD_SPACE_PASSPHRASE) return process.env.PASSWORD_SPACE_PASSPHRASE;
  return promptHidden(prompt);
}
async function promptNewPassphrase(flags) {
  const pass = await getPassphrase(flags, "Passphrase (8+ characters, hidden): ");
  if (pass.length < 8) {
    throw new VaultError("Passphrase must be at least 8 characters", "INVALID");
  }
  if (process.env.PASSWORD_SPACE_PASSPHRASE || typeof flags.passphrase === "string") {
    return pass;
  }
  const confirm = await getPassphrase({}, "Confirm passphrase (hidden): ");
  if (pass !== confirm) {
    throw new VaultError("Passphrases do not match", "INVALID");
  }
  return pass;
}
async function resolveSessionTtl(flags, opts = {}) {
  if (flags.ttl !== void 0) {
    return parseSessionTtlInput(flags.ttl);
  }
  const ask = opts.askInteractively !== false && input.isTTY && !process.env.PASSWORD_SPACE_PASSPHRASE;
  if (!ask) {
    return parseSessionTtlInput(void 0);
  }
  console.log(`
How long should the vault stay unlocked?
  1) 1 day
  2) 1 week
  3) Until lock  (no auto-expiry \u2014 run lock when done)
`);
  const choice = await promptVisible("Choose [1/2/3] (default 1): ");
  switch (choice || "1") {
    case "1":
    case "d":
    case "day":
    case "1d":
      return parseSessionTtlInput("1d");
    case "2":
    case "w":
    case "week":
    case "1w":
      return parseSessionTtlInput("1w");
    case "3":
    case "u":
    case "until":
    case "until-lock":
    case "lock":
      return null;
    default:
      throw new VaultError("Choose 1 (1 day), 2 (1 week), or 3 (until lock)", "INVALID");
  }
}
function printUnlockResult(expiresAt, dataDir) {
  console.log(`\u2713 Unlocked ${formatSessionExpiry(expiresAt)}`);
  console.log(`  Session: ${sessionPath(dataDir)} (mode 0600)`);
  console.log("  MCP agents can inject/list until expiry or you run lock.");
}
function vaultSnapshot(dataDir) {
  const store = openVault({ dataDir, useSession: true });
  const initialized = store.isInitialized();
  const unlocked = store.isUnlocked;
  const sp = sessionPath(dataDir);
  let session = false;
  let expiresAt = null;
  let untilLock = false;
  if (hasValidSession(sp)) {
    session = true;
    try {
      const s = readSession(sp);
      expiresAt = s.expiresAt;
      untilLock = s.untilLock;
      s.vaultKey.fill(0);
    } catch {
      session = false;
    }
  }
  const secretCount = unlocked ? store.listSecrets().length : null;
  store.close();
  return { initialized, unlocked, session, expiresAt, untilLock, secretCount };
}
async function runSetupWizard(dataDir, flags) {
  console.log(`
Password Space \u2014 setup
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
\u2022 Vault home: ${dataDir}
\u2022 Passphrase stays in Terminal \u2014 never in Cursor chat
\u2022 Unlock session: ~/.password-space/session (0600)
`);
  const probe = openVault({ dataDir, useSession: true });
  const initialized = probe.isInitialized();
  const needsUnlock = !probe.isUnlocked || !hasValidSession(sessionPath(dataDir));
  probe.close();
  let passphrase;
  if (!initialized) {
    passphrase = await promptNewPassphrase(flags);
    const store = openVault({ dataDir, useSession: false });
    await store.init(passphrase);
    store.close();
    console.log(`\u2713 Vault created at ${vaultDbPath(dataDir)}`);
  } else {
    console.log("\u2713 Vault already exists (not overwritten).");
  }
  if (!initialized || needsUnlock) {
    const ttlMs = await resolveSessionTtl(flags);
    const pass = passphrase ?? await getPassphrase(flags, "Unlock passphrase (hidden): ");
    const { expiresAt } = await unlockVaultToSession(pass, { dataDir, ttlMs });
    printUnlockResult(expiresAt, dataDir);
  } else {
    console.log("\u2713 Already unlocked.");
  }
  console.log(`
Next (still in Terminal \u2014 never paste values in Cursor chat):
  ${selfCmd()} set
  # or: ${selfCmd()}   \u2192 interactive menu

Back in Cursor after unlock:
  \u2022 vault_status / list_secrets / inject_secret
`);
}
async function runUnlock(dataDir, flags) {
  const store = openVault({ dataDir, useSession: false });
  const initialized = store.isInitialized();
  store.close();
  if (!initialized) {
    throw new VaultError("Vault not initialized. Run: password-space setup", "NOT_INITIALIZED");
  }
  const ttlMs = await resolveSessionTtl(flags);
  const pass = await getPassphrase(flags, "Unlock passphrase (hidden): ");
  const { expiresAt } = await unlockVaultToSession(pass, { dataDir, ttlMs });
  printUnlockResult(expiresAt, dataDir);
}
async function runLock(dataDir) {
  lockVaultSession({ dataDir });
  console.log("\u2713 Locked. Unlock session cleared.");
  console.log(`  (${sessionPath(dataDir)} removed)`);
}
async function runStatus(dataDir, flags) {
  const snap = vaultSnapshot(dataDir);
  const status = {
    dataDir,
    dbPath: vaultDbPath(dataDir),
    initialized: snap.initialized,
    unlocked: snap.unlocked,
    session: snap.session,
    expires_at: snap.expiresAt,
    until_lock: snap.untilLock,
    secretCount: snap.secretCount,
    session_path: sessionPath(dataDir)
  };
  if (flags.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(`data dir:     ${status.dataDir}`);
  console.log(`db:           ${status.dbPath}`);
  console.log(`initialized:  ${status.initialized}`);
  console.log(`unlocked:     ${status.unlocked}`);
  console.log(`session:      ${status.session}`);
  if (status.session) {
    console.log(`expires:      ${formatSessionExpiry(status.expires_at)}`);
    console.log(`session file: ${status.session_path}`);
  }
  if (status.secretCount !== null) console.log(`secrets:      ${status.secretCount}`);
}
async function runChangePassphrase(dataDir, flags) {
  const current = await getPassphrase(flags, "Current passphrase (hidden): ");
  const next = await promptNewPassphrase({});
  const ttlMs = await resolveSessionTtl(flags);
  const { expiresAt } = await changeVaultPassphrase(current, next, { dataDir, ttlMs });
  console.log("\u2713 Passphrase updated.");
  printUnlockResult(expiresAt, dataDir);
}
async function runSet(dataDir, args) {
  let name = args.positional[0];
  let value = typeof args.flags.value === "string" ? args.flags.value : void 0;
  if (!input.isTTY && value === void 0) {
    const raw = (await readAllStdin()).replace(/\n$/, "");
    if (!name) {
      const nl = raw.indexOf("\n");
      if (nl === -1) {
        throw new VaultError("Provide name as arg and value on stdin", "INVALID");
      }
      name = raw.slice(0, nl).trim();
      value = raw.slice(nl + 1);
    } else {
      value = raw;
    }
  }
  if (!name) {
    name = await promptVisible("Secret name: ");
  }
  if (!name) {
    throw new VaultError("Secret name is required", "INVALID");
  }
  const store = openVault({ dataDir, useSession: true });
  ensureUnlocked(store);
  if (value === void 0) {
    value = await promptHidden(`Value for ${name} (hidden): `);
  }
  if (!value) {
    store.close();
    throw new VaultError("Secret value cannot be empty", "INVALID");
  }
  const tags = typeof args.flags.tags === "string" ? args.flags.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const notes = typeof args.flags.notes === "string" ? args.flags.notes : null;
  const meta = store.setSecret({ name, value, tags, notes });
  store.close();
  if (args.flags.json) {
    console.log(JSON.stringify(meta, null, 2));
  } else {
    console.log(`\u2713 Saved ${meta.name} (id ${meta.id})`);
    console.log("  Value was not printed. In Cursor: list_secrets / inject_secret.");
  }
}
async function runRemove(dataDir, args) {
  const store = openVault({ dataDir, useSession: true });
  ensureUnlocked(store);
  let name = args.positional[0];
  if (!name) {
    const list = store.listSecrets();
    if (list.length === 0) {
      store.close();
      console.log("(no secrets to remove)");
      return;
    }
    console.log("Secrets:");
    for (const s of list) console.log(`  \u2022 ${s.name}`);
    name = await promptVisible("Secret name to remove: ");
  }
  if (!name) {
    store.close();
    throw new VaultError("Secret name is required", "INVALID");
  }
  if (!args.flags.yes && input.isTTY) {
    const confirm = await promptVisible(`Delete "${name}"? [y/N]: `);
    if (!/^y(es)?$/i.test(confirm)) {
      store.close();
      console.log("Cancelled.");
      return;
    }
  }
  store.deleteSecret(name);
  store.close();
  console.log(`\u2713 Deleted ${name}`);
}
async function runList(dataDir, flags) {
  const store = openVault({ dataDir, useSession: true });
  ensureUnlocked(store);
  const tag = typeof flags.tag === "string" ? flags.tag : void 0;
  const list = store.listSecrets(tag);
  store.close();
  if (flags.json) {
    console.log(JSON.stringify(list, null, 2));
  } else if (list.length === 0) {
    console.log("(no secrets)");
  } else {
    for (const s of list) {
      const tags = s.tags.length ? ` [${s.tags.join(", ")}]` : "";
      console.log(`${s.name}${tags}`);
    }
  }
}
async function runInteractiveMenu(dataDir, flags) {
  if (!input.isTTY) {
    printHelp();
    return;
  }
  for (; ; ) {
    const snap = vaultSnapshot(dataDir);
    const unlockLine = snap.session ? `unlocked \xB7 ${formatSessionExpiry(snap.expiresAt)}` : snap.initialized ? "locked" : "not created";
    console.log(`
Password Space
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Vault:  ${dataDir}
Status: ${unlockLine}${snap.secretCount !== null ? ` \xB7 ${snap.secretCount} secret(s)` : ""}

  1) Setup / create vault
  2) Unlock
  3) Lock
  4) Add secret
  5) Remove secret
  6) List secrets
  7) Status
  8) Change passphrase
  9) Quit
`);
    const choice = await promptVisible("Choose [1-9]: ");
    try {
      switch (choice) {
        case "1":
          await runSetupWizard(dataDir, flags);
          break;
        case "2":
          await runUnlock(dataDir, flags);
          break;
        case "3":
          await runLock(dataDir);
          break;
        case "4":
          await runSet(dataDir, { command: "set", positional: [], flags });
          break;
        case "5":
          await runRemove(dataDir, { command: "remove", positional: [], flags });
          break;
        case "6":
          await runList(dataDir, flags);
          break;
        case "7":
          await runStatus(dataDir, flags);
          break;
        case "8":
          await runChangePassphrase(dataDir, flags);
          break;
        case "9":
        case "q":
        case "quit":
        case "exit":
          console.log("Bye.");
          return;
        default:
          console.log("Enter a number 1\u20139.");
      }
    } catch (err) {
      if (err instanceof VaultError) {
        console.error(`Error: ${err.message}`);
      } else if (err instanceof Error && err.message === "Interrupted") {
        console.error("Interrupted.");
        return;
      } else {
        throw err;
      }
    }
  }
}
async function main() {
  const args = parseArgs(process.argv);
  const dataDir = dataDirFrom(args.flags);
  let command = args.command;
  if (!command || command === "menu" || command === "interactive") {
    if (!command && !input.isTTY) {
      printHelp();
      return;
    }
    command = "menu";
  }
  try {
    switch (command) {
      case "help":
      case "--help":
      case "-h":
        printHelp();
        break;
      case "menu":
        await runInteractiveMenu(dataDir, args.flags);
        break;
      case "setup":
      case "init": {
        if (command === "init" && args.flags["create-only"]) {
          const store = openVault({ dataDir, useSession: false });
          if (store.isInitialized()) {
            store.close();
            throw new VaultError("Vault already initialized", "ALREADY_INITIALIZED");
          }
          const pass = await promptNewPassphrase(args.flags);
          await store.init(pass);
          store.close();
          console.log(`Vault initialized at ${vaultDbPath(dataDir)}`);
          console.log("Next: password-space unlock");
          break;
        }
        await runSetupWizard(dataDir, args.flags);
        break;
      }
      case "onboard": {
        const snap = vaultSnapshot(dataDir);
        if (!snap.initialized) {
          console.log("Password Space \u2014 next step\n");
          console.log("  Open Terminal and run (plugin-bundled CLI \u2014 no clone):");
          console.log('    node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup');
          console.log(`    (or: ${selfCmd()} setup)`);
          console.log("\n  You will choose unlock duration: 1 day \xB7 1 week \xB7 until lock.");
          console.log("  Optional scripts: PASSWORD_SPACE_PASSPHRASE in MCP Environment.");
          break;
        }
        if (!snap.unlocked || !snap.session) {
          console.log('Next: node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" unlock');
          console.log("  Choose session duration at the prompt.");
          break;
        }
        console.log('Vault ready. Next: node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" set');
        console.log("  Or run without args for the interactive menu.");
        console.log("  Then in Cursor: vault_status / list_secrets / inject_secret");
        break;
      }
      case "unlock":
        await runUnlock(dataDir, args.flags);
        break;
      case "lock":
        await runLock(dataDir);
        break;
      case "change-passphrase":
        await runChangePassphrase(dataDir, args.flags);
        break;
      case "status":
        await runStatus(dataDir, args.flags);
        break;
      case "set":
      case "add":
        await runSet(dataDir, args);
        break;
      case "get": {
        const name = args.positional[0];
        if (!name) throw new VaultError("Usage: password-space get <name>", "INVALID");
        const store = openVault({ dataDir, useSession: true });
        ensureUnlocked(store);
        const secret = store.getSecret(name, "human-cli");
        store.close();
        if (args.flags.json) {
          console.log(JSON.stringify(secret, null, 2));
        } else {
          output.write(secret.value);
          if (output.isTTY) output.write("\n");
        }
        break;
      }
      case "list":
        await runList(dataDir, args.flags);
        break;
      case "delete":
      case "rm":
      case "remove":
        await runRemove(dataDir, args);
        break;
      case "audit": {
        const store = openVault({ dataDir, useSession: true });
        ensureUnlocked(store);
        const events = store.listAudit(50);
        store.close();
        if (args.flags.json) {
          console.log(JSON.stringify(events, null, 2));
        } else {
          for (const e of events) {
            console.log(`${e.at}  ${e.action}  ${e.secretName ?? "-"}  (${e.actor})`);
          }
        }
        break;
      }
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        exit(1);
    }
  } catch (err) {
    if (err instanceof VaultError) {
      console.error(`Error: ${err.message}`);
      exit(1);
    }
    throw err;
  }
}
function ensureUnlocked(store) {
  if (!store.isInitialized()) {
    throw new VaultError("Vault not initialized. Run: password-space setup", "NOT_INITIALIZED");
  }
  if (!store.isUnlocked) {
    throw new VaultError("Vault is locked. Run: password-space unlock", "LOCKED");
  }
}
function readAllStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    input.on("data", (c) => chunks.push(Buffer.from(c)));
    input.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    input.on("error", reject);
  });
}
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  exit(1);
});
//# sourceMappingURL=cli.js.map
