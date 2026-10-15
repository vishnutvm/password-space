import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  CRYPTO_VERSION,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  decrypt,
  decryptString,
  deriveKey,
  encrypt,
  encryptString,
  packBlob,
  randomKey,
  randomSalt,
  unpackBlob,
} from "./crypto.js";
import { VaultError, type AuditEvent, type SecretMetadata, type SecretRecord, type VaultMeta } from "./types.js";

type MetaRow = { key: string; value: string };
type SecretRow = {
  id: string;
  name: string;
  tags_json: string;
  notes: string | null;
  ciphertext: Buffer;
  created_at: string;
  updated_at: string;
};

export class VaultStore {
  private db: DatabaseSync;
  private vaultKey: Buffer | null = null;
  readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.ensureSchema();
  }

  private ensureSchema(): void {
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

  close(): void {
    this.lock();
    this.db.close();
  }

  isInitialized(): boolean {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'initialized'").get() as
      | MetaRow
      | undefined;
    return row?.value === "1";
  }

  getMeta(): VaultMeta | null {
    if (!this.isInitialized()) return null;
    const get = (key: string) =>
      (this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as MetaRow | undefined)?.value;
    const salt = get("kdf_salt");
    const createdAt = get("created_at");
    if (!salt || !createdAt) return null;
    return {
      cryptoVersion: Number(get("crypto_version") ?? CRYPTO_VERSION),
      createdAt,
      kdf: {
        algorithm: "scrypt",
        N: Number(get("kdf_N") ?? SCRYPT_N),
        r: Number(get("kdf_r") ?? SCRYPT_R),
        p: Number(get("kdf_p") ?? SCRYPT_P),
        salt,
      },
    };
  }

  async init(passphrase: string): Promise<void> {
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
    const now = new Date().toISOString();

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

    // Zero master key material from our reference (vaultKey kept only if caller unlocks later)
    masterKey.fill(0);
    vaultKey.fill(0);
  }

  get isUnlocked(): boolean {
    return this.vaultKey !== null;
  }

  async unlock(passphrase: string): Promise<Buffer> {
    if (!this.isInitialized()) {
      throw new VaultError("Vault not initialized. Run: password-space init", "NOT_INITIALIZED");
    }
    const meta = this.getMeta();
    if (!meta) {
      throw new VaultError("Vault metadata corrupt", "INVALID");
    }
    const salt = Buffer.from(meta.kdf.salt, "base64");
    const wrappedB64 = (
      this.db.prepare("SELECT value FROM meta WHERE key = 'wrapped_vault_key'").get() as MetaRow
    ).value;
    const wrapped = unpackBlob(Buffer.from(wrappedB64, "base64"));

    const masterKey = await deriveKey(passphrase, salt, {
      N: meta.kdf.N,
      r: meta.kdf.r,
      p: meta.kdf.p,
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
  unlockWithKey(vaultKey: Buffer): void {
    if (!this.isInitialized()) {
      throw new VaultError("Vault not initialized", "NOT_INITIALIZED");
    }
    this.vaultKey = Buffer.from(vaultKey);
  }

  lock(): void {
    if (this.vaultKey) {
      this.vaultKey.fill(0);
      this.vaultKey = null;
    }
  }

  private requireKey(): Buffer {
    if (!this.vaultKey) {
      throw new VaultError("Vault is locked. Run: password-space unlock", "LOCKED");
    }
    return this.vaultKey;
  }

  private rowToMeta(row: SecretRow): SecretMetadata {
    return {
      id: row.id,
      name: row.name,
      tags: JSON.parse(row.tags_json) as string[],
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private normalizeRow(row: SecretRow): SecretRow {
    return {
      ...row,
      ciphertext: Buffer.isBuffer(row.ciphertext)
        ? row.ciphertext
        : Buffer.from(row.ciphertext as unknown as Uint8Array),
    };
  }

  listSecrets(tag?: string): SecretMetadata[] {
    this.requireKey();
    const rows = this.db.prepare("SELECT * FROM secrets ORDER BY name COLLATE NOCASE").all() as SecretRow[];
    const metas = rows.map((r) => this.rowToMeta(this.normalizeRow(r)));
    if (!tag) return metas;
    const needle = tag.toLowerCase();
    return metas.filter((m) => m.tags.some((t) => t.toLowerCase() === needle));
  }

  getMetadata(idOrName: string): SecretMetadata {
    this.requireKey();
    const row = this.findRow(idOrName);
    if (!row) throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    return this.rowToMeta(row);
  }

  getSecret(idOrName: string, actor = "human"): SecretRecord {
    const key = this.requireKey();
    const row = this.findRow(idOrName);
    if (!row) throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    const value = decryptString(unpackBlob(row.ciphertext), key);
    this.audit("get", row.id, row.name, actor, null);
    return { ...this.rowToMeta(row), value };
  }

  setSecret(input: {
    name: string;
    value: string;
    tags?: string[];
    notes?: string | null;
    id?: string;
  }): SecretMetadata {
    const key = this.requireKey();
    const name = input.name.trim();
    if (!name) throw new VaultError("Secret name is required", "INVALID");
    if (input.value === undefined || input.value === null) {
      throw new VaultError("Secret value is required", "INVALID");
    }

    const now = new Date().toISOString();
    const tags = input.tags ?? [];
    const notes = input.notes ?? null;
    const packed = packBlob(encryptString(input.value, key));

    // Update when id matches, or when name matches and no explicit id was given.
    const existing = input.id ? this.findRow(input.id) : this.findRow(name);
    if (existing) {
      const conflict = this.db
        .prepare("SELECT id FROM secrets WHERE name = ? COLLATE NOCASE AND id != ?")
        .get(name, existing.id) as { id: string } | undefined;
      if (conflict) throw new VaultError(`Secret name already exists: ${name}`, "DUPLICATE_NAME");

      this.db
        .prepare(
          `UPDATE secrets SET name = ?, tags_json = ?, notes = ?, ciphertext = ?, updated_at = ? WHERE id = ?`,
        )
        .run(name, JSON.stringify(tags), notes, packed, now, existing.id);
      this.audit("update", existing.id, name, "human", null);
      return this.getMetadata(existing.id);
    }

    const dup = this.db.prepare("SELECT id FROM secrets WHERE name = ? COLLATE NOCASE").get(name) as
      | { id: string }
      | undefined;
    if (dup) throw new VaultError(`Secret name already exists: ${name}`, "DUPLICATE_NAME");

    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO secrets (id, name, tags_json, notes, ciphertext, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, name, JSON.stringify(tags), notes, packed, now, now);
    this.audit("create", id, name, "human", null);
    return this.getMetadata(id);
  }

  deleteSecret(idOrName: string): void {
    this.requireKey();
    const row = this.findRow(idOrName);
    if (!row) throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    this.db.prepare("DELETE FROM secrets WHERE id = ?").run(row.id);
    this.audit("delete", row.id, row.name, "human", null);
  }

  listAudit(limit = 50): AuditEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, at, action, secret_id, secret_name, actor, detail FROM audit ORDER BY at DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      at: string;
      action: string;
      secret_id: string | null;
      secret_name: string | null;
      actor: string;
      detail: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      secretId: r.secret_id,
      secretName: r.secret_name,
      actor: r.actor,
      detail: r.detail,
    }));
  }

  private findRow(idOrName: string): SecretRow | undefined {
    const byId = this.db.prepare("SELECT * FROM secrets WHERE id = ?").get(idOrName) as SecretRow | undefined;
    if (byId) return this.normalizeRow(byId);
    const byName = this.db.prepare("SELECT * FROM secrets WHERE name = ? COLLATE NOCASE").get(idOrName) as
      | SecretRow
      | undefined;
    return byName ? this.normalizeRow(byName) : undefined;
  }

  private audit(
    action: string,
    secretId: string | null,
    secretName: string | null,
    actor: string,
    detail: string | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit (id, at, action, secret_id, secret_name, actor, detail) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), new Date().toISOString(), action, secretId, secretName, actor, detail);
  }

  static exists(dbPath: string): boolean {
    return existsSync(dbPath);
  }
}
