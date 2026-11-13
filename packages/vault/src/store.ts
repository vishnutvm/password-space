import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { auditLogPath } from "./paths.js";
import {
  VaultError,
  type AuditEvent,
  type SecretMetadata,
  type SecretRecord,
  type VaultMeta,
} from "./types.js";

const STORE_VERSION = 1;

type SecretRow = {
  id: string;
  name: string;
  value: string;
  tags: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type StoreFile = {
  version: number;
  createdAt: string;
  secrets: SecretRow[];
};

/**
 * Local plain-text named secret store (`secrets.json`, mode 0600).
 * Values are readable at rest — no passphrase, unlock, or encryption.
 */
export class VaultStore {
  readonly storePath: string;
  /** @deprecated Prefer storePath — kept for MCP/CLI status fields. */
  readonly dbPath: string;
  private data: StoreFile | null = null;

  constructor(storePath: string) {
    this.storePath = storePath;
    this.dbPath = storePath;
    mkdirSync(dirname(storePath), { recursive: true });
    if (existsSync(storePath)) {
      this.data = this.readFile();
    }
  }

  close(): void {
    // No durable connection — flush already done on write.
    this.data = this.isInitialized() ? this.readFile() : null;
  }

  isInitialized(): boolean {
    return existsSync(this.storePath);
  }

  getMeta(): VaultMeta | null {
    if (!this.data) return null;
    return {
      storeVersion: this.data.version,
      createdAt: this.data.createdAt,
      storage: "plain-json",
    };
  }

  /**
   * Create an empty store. Passphrase is ignored (soft-compat with old MCP tools).
   */
  async init(_passphrase?: string): Promise<void> {
    if (this.isInitialized()) {
      throw new VaultError("Store already initialized", "ALREADY_INITIALIZED");
    }
    const now = new Date().toISOString();
    this.data = { version: STORE_VERSION, createdAt: now, secrets: [] };
    this.persist();
    this.audit("init", null, null, "human", "plain-json store created");
  }

  /** Ensure the store file exists (setup / first use). */
  ensure(): void {
    if (!this.isInitialized()) {
      const now = new Date().toISOString();
      this.data = { version: STORE_VERSION, createdAt: now, secrets: [] };
      this.persist();
      this.audit("init", null, null, "human", "plain-json store created");
    } else if (!this.data) {
      this.data = this.readFile();
    }
  }

  /** Always true for the plain store once initialized (no unlock gate). */
  get isUnlocked(): boolean {
    return this.isInitialized();
  }

  /**
   * Soft-compat: no-op unlock. Returns an empty buffer (no vault key).
   */
  async unlock(_passphrase?: string): Promise<Buffer> {
    if (!this.isInitialized()) {
      throw new VaultError(
        "Store not initialized. Run: password-space setup",
        "NOT_INITIALIZED",
      );
    }
    this.data = this.readFile();
    this.audit("unlock", null, null, "human", "noop — plain store needs no unlock");
    return Buffer.alloc(0);
  }

  /** Soft-compat: no vault key to restore. */
  unlockWithKey(_vaultKey: Buffer): void {
    if (!this.isInitialized()) {
      throw new VaultError("Store not initialized", "NOT_INITIALIZED");
    }
    this.data = this.readFile();
  }

  /** Soft-compat: no-op (nothing to lock). */
  lock(): void {
    // intentionally empty
  }

  /**
   * Soft-compat: passphrase change is not applicable.
   */
  async changePassphrase(
    _currentPassphrase: string,
    _nextPassphrase: string,
  ): Promise<Buffer> {
    throw new VaultError(
      "Passphrases are not used. The store is local plain text — lock/unlock/change-passphrase are not needed.",
      "DEPRECATED",
    );
  }

  private requireReady(): StoreFile {
    if (!this.isInitialized() || !this.data) {
      throw new VaultError(
        "Store not initialized. Run: password-space setup (or set)",
        "NOT_INITIALIZED",
      );
    }
    return this.data;
  }

  private rowToMeta(row: SecretRow): SecretMetadata {
    return {
      id: row.id,
      name: row.name,
      tags: row.tags,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  listSecrets(tag?: string): SecretMetadata[] {
    const data = this.requireReady();
    const metas = data.secrets
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map((r) => this.rowToMeta(r));
    if (!tag) return metas;
    const needle = tag.toLowerCase();
    return metas.filter((m) => m.tags.some((t) => t.toLowerCase() === needle));
  }

  getMetadata(idOrName: string): SecretMetadata {
    const row = this.findRow(idOrName);
    if (!row) throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    return this.rowToMeta(row);
  }

  getSecret(idOrName: string, actor = "human"): SecretRecord {
    const row = this.findRow(idOrName);
    if (!row) throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    this.audit("get", row.id, row.name, actor, null);
    return { ...this.rowToMeta(row), value: row.value };
  }

  setSecret(input: {
    name: string;
    value: string;
    tags?: string[];
    notes?: string | null;
    id?: string;
  }): SecretMetadata {
    this.ensure();
    const data = this.requireReady();
    const name = input.name.trim();
    if (!name) throw new VaultError("Secret name is required", "INVALID");
    if (input.value === undefined || input.value === null) {
      throw new VaultError("Secret value is required", "INVALID");
    }

    const now = new Date().toISOString();
    const tags = input.tags ?? [];
    const notes = input.notes ?? null;

    const existing = input.id ? this.findRow(input.id) : this.findRow(name);
    if (existing) {
      const conflict = data.secrets.find(
        (s) =>
          s.id !== existing.id && s.name.toLowerCase() === name.toLowerCase(),
      );
      if (conflict) throw new VaultError(`Secret name already exists: ${name}`, "DUPLICATE_NAME");

      existing.name = name;
      existing.value = input.value;
      existing.tags = tags;
      existing.notes = notes;
      existing.updatedAt = now;
      this.persist();
      this.audit("update", existing.id, name, "human", null);
      return this.getMetadata(existing.id);
    }

    const dup = data.secrets.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (dup) throw new VaultError(`Secret name already exists: ${name}`, "DUPLICATE_NAME");

    const id = input.id ?? randomUUID();
    data.secrets.push({
      id,
      name,
      value: input.value,
      tags,
      notes,
      createdAt: now,
      updatedAt: now,
    });
    this.persist();
    this.audit("create", id, name, "human", null);
    return this.getMetadata(id);
  }

  deleteSecret(idOrName: string): void {
    const data = this.requireReady();
    const row = this.findRow(idOrName);
    if (!row) throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    data.secrets = data.secrets.filter((s) => s.id !== row.id);
    this.persist();
    this.audit("delete", row.id, row.name, "human", null);
  }

  listAudit(limit = 50): AuditEvent[] {
    const logPath = auditLogPath(dirname(this.storePath));
    if (!existsSync(logPath)) return [];
    const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    const events: AuditEvent[] = [];
    for (const line of lines.slice(-limit).reverse()) {
      try {
        events.push(JSON.parse(line) as AuditEvent);
      } catch {
        // skip corrupt lines
      }
    }
    return events.slice(0, limit);
  }

  private findRow(idOrName: string): SecretRow | undefined {
    const data = this.requireReady();
    const byId = data.secrets.find((s) => s.id === idOrName);
    if (byId) return byId;
    return data.secrets.find((s) => s.name.toLowerCase() === idOrName.toLowerCase());
  }

  private readFile(): StoreFile {
    const raw = readFileSync(this.storePath, "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.secrets)) {
      throw new VaultError("Store file corrupt", "INVALID");
    }
    return {
      version: Number(parsed.version) || STORE_VERSION,
      createdAt: parsed.createdAt || new Date().toISOString(),
      secrets: parsed.secrets.map((s) => ({
        id: String(s.id),
        name: String(s.name),
        value: String(s.value ?? ""),
        tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
        notes: s.notes == null ? null : String(s.notes),
        createdAt: String(s.createdAt ?? ""),
        updatedAt: String(s.updatedAt ?? ""),
      })),
    };
  }

  private persist(): void {
    if (!this.data) return;
    const dir = dirname(this.storePath);
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.storePath}.${process.pid}.tmp`;
    const body = JSON.stringify(this.data, null, 2) + "\n";
    writeFileSync(tmp, body, { mode: 0o600, encoding: "utf8" });
    renameSync(tmp, this.storePath);
    try {
      chmodSync(this.storePath, 0o600);
    } catch {
      // best-effort on platforms without chmod
    }
  }

  private audit(
    action: string,
    secretId: string | null,
    secretName: string | null,
    actor: string,
    detail: string | null,
  ): void {
    const event: AuditEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      action,
      secretId,
      secretName,
      actor,
      detail,
    };
    const logPath = auditLogPath(dirname(this.storePath));
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      writeFileSync(logPath, JSON.stringify(event) + "\n", {
        flag: "a",
        mode: 0o600,
        encoding: "utf8",
      });
    } catch {
      // audit is best-effort
    }
  }

  static exists(storePath: string): boolean {
    return existsSync(storePath);
  }
}
