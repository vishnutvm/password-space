// packages/vault/src/guard.ts
import { existsSync as existsSync3, readdirSync, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// packages/vault/src/paths.ts
import { homedir } from "node:os";
import { join } from "node:path";
var UNRESOLVED_ENV_PLACEHOLDER = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
function resolvePasswordSpaceHome(raw) {
  if (raw == null) return void 0;
  const trimmed = raw.trim();
  if (!trimmed) return void 0;
  if (trimmed === "${PASSWORD_SPACE_HOME}" || UNRESOLVED_ENV_PLACEHOLDER.test(trimmed)) {
    return void 0;
  }
  return trimmed;
}
function defaultDataDir(env = process.env) {
  const fromEnv = resolvePasswordSpaceHome(env.PASSWORD_SPACE_HOME);
  if (fromEnv) return fromEnv;
  return join(homedir(), ".password-space");
}
function secretsStorePath(dataDir) {
  return join(dataDir, "secrets.json");
}
function auditLogPath(dataDir) {
  return join(dataDir, "audit.jsonl");
}
function injectDir(dataDir) {
  return join(dataDir, "inject");
}

// packages/vault/src/store.ts
import {
  chmodSync,
  existsSync as existsSync2,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// packages/vault/src/keychain.ts
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// packages/vault/src/types.ts
var VaultError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "VaultError";
  }
};

// packages/vault/src/keychain.ts
var KEYCHAIN_SERVICE = "password-space";
var defaultRunner = (cmd, args, input) => {
  const r = spawnSync(cmd, args, {
    input: input ?? "",
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
  if (/^[\x20-\x7e]*$/.test(value) && !value.startsWith(MAC_B64_PREFIX)) return value;
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
  constructor(run = defaultRunner, keychainPath = process.env.PASSWORD_SPACE_MACOS_KEYCHAIN?.trim() || null, bin = "/usr/bin/security") {
    this.run = run;
    this.keychainPath = keychainPath;
    this.bin = bin;
    this.description = keychainPath ? `macOS Keychain (${keychainPath})` : "macOS Keychain";
  }
  kind = "macos-keychain";
  description;
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
    if (r.status === 44) return null;
    if (r.status !== 0) fail("read", this.description, r);
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
      throw new VaultError(
        `Secret is too long for the macOS Keychain helper (${Buffer.byteLength(value)} bytes, about ${MAC_MAX_VALUE_BYTES} allowed). Use PASSWORD_SPACE_STORAGE=file for very long values.`,
        "INVALID"
      );
    }
    const r = this.run(this.bin, ["-i"], line);
    if (r.status !== 0 || r.stderr.trim()) fail("write", this.description, r);
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
    if (r.status === 0 || r.status === 44) return;
    fail("delete", this.description, r);
  }
};
var LinuxSecretService = class {
  constructor(run = defaultRunner, bin = "secret-tool") {
    this.run = run;
    this.bin = bin;
  }
  kind = "linux-secret-service";
  description = "Secret Service (libsecret)";
  get(account) {
    assertSafeAccount(account);
    const r = this.run(this.bin, ["lookup", "service", KEYCHAIN_SERVICE, "account", account]);
    if (r.status === 0) return r.stdout;
    if (r.status === 1 && !r.stderr.trim() && !r.error) return null;
    fail("read", this.description, r);
  }
  set(account, value, label) {
    assertSafeAccount(account);
    const r = this.run(
      this.bin,
      ["store", `--label=${safeLabel(label)}`, "service", KEYCHAIN_SERVICE, "account", account],
      value
    );
    if (r.status !== 0) fail("write", this.description, r);
  }
  delete(account) {
    assertSafeAccount(account);
    const r = this.run(this.bin, ["clear", "service", KEYCHAIN_SERVICE, "account", account]);
    if (r.status === 0 || r.status === 1 && !r.stderr.trim() && !r.error) return;
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
  constructor(run = defaultRunner, bin = "powershell.exe") {
    this.run = run;
    this.bin = bin;
  }
  kind = "windows-credential-manager";
  description = "Windows Credential Manager";
  encoded = Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64");
  call(op, account, extra = {}) {
    const input = JSON.stringify({ op, target: `${KEYCHAIN_SERVICE}:${account}`, ...extra });
    const r = this.run(
      this.bin,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", this.encoded],
      input
    );
    if (r.status !== 0) fail(op, this.description, r);
    let parsed;
    try {
      parsed = JSON.parse(r.stdout.trim());
    } catch {
      fail(op, this.description, { ...r, stderr: "unexpected output" });
    }
    if (!parsed.ok) fail(op, this.description, { ...r, stderr: parsed.error ?? "unknown error" });
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
      throw new VaultError(
        `Secret is ${bytes.length} bytes; Windows Credential Manager allows at most ${WINDOWS_MAX_BLOB_BYTES}.`,
        "INVALID"
      );
    }
    this.call("set", account, { user: safeLabel(label), value: bytes.toString("base64") });
  }
  delete(account) {
    assertSafeAccount(account);
    this.call("delete", account);
  }
};
function onPath(bin) {
  const r = defaultRunner(process.platform === "win32" ? "where" : "which", [bin]);
  return r.status === 0;
}
function platformKeychain(platform = process.platform) {
  if (process.env.PASSWORD_SPACE_KEYCHAIN === "none") return null;
  if (platform === "darwin") {
    return existsSync("/usr/bin/security") ? new MacKeychain() : null;
  }
  if (platform === "win32") return new WindowsCredentialManager();
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
    if (back !== value) return { ok: false, reason: `${kc.description}: read-back mismatch` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// packages/vault/src/guard-core.ts
import { createHmac } from "node:crypto";
var GUARD_MIN_LENGTH = 6;
function mac(key, text) {
  return createHmac("sha256", key).update(text, "utf8").digest("hex").slice(0, 32);
}
function guardPrint(key, value) {
  if (value.length < GUARD_MIN_LENGTH) return void 0;
  return { len: value.length, mac: mac(key, value) };
}
var FULL_SCAN_BUDGET = 25e4;
var WORD = /[A-Za-z0-9]/;
function isBoundary(text, i) {
  return i === 0 || !WORD.test(text[i - 1]) || !WORD.test(text[i]);
}
var PromptGuard = class {
  constructor(values, prints, key, warnings = []) {
    this.key = key;
    this.warnings = warnings;
    this.values = values.filter((v) => v.value.length >= GUARD_MIN_LENGTH);
    if (key) {
      for (const p of prints) {
        if (p.len < GUARD_MIN_LENGTH) continue;
        let m = this.byLen.get(p.len);
        if (!m) this.byLen.set(p.len, m = /* @__PURE__ */ new Map());
        m.set(p.mac, p.name);
      }
    }
  }
  values;
  byLen = /* @__PURE__ */ new Map();
  /** Number of secrets this guard can detect. */
  get size() {
    let n = this.values.length;
    for (const m of this.byLen.values()) n += m.size;
    return n;
  }
  findHits(text) {
    const hits = [];
    for (const { name, value } of this.values) {
      let i = text.indexOf(value);
      while (i !== -1) {
        hits.push({ name, start: i, end: i + value.length });
        i = text.indexOf(value, i + 1);
      }
    }
    if (this.key && this.byLen.size > 0) {
      const full = text.length * this.byLen.size <= FULL_SCAN_BUDGET;
      for (const [len, macs] of this.byLen) {
        for (let i = 0; i + len <= text.length; i++) {
          if (!full && !isBoundary(text, i)) continue;
          const name = macs.get(mac(this.key, text.slice(i, i + len)));
          if (name !== void 0) hits.push({ name, start: i, end: i + len });
        }
      }
    }
    return hits.sort((a, b) => a.start - b.start || b.end - a.end);
  }
  /** Distinct names of secrets found in the text. */
  check(text) {
    return [...new Set(this.findHits(text).map((h) => h.name))];
  }
  redact(text, marker = "[REDACTED]") {
    const hits = this.findHits(text);
    if (hits.length === 0) return text;
    let out = "";
    let pos = 0;
    for (const h of hits) {
      if (h.end <= pos) continue;
      if (h.start > pos) out += text.slice(pos, h.start);
      if (h.start >= pos) out += marker;
      pos = h.end;
    }
    return out + text.slice(pos);
  }
};

// packages/vault/src/store.ts
var STORE_VERSION = 2;
function storagePreferenceFromEnv(env = process.env) {
  const raw = env.PASSWORD_SPACE_STORAGE?.trim().toLowerCase();
  if (raw === "keychain" || raw === "file") return raw;
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
    if (existsSync2(storePath)) {
      this.data = this.readFile();
    }
  }
  close() {
    this.data = this.isInitialized() ? this.readFile() : null;
  }
  isInitialized() {
    return existsSync2(this.storePath);
  }
  get backend() {
    return this.data?.backend ?? null;
  }
  getMeta() {
    if (!this.data) return null;
    return {
      storeVersion: this.data.version,
      createdAt: this.data.createdAt,
      storage: this.data.backend
    };
  }
  /** The keychain this store would use, without probing it. */
  keychain() {
    if (this.keychainOpt === void 0) this.keychainOpt = platformKeychain();
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
      if (!this.data) this.data = this.readFile();
      return;
    }
    const backend = this.chooseBackend();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.data = { version: STORE_VERSION, storeId: randomUUID(), createdAt: now, backend, secrets: [] };
    this.persist();
    if (backend === "keychain") this.hookKey(true);
    this.audit("init", null, null, "human", `store created (values in ${backend})`);
  }
  chooseBackend() {
    if (this.storagePref === "file") return "file";
    const kc = this.keychain();
    const probe = kc ? probeKeychain(kc) : { ok: false, reason: "no OS keychain found on this machine" };
    if (probe.ok) return "keychain";
    if (this.storagePref === "keychain") {
      throw new VaultError(
        `PASSWORD_SPACE_STORAGE=keychain but the keychain is not usable: ${probe.reason}`,
        "KEYCHAIN"
      );
    }
    this.fallbackReason = probe.reason;
    return "file";
  }
  requireReady() {
    if (!this.isInitialized() || !this.data) {
      throw new VaultError(
        "Store not initialized. Run: password-space setup (or set)",
        "NOT_INITIALIZED"
      );
    }
    return this.data;
  }
  requireKeychain() {
    const kc = this.keychain();
    if (!kc) {
      throw new VaultError(
        "This store keeps values in the OS keychain, but no keychain is available here. On Linux, install libsecret-tools and run a Secret Service (e.g. gnome-keyring).",
        "KEYCHAIN"
      );
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
    if (hex) return Buffer.from(hex, "hex");
    if (!create) return null;
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
    if (!tag) return metas;
    const needle = tag.toLowerCase();
    return metas.filter((m) => m.tags.some((t) => t.toLowerCase() === needle));
  }
  getMetadata(idOrName) {
    const row = this.findRow(idOrName);
    if (!row) throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    return this.rowToMeta(row);
  }
  getSecret(idOrName, actor = "human") {
    const row = this.findRow(idOrName);
    if (!row) throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    const value = this.readValue(row);
    this.audit("get", row.id, row.name, actor, null);
    return { ...this.rowToMeta(row), value };
  }
  readValue(row) {
    const data = this.requireReady();
    if (data.backend === "file") return row.value ?? "";
    const value = this.requireKeychain().get(this.account(row.id));
    if (value == null) {
      throw new VaultError(
        `The value for "${row.name}" is missing from the ${this.requireKeychain().description}. Set it again with: password-space set ${row.name}`,
        "KEYCHAIN"
      );
    }
    return value;
  }
  setSecret(input) {
    this.ensure();
    const data = this.requireReady();
    const name = input.name.trim();
    if (!name) throw new VaultError("Secret name is required", "INVALID");
    if (input.value === void 0 || input.value === null) {
      throw new VaultError("Secret value is required", "INVALID");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const tags = input.tags ?? [];
    const notes = input.notes ?? null;
    const existing = input.id ? this.findRow(input.id) : this.findRow(name);
    const dup = data.secrets.find(
      (s) => s.id !== existing?.id && s.name.toLowerCase() === name.toLowerCase()
    );
    if (dup) throw new VaultError(`Secret name already exists: ${name}`, "DUPLICATE_NAME");
    const row = existing ?? {
      id: input.id ?? randomUUID(),
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
    this.writeValue(row, input.value);
    if (!existing) data.secrets.push(row);
    this.persist();
    this.audit(existing ? "update" : "create", row.id, name, input.actor ?? "human", null);
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
  /** True when a secret with this exact id or (case-insensitive) name exists. */
  hasSecret(idOrName) {
    return this.findRow(idOrName) !== void 0;
  }
  deleteSecret(idOrName, actor = "human") {
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
  migrate(to) {
    const data = this.requireReady();
    const from = data.backend;
    if (from === to) return { moved: 0, from, to };
    if (to === "keychain") {
      const kc2 = this.requireKeychain();
      const probe = probeKeychain(kc2);
      if (!probe.ok) throw new VaultError(`Keychain not usable: ${probe.reason}`, "KEYCHAIN");
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
    if (prints.length === 0) return { backend: "keychain", key: null, prints };
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
    if (!existsSync2(logPath)) return [];
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
    if (byId) return byId;
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
        if (backend === "file") row.value = String(s.value ?? "");
        const g = s.guard;
        if (backend === "keychain" && g && typeof g.mac === "string" && typeof g.len === "number") {
          row.guard = { len: g.len, mac: g.mac };
        }
        return row;
      })
    };
  }
  persist() {
    if (!this.data) return;
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
    return existsSync2(storePath);
  }
};

// packages/vault/src/guard.ts
function injectFileValues(dataDir) {
  const dir = injectDir(dataDir);
  if (!existsSync3(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".env")) continue;
    let body;
    try {
      body = readFileSync2(join2(dir, file), "utf8");
    } catch {
      continue;
    }
    for (const line of body.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      let raw = line.slice(eq + 1).trim();
      if (raw.startsWith("'") && raw.endsWith("'")) {
        raw = raw.slice(1, -1).replace(/'\\''/g, "'");
      }
      if (raw) out.push({ name: line.slice(0, eq).trim(), value: raw });
    }
  }
  return out;
}
function loadPromptGuard(dataDir, opts = {}) {
  const warnings = [];
  const values = injectFileValues(dataDir);
  if (!existsSync3(secretsStorePath(dataDir))) return new PromptGuard(values, [], null, warnings);
  try {
    const store = new VaultStore(secretsStorePath(dataDir), opts);
    const m = store.guardMaterial();
    if (m.backend === "file") return new PromptGuard([...values, ...m.values], [], null, warnings);
    if (m.prints.length > 0 && !m.key) {
      warnings.push(
        `cannot check ${m.prints.length} keychain secret(s): ${m.error ?? "guard key missing from keychain (run: password-space set <any secret> to rebuild)"}`
      );
    }
    return new PromptGuard(values, m.prints, m.key, warnings);
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : String(err));
    return new PromptGuard(values, [], null, warnings);
  }
}
export {
  GUARD_MIN_LENGTH,
  PromptGuard,
  defaultDataDir,
  loadPromptGuard
};
