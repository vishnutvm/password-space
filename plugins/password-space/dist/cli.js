#!/usr/bin/env node

// packages/cli/src/index.ts
import { createInterface } from "node:readline";
import { stdin as input, stdout as output, exit } from "node:process";

// packages/vault/dist/paths.js
import { existsSync } from "node:fs";
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
function secretsStorePath(dataDir) {
  return join(dataDir, "secrets.json");
}
function auditLogPath(dataDir) {
  return join(dataDir, "audit.jsonl");
}
function vaultDbPath(dataDir) {
  return join(dataDir, "vault.db");
}
function hasLegacyEncryptedVault(dataDir) {
  return existsSync(vaultDbPath(dataDir));
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
import { chmodSync, existsSync as existsSync3, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// packages/vault/dist/keychain.js
import { spawnSync } from "node:child_process";
import { existsSync as existsSync2 } from "node:fs";
var KEYCHAIN_SERVICE = "password-space";
var defaultRunner = (cmd, args, input2) => {
  const r = spawnSync(cmd, args, {
    input: input2 ?? "",
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 3e4
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    error: r.error
  };
};
function fail(op, kind, r) {
  const detail = (r.error?.message ?? r.stderr ?? "").trim().split("\n")[0] || `exit ${r.status}`;
  throw new VaultError(`${kind}: ${op} failed (${detail})`, "KEYCHAIN");
}
function safeLabel(label) {
  return label.replace(/[^A-Za-z0-9_.:@+-]/g, "_").slice(0, 120) || "secret";
}
function assertSafeAccount(account) {
  if (!/^[A-Za-z0-9_.:/@+-]{1,200}$/.test(account)) {
    throw new VaultError(`Invalid keychain account name: ${account}`, "INVALID");
  }
}
var MAC_B64_PREFIX = "b64:";
function encodeMacValue(value) {
  if (/^[\x20-\x7e]*$/.test(value) && !value.startsWith(MAC_B64_PREFIX))
    return value;
  return MAC_B64_PREFIX + Buffer.from(value, "utf8").toString("base64");
}
function decodeMacValue(stored) {
  if (stored.startsWith(MAC_B64_PREFIX)) {
    return Buffer.from(stored.slice(MAC_B64_PREFIX.length), "base64").toString("utf8");
  }
  return stored;
}
var MAC_MAX_LINE = 4e3;
var MAC_MAX_VALUE_BYTES = 1900;
var MacKeychain = class {
  run;
  keychainPath;
  bin;
  kind = "macos-keychain";
  description;
  constructor(run = defaultRunner, keychainPath = process.env.PASSWORD_SPACE_MACOS_KEYCHAIN?.trim() || null, bin = "/usr/bin/security") {
    this.run = run;
    this.keychainPath = keychainPath;
    this.bin = bin;
    this.description = keychainPath ? `macOS Keychain (${keychainPath})` : "macOS Keychain";
  }
  kc() {
    return this.keychainPath ? [this.keychainPath] : [];
  }
  get(account) {
    assertSafeAccount(account);
    const r = this.run(this.bin, [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      account,
      "-w",
      ...this.kc()
    ]);
    if (r.status === 44)
      return null;
    if (r.status !== 0)
      fail("read", this.description, r);
    return decodeMacValue(r.stdout.replace(/\n$/, ""));
  }
  set(account, value, label) {
    assertSafeAccount(account);
    const hex = Buffer.from(encodeMacValue(value), "utf8").toString("hex");
    const kc = this.keychainPath ? ` ${this.keychainPath}` : "";
    if (/\s/.test(kc.trim())) {
      throw new VaultError("PASSWORD_SPACE_MACOS_KEYCHAIN must not contain spaces", "INVALID");
    }
    const line = `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${account} -l ${safeLabel(label)} -X ${hex}${kc}
`;
    if (line.length > MAC_MAX_LINE) {
      throw new VaultError(`Secret is too long for the macOS Keychain helper (${Buffer.byteLength(value)} bytes, about ${MAC_MAX_VALUE_BYTES} allowed). Use PASSWORD_SPACE_STORAGE=file for very long values.`, "INVALID");
    }
    const r = this.run(this.bin, ["-i"], line);
    if (r.status !== 0 || r.stderr.trim())
      fail("write", this.description, r);
  }
  delete(account) {
    assertSafeAccount(account);
    const r = this.run(this.bin, [
      "delete-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      account,
      ...this.kc()
    ]);
    if (r.status === 0 || r.status === 44)
      return;
    fail("delete", this.description, r);
  }
};
var LinuxSecretService = class {
  run;
  bin;
  kind = "linux-secret-service";
  description = "Secret Service (libsecret)";
  constructor(run = defaultRunner, bin = "secret-tool") {
    this.run = run;
    this.bin = bin;
  }
  get(account) {
    assertSafeAccount(account);
    const r = this.run(this.bin, ["lookup", "service", KEYCHAIN_SERVICE, "account", account]);
    if (r.status === 0)
      return r.stdout;
    if (r.status === 1 && !r.stderr.trim() && !r.error)
      return null;
    fail("read", this.description, r);
  }
  set(account, value, label) {
    assertSafeAccount(account);
    const r = this.run(this.bin, ["store", `--label=${safeLabel(label)}`, "service", KEYCHAIN_SERVICE, "account", account], value);
    if (r.status !== 0)
      fail("write", this.description, r);
  }
  delete(account) {
    assertSafeAccount(account);
    const r = this.run(this.bin, ["clear", "service", KEYCHAIN_SERVICE, "account", account]);
    if (r.status === 0 || r.status === 1 && !r.stderr.trim() && !r.error)
      return;
    fail("delete", this.description, r);
  }
};
var WINDOWS_MAX_BLOB_BYTES = 2560;
var WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$src = @"
using System;
using System.Runtime.InteropServices;
public static class PsCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredWriteW(ref CREDENTIAL cred, int flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredDeleteW(string target, int type, int flags);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr p);
  public static string Read(string target) {
    IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) {
      int e = Marshal.GetLastWin32Error();
      if (e == 1168) return null;
      throw new System.ComponentModel.Win32Exception(e);
    }
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      byte[] b = new byte[c.CredentialBlobSize];
      if (c.CredentialBlobSize > 0) Marshal.Copy(c.CredentialBlob, b, 0, c.CredentialBlobSize);
      return Convert.ToBase64String(b);
    } finally { CredFree(p); }
  }
  public static void Write(string target, string user, string b64) {
    byte[] b = Convert.FromBase64String(b64);
    CREDENTIAL c = new CREDENTIAL();
    c.Type = 1; c.TargetName = target; c.UserName = user; c.Persist = 2;
    c.CredentialBlobSize = b.Length;
    c.CredentialBlob = Marshal.AllocHGlobal(Math.Max(b.Length, 1));
    try {
      if (b.Length > 0) Marshal.Copy(b, 0, c.CredentialBlob, b.Length);
      if (!CredWriteW(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(c.CredentialBlob); }
  }
  public static void Delete(string target) {
    if (!CredDeleteW(target, 1, 0)) {
      int e = Marshal.GetLastWin32Error();
      if (e != 1168) throw new System.ComponentModel.Win32Exception(e);
    }
  }
}
"@
Add-Type -TypeDefinition $src
$req = [Console]::In.ReadToEnd() | ConvertFrom-Json
$res = @{ ok = $true; value = $null; error = $null }
try {
  switch ($req.op) {
    'get' { $res.value = [PsCred]::Read($req.target) }
    'set' { [PsCred]::Write($req.target, $req.user, $req.value) }
    'delete' { [PsCred]::Delete($req.target) }
  }
} catch { $res.ok = $false; $res.error = $_.Exception.Message }
[Console]::Out.Write((ConvertTo-Json -InputObject $res -Compress))
`;
var WindowsCredentialManager = class {
  run;
  bin;
  kind = "windows-credential-manager";
  description = "Windows Credential Manager";
  encoded = Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64");
  constructor(run = defaultRunner, bin = "powershell.exe") {
    this.run = run;
    this.bin = bin;
  }
  call(op, account, extra = {}) {
    const input2 = JSON.stringify({ op, target: `${KEYCHAIN_SERVICE}:${account}`, ...extra });
    const r = this.run(this.bin, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", this.encoded], input2);
    if (r.status !== 0)
      fail(op, this.description, r);
    let parsed;
    try {
      parsed = JSON.parse(r.stdout.trim());
    } catch {
      fail(op, this.description, { ...r, stderr: "unexpected output" });
    }
    if (!parsed.ok)
      fail(op, this.description, { ...r, stderr: parsed.error ?? "unknown error" });
    return parsed;
  }
  get(account) {
    assertSafeAccount(account);
    const r = this.call("get", account);
    return r.value == null ? null : Buffer.from(r.value, "base64").toString("utf8");
  }
  set(account, value, label) {
    assertSafeAccount(account);
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length > WINDOWS_MAX_BLOB_BYTES) {
      throw new VaultError(`Secret is ${bytes.length} bytes; Windows Credential Manager allows at most ${WINDOWS_MAX_BLOB_BYTES}.`, "INVALID");
    }
    this.call("set", account, { user: safeLabel(label), value: bytes.toString("base64") });
  }
  delete(account) {
    assertSafeAccount(account);
    this.call("delete", account);
  }
};
var override;
function onPath(bin) {
  const r = defaultRunner(process.platform === "win32" ? "where" : "which", [bin]);
  return r.status === 0;
}
function platformKeychain(platform = process.platform) {
  if (override !== void 0)
    return override;
  if (process.env.PASSWORD_SPACE_KEYCHAIN === "none")
    return null;
  if (platform === "darwin") {
    return existsSync2("/usr/bin/security") ? new MacKeychain() : null;
  }
  if (platform === "win32")
    return new WindowsCredentialManager();
  if (platform === "linux" || platform === "freebsd" || platform === "openbsd") {
    return onPath("secret-tool") ? new LinuxSecretService() : null;
  }
  return null;
}
function probeKeychain(kc) {
  const account = `probe-${process.pid}-${Date.now()}`;
  const value = `probe-${Math.random().toString(36).slice(2)}`;
  try {
    kc.set(account, value, "password-space-probe");
    const back = kc.get(account);
    kc.delete(account);
    if (back !== value)
      return { ok: false, reason: `${kc.description}: read-back mismatch` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// packages/vault/dist/guard-core.js
import { createHmac } from "node:crypto";
var GUARD_MIN_LENGTH = 6;
function mac(key, text) {
  return createHmac("sha256", key).update(text, "utf8").digest("hex").slice(0, 32);
}
function guardPrint(key, value) {
  if (value.length < GUARD_MIN_LENGTH)
    return void 0;
  return { len: value.length, mac: mac(key, value) };
}

// packages/vault/dist/store.js
var STORE_VERSION = 2;
function storagePreferenceFromEnv(env = process.env) {
  const raw = env.PASSWORD_SPACE_STORAGE?.trim().toLowerCase();
  if (raw === "keychain" || raw === "file")
    return raw;
  return "auto";
}
var VaultStore = class {
  storePath;
  data = null;
  keychainOpt;
  storagePref;
  fallbackReason = null;
  constructor(storePath, opts = {}) {
    this.storePath = storePath;
    this.keychainOpt = opts.keychain;
    this.storagePref = opts.storage ?? storagePreferenceFromEnv();
    mkdirSync(dirname(storePath), { recursive: true });
    if (existsSync3(storePath)) {
      this.data = this.readFile();
    }
  }
  close() {
    this.data = this.isInitialized() ? this.readFile() : null;
  }
  isInitialized() {
    return existsSync3(this.storePath);
  }
  get backend() {
    return this.data?.backend ?? null;
  }
  getMeta() {
    if (!this.data)
      return null;
    return {
      storeVersion: this.data.version,
      createdAt: this.data.createdAt,
      storage: this.data.backend
    };
  }
  /** The keychain this store would use, without probing it. */
  keychain() {
    if (this.keychainOpt === void 0)
      this.keychainOpt = platformKeychain();
    return this.keychainOpt;
  }
  storageInfo() {
    const backend = this.data?.backend ?? null;
    const kc = this.keychain();
    return {
      backend,
      keychain: backend === "keychain" ? kc?.description ?? "unavailable" : null,
      values_on_disk: backend === "file",
      fallback_reason: this.fallbackReason,
      migration_available: backend === "file" && kc !== null
    };
  }
  /** Ensure the store file exists (setup / first use). Picks the backend for a new store. */
  ensure() {
    if (this.isInitialized()) {
      if (!this.data)
        this.data = this.readFile();
      return;
    }
    const backend = this.chooseBackend();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.data = { version: STORE_VERSION, storeId: randomUUID(), createdAt: now, backend, secrets: [] };
    this.persist();
    if (backend === "keychain")
      this.hookKey(true);
    this.audit("init", null, null, "human", `store created (values in ${backend})`);
  }
  chooseBackend() {
    if (this.storagePref === "file")
      return "file";
    const kc = this.keychain();
    const probe = kc ? probeKeychain(kc) : { ok: false, reason: "no OS keychain found on this machine" };
    if (probe.ok)
      return "keychain";
    if (this.storagePref === "keychain") {
      throw new VaultError(`PASSWORD_SPACE_STORAGE=keychain but the keychain is not usable: ${probe.reason}`, "KEYCHAIN");
    }
    this.fallbackReason = probe.reason;
    return "file";
  }
  requireReady() {
    if (!this.isInitialized() || !this.data) {
      throw new VaultError("Store not initialized. Run: password-space setup (or set)", "NOT_INITIALIZED");
    }
    return this.data;
  }
  requireKeychain() {
    const kc = this.keychain();
    if (!kc) {
      throw new VaultError("This store keeps values in the OS keychain, but no keychain is available here. On Linux, install libsecret-tools and run a Secret Service (e.g. gnome-keyring).", "KEYCHAIN");
    }
    return kc;
  }
  account(secretId) {
    return `${this.requireReady().storeId}:${secretId}`;
  }
  guardKeyAccount() {
    return `${this.requireReady().storeId}:guard-key`;
  }
  /**
   * Random key for value fingerprints, kept in the keychain next to the values.
   * Without it, the fingerprints in secrets.json cannot be brute-forced offline.
   */
  hookKey(create) {
    const kc = this.requireKeychain();
    const hex = kc.get(this.guardKeyAccount());
    if (hex)
      return Buffer.from(hex, "hex");
    if (!create)
      return null;
    const key = randomBytes(32);
    kc.set(this.guardKeyAccount(), key.toString("hex"), "password-space:guard-key");
    for (const row of this.requireReady().secrets) {
      const value = kc.get(this.account(row.id));
      row.guard = value == null ? void 0 : guardPrint(key, value);
    }
    return key;
  }
  rowToMeta(row) {
    return {
      id: row.id,
      name: row.name,
      tags: row.tags,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
  listSecrets(tag) {
    const data = this.requireReady();
    const metas = data.secrets.slice().sort((a, b) => a.name.localeCompare(b.name, void 0, { sensitivity: "base" })).map((r) => this.rowToMeta(r));
    if (!tag)
      return metas;
    const needle = tag.toLowerCase();
    return metas.filter((m) => m.tags.some((t) => t.toLowerCase() === needle));
  }
  getMetadata(idOrName) {
    const row = this.findRow(idOrName);
    if (!row)
      throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    return this.rowToMeta(row);
  }
  getSecret(idOrName, actor = "human") {
    const row = this.findRow(idOrName);
    if (!row)
      throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    const value = this.readValue(row);
    this.audit("get", row.id, row.name, actor, null);
    return { ...this.rowToMeta(row), value };
  }
  readValue(row) {
    const data = this.requireReady();
    if (data.backend === "file")
      return row.value ?? "";
    const value = this.requireKeychain().get(this.account(row.id));
    if (value == null) {
      throw new VaultError(`The value for "${row.name}" is missing from the ${this.requireKeychain().description}. Set it again with: password-space set ${row.name}`, "KEYCHAIN");
    }
    return value;
  }
  setSecret(input2) {
    this.ensure();
    const data = this.requireReady();
    const name = input2.name.trim();
    if (!name)
      throw new VaultError("Secret name is required", "INVALID");
    if (input2.value === void 0 || input2.value === null) {
      throw new VaultError("Secret value is required", "INVALID");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const tags = input2.tags ?? [];
    const notes = input2.notes ?? null;
    const existing = input2.id ? this.findRow(input2.id) : this.findRow(name);
    const dup = data.secrets.find((s) => s.id !== existing?.id && s.name.toLowerCase() === name.toLowerCase());
    if (dup)
      throw new VaultError(`Secret name already exists: ${name}`, "DUPLICATE_NAME");
    const row = existing ?? {
      id: input2.id ?? randomUUID(),
      name,
      tags,
      notes,
      createdAt: now,
      updatedAt: now
    };
    row.name = name;
    row.tags = tags;
    row.notes = notes;
    row.updatedAt = now;
    this.writeValue(row, input2.value);
    if (!existing)
      data.secrets.push(row);
    this.persist();
    this.audit(existing ? "update" : "create", row.id, name, "human", null);
    return this.getMetadata(row.id);
  }
  writeValue(row, value) {
    const data = this.requireReady();
    if (data.backend === "file") {
      row.value = value;
      delete row.guard;
      return;
    }
    const kc = this.requireKeychain();
    kc.set(this.account(row.id), value, `password-space:${row.name}`);
    delete row.value;
    const key = this.hookKey(true);
    row.guard = guardPrint(key, value);
  }
  deleteSecret(idOrName) {
    const data = this.requireReady();
    const row = this.findRow(idOrName);
    if (!row)
      throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    if (data.backend === "keychain")
      this.requireKeychain().delete(this.account(row.id));
    data.secrets = data.secrets.filter((s) => s.id !== row.id);
    this.persist();
    this.audit("delete", row.id, row.name, "human", null);
  }
  /**
   * Move every value to another backend.
   *
   * To the keychain: each value is written, read back and compared before
   * secrets.json is rewritten without values, so a failure part-way leaves
   * the file store as it was. To the file: values are copied into
   * secrets.json first, then removed from the keychain.
   */
  migrate(to) {
    const data = this.requireReady();
    const from = data.backend;
    if (from === to)
      return { moved: 0, from, to };
    if (to === "keychain") {
      const kc2 = this.requireKeychain();
      const probe = probeKeychain(kc2);
      if (!probe.ok)
        throw new VaultError(`Keychain not usable: ${probe.reason}`, "KEYCHAIN");
      const written = [];
      try {
        for (const row of data.secrets) {
          const account = this.account(row.id);
          const value = row.value ?? "";
          kc2.set(account, value, `password-space:${row.name}`);
          written.push(account);
          if (kc2.get(account) !== value) {
            throw new VaultError(`Read-back check failed for "${row.name}"`, "KEYCHAIN");
          }
        }
        data.backend = "keychain";
        const key = this.hookKey(true);
        for (const row of data.secrets) {
          row.guard = guardPrint(key, row.value ?? "");
          delete row.value;
        }
      } catch (err) {
        data.backend = "file";
        for (const account of written) {
          try {
            kc2.delete(account);
          } catch {
          }
        }
        this.data = this.readFile();
        throw err;
      }
      this.persist();
      this.audit("migrate", null, null, "human", `values moved to ${kc2.description}`);
      return { moved: data.secrets.length, from, to };
    }
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
      }
    }
    this.audit("migrate", null, null, "human", "values moved to secrets.json (plain text)");
    return { moved: data.secrets.length, from, to };
  }
  /**
   * Material for prompt hooks: plain values (file backend) or keyed
   * fingerprints plus the key (keychain backend). Never audited.
   */
  guardMaterial() {
    const data = this.requireReady();
    if (data.backend === "file") {
      return {
        backend: "file",
        values: data.secrets.map((r) => ({ name: r.name, value: r.value ?? "" }))
      };
    }
    const prints = data.secrets.flatMap((r) => r.guard ? [{ name: r.name, ...r.guard }] : []);
    if (prints.length === 0)
      return { backend: "keychain", key: null, prints };
    try {
      return { backend: "keychain", key: this.hookKey(false), prints };
    } catch (err) {
      return {
        backend: "keychain",
        key: null,
        prints,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
  listAudit(limit = 50) {
    const logPath = auditLogPath(dirname(this.storePath));
    if (!existsSync3(logPath))
      return [];
    const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    const events = [];
    for (const line of lines.slice(-limit).reverse()) {
      try {
        events.push(JSON.parse(line));
      } catch {
      }
    }
    return events.slice(0, limit);
  }
  findRow(idOrName) {
    const data = this.requireReady();
    const byId = data.secrets.find((s) => s.id === idOrName);
    if (byId)
      return byId;
    return data.secrets.find((s) => s.name.toLowerCase() === idOrName.toLowerCase());
  }
  readFile() {
    const raw = readFileSync(this.storePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.secrets)) {
      throw new VaultError("Store file corrupt", "INVALID");
    }
    const backend = parsed.backend === "keychain" ? "keychain" : "file";
    return {
      version: STORE_VERSION,
      storeId: typeof parsed.storeId === "string" && parsed.storeId ? parsed.storeId : randomUUID(),
      createdAt: parsed.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      backend,
      secrets: parsed.secrets.map((s) => {
        const row = {
          id: String(s.id),
          name: String(s.name),
          tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
          notes: s.notes == null ? null : String(s.notes),
          createdAt: String(s.createdAt ?? ""),
          updatedAt: String(s.updatedAt ?? "")
        };
        if (backend === "file")
          row.value = String(s.value ?? "");
        const g = s.guard;
        if (backend === "keychain" && g && typeof g.mac === "string" && typeof g.len === "number") {
          row.guard = { len: g.len, mac: g.mac };
        }
        return row;
      })
    };
  }
  persist() {
    if (!this.data)
      return;
    const dir = dirname(this.storePath);
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.storePath}.${process.pid}.tmp`;
    const body = JSON.stringify(this.data, null, 2) + "\n";
    writeFileSync(tmp, body, { mode: 384, encoding: "utf8" });
    renameSync(tmp, this.storePath);
    try {
      chmodSync(this.storePath, 384);
    } catch {
    }
  }
  audit(action, secretId, secretName, actor, detail) {
    const event = {
      id: randomUUID(),
      at: (/* @__PURE__ */ new Date()).toISOString(),
      action,
      secretId,
      secretName,
      actor,
      detail
    };
    const logPath = auditLogPath(dirname(this.storePath));
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      writeFileSync(logPath, JSON.stringify(event) + "\n", {
        flag: "a",
        mode: 384,
        encoding: "utf8"
      });
    } catch {
    }
  }
  static exists(storePath) {
    return existsSync3(storePath);
  }
};

// packages/vault/dist/inject.js
var DEFAULT_INJECT_TTL_MS = 60 * 1e3;

// packages/vault/dist/index.js
function openVault(opts = {}) {
  const dataDir = opts.dataDir ?? defaultDataDir();
  return new VaultStore(secretsStorePath(dataDir));
}

// packages/cli/src/run.ts
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
var RUN_USAGE = `Run a command with secrets in its environment:
  password-space run -s GITHUB_TOKEN -- gh repo list
  password-space run -s OPENAI_API_KEY=openai-prod -s DB_URL -- npm test
  password-space run --all -- ./deploy.sh

  -s, --secret NAME        Pass secret NAME as env var NAME (upper-cased, non [A-Z0-9_] \u2192 _)
  -s, --secret VAR=NAME    Pass secret NAME as env var VAR
  --all                    Pass every stored secret
  --redact / --no-redact   Replace secret values in the command's output with [REDACTED]
                           (--no-redact needs an interactive terminal)
                           (default: on when output is not a terminal, e.g. an agent)
  The command runs directly (no shell). Values never appear in argv or chat.`;
function parseRunArgs(argv) {
  const opts = { specs: [], all: false, command: [] };
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      i++;
      break;
    }
    if (a === "-s" || a === "--secret") {
      const v = argv[++i];
      if (!v) throw new VaultError(`${a} needs a secret name`, "INVALID");
      const eq = v.indexOf("=");
      opts.specs.push(eq > 0 ? { envVar: v.slice(0, eq), name: v.slice(eq + 1) } : { name: v });
    } else if (a === "--all") {
      opts.all = true;
    } else if (a === "--redact") {
      opts.redact = true;
    } else if (a === "--no-redact") {
      opts.redact = false;
    } else if (a === "-d" || a === "--data-dir") {
      opts.dataDir = argv[++i];
    } else if (a.startsWith("-")) {
      throw new VaultError(`Unknown run option: ${a}

${RUN_USAGE}`, "INVALID");
    } else {
      break;
    }
  }
  opts.command = argv.slice(i);
  return opts;
}
function envNameFor(secretName) {
  const cleaned = secretName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return "SECRET";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}
function resolveRunEnv(dataDir, opts) {
  const store = openVault({ dataDir });
  try {
    if (!store.isInitialized()) {
      throw new VaultError("Store not initialized. Run: password-space setup", "NOT_INITIALIZED");
    }
    const specs = opts.all ? [...store.listSecrets().map((m) => ({ name: m.name })), ...opts.specs] : opts.specs;
    const env = {};
    for (const spec of specs) {
      const secret = store.getSecret(spec.name, "cli-run");
      const envVar = spec.envVar ?? envNameFor(secret.name);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envVar)) {
        throw new VaultError(`Invalid environment variable name: ${envVar}`, "INVALID");
      }
      env[envVar] = secret.value;
    }
    return env;
  } finally {
    store.close();
  }
}
var REDACT_MIN_LENGTH = 3;
var StreamRedactor = class {
  constructor(values, write, idleMs = 50) {
    this.write = write;
    this.idleMs = idleMs;
    this.values = [...new Set(values.filter((v) => v.length >= REDACT_MIN_LENGTH))].sort(
      (a, b) => b.length - a.length
    );
    this.keep = Math.max(0, ...this.values.map((v) => v.length - 1));
  }
  buf = "";
  decoder = new StringDecoder("utf8");
  values;
  keep;
  timer = null;
  push(chunk) {
    this.buf += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    this.flush(false);
  }
  end() {
    this.buf += this.decoder.end();
    this.flush(true);
  }
  flush(all) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    let text = this.buf;
    for (const v of this.values) text = text.split(v).join("[REDACTED]");
    let cut = all ? text.length : Math.max(0, text.length - this.keep);
    if (cut > 0 && cut < text.length && /[\uD800-\uDBFF]/.test(text[cut - 1])) cut--;
    if (cut > 0) this.write(text.slice(0, cut));
    this.buf = text.slice(cut);
    if (this.buf && !all) {
      this.timer = setTimeout(() => this.flush(true), this.idleMs);
      this.timer.unref?.();
    }
  }
};
async function runWithSecrets(defaultDataDir2, opts) {
  if (opts.command.length === 0) {
    throw new VaultError(`No command given.

${RUN_USAGE}`, "INVALID");
  }
  if (opts.specs.length === 0 && !opts.all) {
    throw new VaultError(`Name at least one secret with -s NAME (or use --all).

${RUN_USAGE}`, "INVALID");
  }
  if (opts.redact === false && !process.stdout.isTTY) {
    throw new VaultError(
      "--no-redact only works when output goes to an interactive terminal. Piped or captured output (agents, scripts, logs) is always redacted.",
      "INVALID"
    );
  }
  const secretEnv = resolveRunEnv(opts.dataDir ?? defaultDataDir2, opts);
  const redact = opts.redact ?? !process.stdout.isTTY;
  const [cmd, ...args] = opts.command;
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...secretEnv },
      stdio: redact ? ["inherit", "pipe", "pipe"] : "inherit",
      // .cmd/.bat shims (npm, npx, ...) only start through the shell on Windows.
      shell: process.platform === "win32"
    });
    const values = Object.values(secretEnv);
    const out = redact ? new StreamRedactor(values, (s) => process.stdout.write(s)) : null;
    const err = redact ? new StreamRedactor(values, (s) => process.stderr.write(s)) : null;
    child.stdout?.on("data", (c) => out.push(c));
    child.stderr?.on("data", (c) => err.push(c));
    const forward = (sig) => () => child.kill(sig);
    const onInt = forward("SIGINT");
    const onTerm = forward("SIGTERM");
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    child.on("error", (e) => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      console.error(
        e.code === "ENOENT" ? `password-space run: command not found: ${cmd}` : `password-space run: ${e.message}`
      );
      resolve(127);
    });
    child.on("close", (code, signal) => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      out?.end();
      err?.end();
      if (signal) {
        const n = { SIGINT: 2, SIGTERM: 15, SIGKILL: 9, SIGHUP: 1 }[signal] ?? 1;
        resolve(128 + n);
      } else {
        resolve(code ?? 1);
      }
    });
  });
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
      rl.once("close", () => reject(new Error("No value on stdin")));
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
  console.log(`password-space \u2014 named secrets in your OS keychain (Terminal for humans, MCP for agents)

Usage:
  password-space                 Interactive menu (TTY)
  password-space <command> [options]

Commands:
  setup | init           Create the store (values go to the OS keychain when available)
  status                 Store status, including where values are kept
  set | add [name]       Store or update a secret (hidden value)
  remove | delete | rm   Delete a secret (prompts for name)
  list                   List secret names only (no values)
  run -s NAME -- <cmd>   Run a command with secrets in its environment (see below)
  migrate [--to file]    Move values into the OS keychain (or back to secrets.json)
  menu | interactive     Full interactive menu
  onboard                Print next Terminal step
  get <name>             Show a value (interactive terminal only, asks first)
  audit                  Recent access events (no values)
  help                   Show this help

Options:
  --data-dir, -d         Data directory (default: ~/.password-space)
  --value <text>         Secret value for set (prefer prompt)
  --tags <a,b,c>         Tags for set
  --notes <text>         Notes for set
  --tag <tag>            Filter list by tag
  --json                 Machine-readable output
  --yes                  Skip confirm prompts where safe

${RUN_USAGE}

Environment:
  PASSWORD_SPACE_HOME      Same as --data-dir
  PASSWORD_SPACE_STORAGE   auto (default) | keychain | file \u2014 backend for a new store

Store: ~/.password-space/secrets.json holds names, tags and notes (mode 0600).
Values live in the macOS Keychain, Windows Credential Manager or Linux Secret
Service. Without one, they fall back to secrets.json in plain text.
Agents use secrets by name (run / inject_secret) \u2014 never paste secrets in chat.
`);
}
function describeStorage(info) {
  if (info.backend === "keychain") return `OS keychain (${info.keychain})`;
  if (info.backend === "file") return "secrets.json \u2014 plain text on disk (no OS keychain in use)";
  return "not created";
}
function storeSnapshot(dataDir) {
  const store = openVault({ dataDir });
  const initialized = store.isInitialized();
  const secretCount = initialized ? store.listSecrets().length : 0;
  const storage = store.storageInfo();
  store.close();
  return {
    initialized,
    secretCount,
    storePath: secretsStorePath(dataDir),
    legacyEncrypted: hasLegacyEncryptedVault(dataDir),
    storage
  };
}
function printLegacyHint(dataDir) {
  if (!hasLegacyEncryptedVault(dataDir)) return;
  console.log(`
Note: A legacy encrypted vault.db was found at ${vaultDbPath(dataDir)}.
It is left untouched. Re-add secrets with \`${selfCmd()} set\` into the new plain store.
`);
}
async function runSetupWizard(dataDir, flags = {}) {
  console.log(`
Password Space \u2014 setup
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
\u2022 Store home: ${dataDir}
\u2022 Names and tags: secrets.json \xB7 values: your OS keychain
\u2022 No passphrase / unlock session required
\u2022 Name secrets in Terminal; ask the agent to use them by name
`);
  const store = openVault({ dataDir });
  const wasInit = store.isInitialized();
  store.ensure();
  const info = store.storageInfo();
  const count = store.listSecrets().length;
  store.close();
  console.log(`${wasInit ? "\u2713 Store already exists" : "\u2713 Store created"} at ${secretsStorePath(dataDir)}`);
  console.log(`  Values: ${describeStorage(info)}`);
  if (info.fallback_reason) {
    console.log(`  (No usable keychain: ${info.fallback_reason})`);
  }
  if (info.migration_available) {
    console.log(`
${count} secret value(s) are stored in plain text in secrets.json, and this machine has a keychain.`);
    const move = flags.yes || !input.isTTY ? false : /^(y|yes|)$/i.test(await promptVisible("Move them into the OS keychain now? [Y/n]: "));
    if (move) {
      await runMigrate(dataDir, { to: "keychain" });
    } else {
      console.log(`  Later: ${selfCmd()} migrate`);
    }
  }
  printLegacyHint(dataDir);
  console.log(`
Next (still in Terminal \u2014 never paste values in chat):
  ${selfCmd()} set
  # or: ${selfCmd()}   \u2192 interactive menu

Back in your agent:
  \u2022 vault_status / list_secrets
  \u2022 ${selfCmd()} run -s NAME -- <command>   (secret goes into the command's env)
`);
}
async function runMigrate(dataDir, opts) {
  const store = openVault({ dataDir });
  if (!store.isInitialized()) {
    store.close();
    throw new VaultError("Store not initialized. Run: password-space setup", "NOT_INITIALIZED");
  }
  const result = store.migrate(opts.to);
  const info = store.storageInfo();
  store.close();
  if (opts.json) {
    console.log(JSON.stringify({ ...result, storage: info }, null, 2));
    return;
  }
  if (result.moved === 0 && result.from === result.to) {
    console.log(`\u2713 Values are already in ${describeStorage(info)}.`);
    return;
  }
  console.log(`\u2713 Moved ${result.moved} value(s): ${result.from} \u2192 ${result.to}.`);
  console.log(`  Values: ${describeStorage(info)}`);
  if (opts.to === "keychain") {
    console.log("  secrets.json now holds names, tags and notes only.");
  }
}
async function runStatus(dataDir, flags) {
  const snap = storeSnapshot(dataDir);
  const status = {
    dataDir,
    storePath: snap.storePath,
    initialized: snap.initialized,
    secretCount: snap.secretCount,
    storage: snap.storage.backend,
    values: snap.storage,
    legacy_encrypted_db: snap.legacyEncrypted,
    legacy_db_path: snap.legacyEncrypted ? vaultDbPath(dataDir) : null
  };
  if (flags.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(`data dir:     ${status.dataDir}`);
  console.log(`store:        ${status.storePath}`);
  console.log(`initialized:  ${status.initialized}`);
  console.log(`values:       ${describeStorage(snap.storage)}`);
  console.log(`secrets:      ${status.secretCount}`);
  if (snap.storage.migration_available) {
    console.log(`tip:          ${selfCmd()} migrate   (move values into the OS keychain)`);
  }
  if (status.legacy_encrypted_db) {
    console.log(`legacy db:    ${status.legacy_db_path} (untouched \u2014 re-add via set)`);
  }
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
  const store = openVault({ dataDir });
  store.ensure();
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
    console.log(`  Value was not printed. Agents: ${selfCmd()} run -s ${meta.name} -- <command>`);
  }
}
async function runRemove(dataDir, args) {
  const store = openVault({ dataDir });
  if (!store.isInitialized()) {
    store.close();
    throw new VaultError("Store not initialized. Run: password-space setup", "NOT_INITIALIZED");
  }
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
function canRevealInTerminal(stdin = input, stdout = output) {
  return stdin.isTTY === true && stdout.isTTY === true;
}
async function runGet(dataDir, args) {
  const name = args.positional[0];
  if (!name) throw new VaultError("Usage: password-space get <name>", "INVALID");
  if (!canRevealInTerminal()) {
    throw new VaultError(
      `get only prints a value to an interactive terminal, so agents and scripts cannot read it.
Use the secret by name instead: ${selfCmd()} run -s ${JSON.stringify(name)} -- <command>`,
      "INVALID"
    );
  }
  const store = openVault({ dataDir });
  if (!store.isInitialized()) {
    store.close();
    throw new VaultError("Store not initialized. Run: password-space setup", "NOT_INITIALIZED");
  }
  const meta = store.getMetadata(name);
  const confirm = await promptVisible(`Show the value of "${meta.name}" on screen? [y/N]: `);
  if (!/^y(es)?$/i.test(confirm)) {
    store.close();
    console.log("Cancelled.");
    return;
  }
  const secret = store.getSecret(name, "human-cli");
  store.close();
  if (args.flags.json) {
    console.log(JSON.stringify(secret, null, 2));
  } else {
    output.write(`${secret.value}
`);
  }
}
async function runList(dataDir, flags) {
  const store = openVault({ dataDir });
  if (!store.isInitialized()) {
    store.close();
    console.log("(no store yet \u2014 run setup or set)");
    return;
  }
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
    const snap = storeSnapshot(dataDir);
    console.log(`
Password Space
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Store:  ${dataDir}
Status: ${snap.initialized ? `ready \xB7 ${snap.secretCount} secret(s)` : "not created"} \xB7 values: ${describeStorage(snap.storage)}

  1) Setup / ensure store
  2) Add secret
  3) Remove secret
  4) List secrets
  5) Status
  6) Quit
`);
    const choice = await promptVisible("Choose [1-6]: ");
    try {
      switch (choice) {
        case "1":
          await runSetupWizard(dataDir, flags);
          break;
        case "2":
          await runSet(dataDir, { command: "set", positional: [], flags });
          break;
        case "3":
          await runRemove(dataDir, { command: "remove", positional: [], flags });
          break;
        case "4":
          await runList(dataDir, flags);
          break;
        case "5":
          await runStatus(dataDir, flags);
          break;
        case "6":
        case "q":
        case "quit":
        case "exit":
          console.log("Bye.");
          return;
        default:
          console.log("Enter a number 1\u20136.");
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
  const dataDir = args.command === "run" ? defaultDataDir() : dataDirFrom(args.flags);
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
      case "init":
        await runSetupWizard(dataDir, args.flags);
        break;
      case "migrate": {
        const to = args.flags.to ?? "keychain";
        if (to !== "keychain" && to !== "file") {
          throw new VaultError("Usage: password-space migrate [--to keychain|file]", "INVALID");
        }
        await runMigrate(dataDir, { to, json: Boolean(args.flags.json) });
        break;
      }
      case "run": {
        const code = await runWithSecrets(dataDir, parseRunArgs(process.argv.slice(3)));
        exit(code);
      }
      case "onboard": {
        const snap = storeSnapshot(dataDir);
        if (!snap.initialized) {
          console.log("Password Space \u2014 next step\n");
          console.log("  Open Terminal and run (plugin-bundled CLI \u2014 no clone):");
          console.log('    node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup');
          console.log(`    (or: ${selfCmd()} setup)`);
          console.log("\n  Then add a named secret:");
          console.log('    node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" set');
          break;
        }
        console.log('Store ready. Next: node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" set');
        console.log("  Or run without args for the interactive menu.");
        console.log("  Then in your agent: vault_status / list_secrets, and run -s NAME -- <command>");
        printLegacyHint(dataDir);
        break;
      }
      case "unlock":
      case "lock":
      case "change-passphrase":
        console.log(`${command} is no longer needed: there is no passphrase or unlock session.`);
        break;
      case "status":
        await runStatus(dataDir, args.flags);
        break;
      case "set":
      case "add":
        await runSet(dataDir, args);
        break;
      case "get":
        await runGet(dataDir, args);
        break;
      case "list":
        await runList(dataDir, args.flags);
        break;
      case "delete":
      case "rm":
      case "remove":
        await runRemove(dataDir, args);
        break;
      case "audit": {
        const store = openVault({ dataDir });
        if (!store.isInitialized()) {
          store.close();
          console.log("(no store yet)");
          break;
        }
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
