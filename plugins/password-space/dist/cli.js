#!/usr/bin/env node

// packages/cli/src/index.ts
import { createInterface } from "node:readline";
import { stdin as input, stdout as output, exit } from "node:process";

// packages/vault/dist/crypto.js
var SCRYPT_N = 2 ** 15;

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
import { chmodSync, existsSync as existsSync2, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
var STORE_VERSION = 1;
var VaultStore = class {
  storePath;
  /** @deprecated Prefer storePath — kept for MCP/CLI status fields. */
  dbPath;
  data = null;
  constructor(storePath) {
    this.storePath = storePath;
    this.dbPath = storePath;
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
  getMeta() {
    if (!this.data)
      return null;
    return {
      storeVersion: this.data.version,
      createdAt: this.data.createdAt,
      storage: "plain-json"
    };
  }
  /**
   * Create an empty store. Passphrase is ignored (soft-compat with old MCP tools).
   */
  async init(_passphrase) {
    if (this.isInitialized()) {
      throw new VaultError("Store already initialized", "ALREADY_INITIALIZED");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.data = { version: STORE_VERSION, createdAt: now, secrets: [] };
    this.persist();
    this.audit("init", null, null, "human", "plain-json store created");
  }
  /** Ensure the store file exists (setup / first use). */
  ensure() {
    if (!this.isInitialized()) {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      this.data = { version: STORE_VERSION, createdAt: now, secrets: [] };
      this.persist();
      this.audit("init", null, null, "human", "plain-json store created");
    } else if (!this.data) {
      this.data = this.readFile();
    }
  }
  /** Always true for the plain store once initialized (no unlock gate). */
  get isUnlocked() {
    return this.isInitialized();
  }
  /**
   * Soft-compat: no-op unlock. Returns an empty buffer (no vault key).
   */
  async unlock(_passphrase) {
    if (!this.isInitialized()) {
      throw new VaultError("Store not initialized. Run: password-space setup", "NOT_INITIALIZED");
    }
    this.data = this.readFile();
    this.audit("unlock", null, null, "human", "noop \u2014 plain store needs no unlock");
    return Buffer.alloc(0);
  }
  /** Soft-compat: no vault key to restore. */
  unlockWithKey(_vaultKey) {
    if (!this.isInitialized()) {
      throw new VaultError("Store not initialized", "NOT_INITIALIZED");
    }
    this.data = this.readFile();
  }
  /** Soft-compat: no-op (nothing to lock). */
  lock() {
  }
  /**
   * Soft-compat: passphrase change is not applicable.
   */
  async changePassphrase(_currentPassphrase, _nextPassphrase) {
    throw new VaultError("Passphrases are not used. The store is local plain text \u2014 lock/unlock/change-passphrase are not needed.", "DEPRECATED");
  }
  requireReady() {
    if (!this.isInitialized() || !this.data) {
      throw new VaultError("Store not initialized. Run: password-space setup (or set)", "NOT_INITIALIZED");
    }
    return this.data;
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
    this.audit("get", row.id, row.name, actor, null);
    return { ...this.rowToMeta(row), value: row.value };
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
    if (existing) {
      const conflict = data.secrets.find((s) => s.id !== existing.id && s.name.toLowerCase() === name.toLowerCase());
      if (conflict)
        throw new VaultError(`Secret name already exists: ${name}`, "DUPLICATE_NAME");
      existing.name = name;
      existing.value = input2.value;
      existing.tags = tags;
      existing.notes = notes;
      existing.updatedAt = now;
      this.persist();
      this.audit("update", existing.id, name, "human", null);
      return this.getMetadata(existing.id);
    }
    const dup = data.secrets.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (dup)
      throw new VaultError(`Secret name already exists: ${name}`, "DUPLICATE_NAME");
    const id = input2.id ?? randomUUID();
    data.secrets.push({
      id,
      name,
      value: input2.value,
      tags,
      notes,
      createdAt: now,
      updatedAt: now
    });
    this.persist();
    this.audit("create", id, name, "human", null);
    return this.getMetadata(id);
  }
  deleteSecret(idOrName) {
    const data = this.requireReady();
    const row = this.findRow(idOrName);
    if (!row)
      throw new VaultError(`Secret not found: ${idOrName}`, "NOT_FOUND");
    data.secrets = data.secrets.filter((s) => s.id !== row.id);
    this.persist();
    this.audit("delete", row.id, row.name, "human", null);
  }
  listAudit(limit = 50) {
    const logPath = auditLogPath(dirname(this.storePath));
    if (!existsSync2(logPath))
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
    return {
      version: Number(parsed.version) || STORE_VERSION,
      createdAt: parsed.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      secrets: parsed.secrets.map((s) => ({
        id: String(s.id),
        name: String(s.name),
        value: String(s.value ?? ""),
        tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
        notes: s.notes == null ? null : String(s.notes),
        createdAt: String(s.createdAt ?? ""),
        updatedAt: String(s.updatedAt ?? "")
      }))
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
    return existsSync2(storePath);
  }
};

// packages/vault/dist/session.js
var DEFAULT_TTL_MS = 8 * 60 * 60 * 1e3;
var SESSION_TTL_1_DAY_MS = 24 * 60 * 60 * 1e3;
var SESSION_TTL_1_WEEK_MS = 7 * 24 * 60 * 60 * 1e3;

// packages/vault/dist/inject.js
var DEFAULT_INJECT_TTL_MS = 5 * 60 * 1e3;

// packages/vault/dist/index.js
function openVault(opts = {}) {
  const dataDir = opts.dataDir ?? defaultDataDir();
  return new VaultStore(secretsStorePath(dataDir));
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
  console.log(`password-space \u2014 local plain-text named secrets (Terminal for humans, MCP for agents)

Usage:
  password-space                 Interactive menu (TTY)
  password-space <command> [options]

Commands:
  setup | init           Ensure the local store exists (no passphrase)
  status                 Store status
  set | add [name]       Store or update a secret (hidden value)
  remove | delete | rm   Delete a secret (prompts for name)
  list                   List secret names only (no values)
  menu | interactive     Full interactive menu
  onboard                Print next Terminal step
  get <name>             Print secret value (human only \u2014 not for agents)
  audit                  Recent access events (no values)
  unlock | lock          No-ops (kept for compatibility \u2014 not needed)
  help                   Show this help

Options:
  --data-dir, -d         Data directory (default: ~/.password-space)
  --value <text>         Secret value for set (prefer prompt)
  --tags <a,b,c>         Tags for set
  --notes <text>         Notes for set
  --tag <tag>            Filter list by tag
  --json                 Machine-readable output
  --yes                  Skip confirm prompts where safe

Environment:
  PASSWORD_SPACE_HOME           Same as --data-dir

Store file:  ~/.password-space/secrets.json  (mode 0600, plain values at rest)
Agents use MCP inject_secret / list_secrets by name \u2014 never paste secrets in chat.
Lock/unlock/passphrase are not part of the product path.
`);
}
function storeSnapshot(dataDir) {
  const store = openVault({ dataDir });
  const initialized = store.isInitialized();
  const secretCount = initialized ? store.listSecrets().length : 0;
  store.close();
  return {
    initialized,
    secretCount,
    storePath: secretsStorePath(dataDir),
    legacyEncrypted: hasLegacyEncryptedVault(dataDir)
  };
}
function printLegacyHint(dataDir) {
  if (!hasLegacyEncryptedVault(dataDir)) return;
  console.log(`
Note: A legacy encrypted vault.db was found at ${vaultDbPath(dataDir)}.
It is left untouched. Re-add secrets with \`${selfCmd()} set\` into the new plain store.
`);
}
async function runSetupWizard(dataDir) {
  console.log(`
Password Space \u2014 setup
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
\u2022 Store home: ${dataDir}
\u2022 Plain local files (secrets.json) \u2014 values readable at rest
\u2022 No passphrase / unlock session required
\u2022 Name secrets in Terminal; ask the agent to use them by name
`);
  const store = openVault({ dataDir });
  const wasInit = store.isInitialized();
  store.ensure();
  store.close();
  if (wasInit) {
    console.log(`\u2713 Store already exists at ${secretsStorePath(dataDir)}`);
  } else {
    console.log(`\u2713 Store created at ${secretsStorePath(dataDir)}`);
  }
  printLegacyHint(dataDir);
  console.log(`
Next (still in Terminal \u2014 never paste values in Cursor chat):
  ${selfCmd()} set
  # or: ${selfCmd()}   \u2192 interactive menu

Back in Cursor:
  \u2022 vault_status / list_secrets / inject_secret
`);
}
async function runStatus(dataDir, flags) {
  const snap = storeSnapshot(dataDir);
  const status = {
    dataDir,
    storePath: snap.storePath,
    initialized: snap.initialized,
    unlocked: true,
    secretCount: snap.secretCount,
    storage: "plain-json",
    lock_unlock_needed: false,
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
  console.log(`storage:      plain-json (no unlock)`);
  console.log(`secrets:      ${status.secretCount}`);
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
    console.log("  Value was not printed. In Cursor: list_secrets / inject_secret.");
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
Status: ${snap.initialized ? `ready \xB7 ${snap.secretCount} secret(s)` : "not created"} \xB7 plain text (no unlock)

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
          await runSetupWizard(dataDir);
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
      case "init":
        await runSetupWizard(dataDir);
        break;
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
        console.log("  Then in Cursor: vault_status / list_secrets / inject_secret");
        printLegacyHint(dataDir);
        break;
      }
      case "unlock":
        console.log("\u2713 Unlock not needed \u2014 the store is local plain text.");
        console.log("  Add secrets with set; agents use inject_secret by name.");
        break;
      case "lock":
        console.log("\u2713 Lock not needed \u2014 the store stays readable locally.");
        console.log("  (No unlock session is used.)");
        break;
      case "change-passphrase":
        console.log("Passphrases are not used. The store is local plain text.");
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
        const store = openVault({ dataDir });
        if (!store.isInitialized()) {
          store.close();
          throw new VaultError("Store not initialized. Run: password-space setup", "NOT_INITIALIZED");
        }
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
