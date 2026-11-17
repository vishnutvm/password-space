import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { auditLogPath } from "./paths.js";
import { platformKeychain, probeKeychain, type Keychain } from "./keychain.js";
import { guardPrint, type GuardPrint } from "./guard-core.js";
import {
  VaultError,
  type AuditEvent,
  type SecretMetadata,
  type SecretRecord,
  type StorageBackend,
  type VaultMeta,
} from "./types.js";

/** v1: plain JSON with values. v2: adds storeId + backend; values only when backend is "file". */
const STORE_VERSION = 2;

type SecretRow = {
  id: string;
  name: string;
  /** Present only for the "file" backend. */
  value?: string;
  /** Keychain backend: keyed fingerprint so prompt hooks can spot the value without reading it. */
  guard?: GuardPrint;
  tags: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type StoreFile = {
  version: number;
  storeId: string;
  createdAt: string;
  backend: StorageBackend;
  secrets: SecretRow[];
};

export type StoragePreference = "auto" | "keychain" | "file";

export type VaultStoreOptions = {
  /** Keychain to use; `null` means "this machine has none". Default: the platform keychain. */
  keychain?: Keychain | null;
  /** Backend for a new store. Default: $PASSWORD_SPACE_STORAGE or "auto". */
  storage?: StoragePreference;
};

export type StorageInfo = {
  backend: StorageBackend | null;
  /** e.g. "macOS Keychain" when backend is keychain. */
  keychain: string | null;
  /** True when values sit in secrets.json in plain text. */
  values_on_disk: boolean;
  /** Set when a new store fell back to the file backend. */
  fallback_reason: string | null;
  /** A file-backed store on a machine with a keychain: `password-space migrate` will move values. */
  migration_available: boolean;
};

export function storagePreferenceFromEnv(env: NodeJS.ProcessEnv = process.env): StoragePreference {
  const raw = env.PASSWORD_SPACE_STORAGE?.trim().toLowerCase();
  if (raw === "keychain" || raw === "file") return raw;
  return "auto";
}

/**
 * Named secret store.
 *
 * `secrets.json` (mode 0600) always holds names, ids, tags and notes. Secret
 * values live in the OS keychain (backend "keychain") or, on machines without
 * one, in `secrets.json` itself (backend "file", the pre-keychain format).
 */
export class VaultStore {
  readonly storePath: string;
  private data: StoreFile | null = null;
  private keychainOpt: Keychain | null | undefined;
  private readonly storagePref: StoragePreference;
  private fallbackReason: string | null = null;

  constructor(storePath: string, opts: VaultStoreOptions = {}) {
    this.storePath = storePath;
    this.keychainOpt = opts.keychain;
    this.storagePref = opts.storage ?? storagePreferenceFromEnv();
    mkdirSync(dirname(storePath), { recursive: true });
    if (existsSync(storePath)) {
      this.data = this.readFile();
    }
  }

  close(): void {
    this.data = this.isInitialized() ? this.readFile() : null;
  }

  isInitialized(): boolean {
    return existsSync(this.storePath);
  }

  get backend(): StorageBackend | null {
    return this.data?.backend ?? null;
  }

  getMeta(): VaultMeta | null {
    if (!this.data) return null;
    return {
      storeVersion: this.data.version,
      createdAt: this.data.createdAt,
      storage: this.data.backend,
    };
  }

  /** The keychain this store would use, without probing it. */
  keychain(): Keychain | null {
    if (this.keychainOpt === undefined) this.keychainOpt = platformKeychain();
    return this.keychainOpt;
  }

  storageInfo(): StorageInfo {
    const backend = this.data?.backend ?? null;
    const kc = this.keychain();
    return {
      backend,
      keychain: backend === "keychain" ? (kc?.description ?? "unavailable") : null,
      values_on_disk: backend === "file",
      fallback_reason: this.fallbackReason,
      migration_available: backend === "file" && kc !== null,
    };
  }

  /** Ensure the store file exists (setup / first use). Picks the backend for a new store. */
  ensure(): void {
    if (this.isInitialized()) {
      if (!this.data) this.data = this.readFile();
      return;
    }
    const backend = this.chooseBackend();
    const now = new Date().toISOString();
    this.data = { version: STORE_VERSION, storeId: randomUUID(), createdAt: now, backend, secrets: [] };
    this.persist();
    if (backend === "keychain") this.hookKey(true);
    this.audit("init", null, null, "human", `store created (values in ${backend})`);
  }

  private chooseBackend(): StorageBackend {
    if (this.storagePref === "file") return "file";
    const kc = this.keychain();
    const probe = kc ? probeKeychain(kc) : { ok: false as const, reason: "no OS keychain found on this machine" };
    if (probe.ok) return "keychain";
    if (this.storagePref === "keychain") {
      throw new VaultError(
        `PASSWORD_SPACE_STORAGE=keychain but the keychain is not usable: ${probe.reason}`,
        "KEYCHAIN",
      );
    }
    this.fallbackReason = probe.reason;
    return "file";
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

  private requireKeychain(): Keychain {
    const kc = this.keychain();
    if (!kc) {
      throw new VaultError(
        "This store keeps values in the OS keychain, but no keychain is available here. " +
          "On Linux, install libsecret-tools and run a Secret Service (e.g. gnome-keyring).",
        "KEYCHAIN",
      );
    }
    return kc;
  }

  private account(secretId: string): string {
    return `${this.requireReady().storeId}:${secretId}`;
  }

  private guardKeyAccount(): string {
    return `${this.requireReady().storeId}:guard-key`;
  }

  /**
   * Random key for value fingerprints, kept in the keychain next to the values.
   * Without it, the fingerprints in secrets.json cannot be brute-forced offline.
   */
  private hookKey(create: boolean): Buffer | null {
    const kc = this.requireKeychain();
    const hex = kc.get(this.guardKeyAccount());
    if (hex) return Buffer.from(hex, "hex");
    if (!create) return null;
    const key = randomBytes(32);
    kc.set(this.guardKeyAccount(), key.toString("hex"), "password-space:guard-key");
    // A lost key invalidates every fingerprint; rebuild them from the keychain values.
    for (const row of this.requireReady().secrets) {
      const value = kc.get(this.account(row.id));
      row.guard = value == null ? undefined : guardPrint(key, value);
    }
    return key;
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
    const value = this.readValue(row);
    this.audit("get", row.id, row.name, actor, null);
    return { ...this.rowToMeta(row), value };
  }

  private readValue(row: SecretRow): string {
    const data = this.requireReady();
    if (data.backend === "file") return row.value ?? "";
    const value = this.requireKeychain().get(this.account(row.id));
    if (value == null) {
      throw new VaultError(
        `The value for "${row.name}" is missing from the ${this.requireKeychain().description}. Set it again with: password-space set ${row.name}`,
        "KEYCHAIN",
      );
    }
    return value;
  }

  setSecret(input: {
    name: string;
    value: string;
    tags?: string[];
    notes?: string | null;
    id?: string;
    /** Who made the change, recorded in the audit log (names only, never values). */
    actor?: string;
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
    const dup = data.secrets.find(
      (s) => s.id !== existing?.id && s.name.toLowerCase() === name.toLowerCase(),
    );
    if (dup) throw new VaultError(`Secret name already exists: ${name}`, "DUPLICATE_NAME");

    const row: SecretRow = existing ?? {
      id: input.id ?? randomUUID(),
      name,
      tags,
      notes,
      createdAt: now,
      updatedAt: now,
    };
    row.name = name;
    row.tags = tags;
    row.notes = notes;
    row.updatedAt = now;
    this.writeValue(row, input.value);
    if (!existing) data.secrets.push(row);
    this.persist();
    this.audit(existing ? "update" : "create", row.id, name, input.actor ?? "human", null);
    return this.getMetadata(row.id);
  }

  private writeValue(row: SecretRow, value: string): void {
    const data = this.requireReady();
    if (data.backend === "file") {
      row.value = value;
      delete row.guard;
      return;
    }
    const kc = this.requireKeychain();
    kc.set(this.account(row.id), value, `password-space:${row.name}`);
    delete row.value;
    const key = this.hookKey(true)!;
    row.guard = guardPrint(key, value);
  }

  /** True when a secret with this exact id or (case-insensitive) name exists. */
  hasSecret(idOrName: string): boolean {
    return this.findRow(idOrName) !== undefined;
  }

  deleteSecret(idOrName: string, actor = "human"): void {
    const data = this.requireReady();
    const row = this.findRow(idOrName);
    if (!row) throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    if (data.backend === "keychain") this.requireKeychain().delete(this.account(row.id));
    data.secrets = data.secrets.filter((s) => s.id !== row.id);
    this.persist();
    this.audit("delete", row.id, row.name, actor, null);
  }

  /**
   * Move every value to another backend.
   *
   * To the keychain: each value is written, read back and compared before
   * secrets.json is rewritten without values, so a failure part-way leaves
   * the file store as it was. To the file: values are copied into
   * secrets.json first, then removed from the keychain.
   */
  migrate(to: StorageBackend): { moved: number; from: StorageBackend; to: StorageBackend } {
    const data = this.requireReady();
    const from = data.backend;
    if (from === to) return { moved: 0, from, to };

    if (to === "keychain") {
      const kc = this.requireKeychain();
      const probe = probeKeychain(kc);
      if (!probe.ok) throw new VaultError(`Keychain not usable: ${probe.reason}`, "KEYCHAIN");
      const written: string[] = [];
      try {
        // Switch first so account()/hookKey() resolve against this store's id.
        for (const row of data.secrets) {
          const account = this.account(row.id);
          const value = row.value ?? "";
          kc.set(account, value, `password-space:${row.name}`);
          written.push(account);
          if (kc.get(account) !== value) {
            throw new VaultError(`Read-back check failed for "${row.name}"`, "KEYCHAIN");
          }
        }
        data.backend = "keychain";
        const key = this.hookKey(true)!;
        for (const row of data.secrets) {
          row.guard = guardPrint(key, row.value ?? "");
          delete row.value;
        }
      } catch (err) {
        data.backend = "file";
        for (const account of written) {
          try {
            kc.delete(account);
          } catch {
            // best effort
          }
        }
        this.data = this.readFile();
        throw err;
      }
      this.persist();
      this.audit("migrate", null, null, "human", `values moved to ${kc.description}`);
      return { moved: data.secrets.length, from, to };
    }

    // keychain → file
    const kc = this.requireKeychain();
    for (const row of data.secrets) {
      row.value = this.readValue(row);
      delete row.guard;
    }
    const accounts = [...data.secrets.map((r) => this.account(r.id)), this.guardKeyAccount()];
    data.backend = "file";
    this.persist();
    for (const account of accounts) {
      try {
        kc.delete(account);
      } catch {
        // leftovers are harmless; values are already in secrets.json
      }
    }
    this.audit("migrate", null, null, "human", "values moved to secrets.json (plain text)");
    return { moved: data.secrets.length, from, to };
  }

  /**
   * Material for prompt hooks: plain values (file backend) or keyed
   * fingerprints plus the key (keychain backend). Never audited.
   */
  guardMaterial():
    | { backend: "file"; values: Array<{ name: string; value: string }> }
    | {
        backend: "keychain";
        key: Buffer | null;
        prints: Array<{ name: string } & GuardPrint>;
        error?: string;
      } {
    const data = this.requireReady();
    if (data.backend === "file") {
      return {
        backend: "file",
        values: data.secrets.map((r) => ({ name: r.name, value: r.value ?? "" })),
      };
    }
    const prints = data.secrets.flatMap((r) => (r.guard ? [{ name: r.name, ...r.guard }] : []));
    if (prints.length === 0) return { backend: "keychain", key: null, prints };
    try {
      return { backend: "keychain", key: this.hookKey(false), prints };
    } catch (err) {
      return {
        backend: "keychain",
        key: null,
        prints,
        error: err instanceof Error ? err.message : String(err),
      };
    }
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
    const parsed = JSON.parse(raw) as Partial<StoreFile> & { secrets?: unknown };
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.secrets)) {
      throw new VaultError("Store file corrupt", "INVALID");
    }
    // v1 files have no backend field: they are plain JSON with values.
    const backend: StorageBackend = parsed.backend === "keychain" ? "keychain" : "file";
    return {
      version: STORE_VERSION,
      storeId: typeof parsed.storeId === "string" && parsed.storeId ? parsed.storeId : randomUUID(),
      createdAt: parsed.createdAt || new Date().toISOString(),
      backend,
      secrets: (parsed.secrets as Array<Record<string, unknown>>).map((s) => {
        const row: SecretRow = {
          id: String(s.id),
          name: String(s.name),
          tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
          notes: s.notes == null ? null : String(s.notes),
          createdAt: String(s.createdAt ?? ""),
          updatedAt: String(s.updatedAt ?? ""),
        };
        if (backend === "file") row.value = String(s.value ?? "");
        const g = s.guard as GuardPrint | undefined;
        if (backend === "keychain" && g && typeof g.mac === "string" && typeof g.len === "number") {
          row.guard = { len: g.len, mac: g.mac };
        }
        return row;
      }),
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
