#!/usr/bin/env node
import { createInterface } from "node:readline";
import { stdin as input, stdout as output, exit } from "node:process";
import {
  VaultError,
  changeVaultPassphrase,
  defaultDataDir,
  formatSessionExpiry,
  hasValidSession,
  lockVaultSession,
  openVault,
  parseSessionTtlInput,
  readSession,
  sessionPath,
  unlockVaultToSession,
  vaultDbPath,
  type SessionTtlMs,
} from "@password-space/vault";

type Args = {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): Args {
  const [, , command = "", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
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

function dataDirFrom(flags: Record<string, string | boolean>): string {
  const d = flags["data-dir"] ?? flags.d;
  return typeof d === "string" ? d : defaultDataDir();
}

function selfCmd(): string {
  return process.argv[1] ? `node "${process.argv[1]}"` : "password-space";
}

async function promptVisible(question: string): Promise<string> {
  if (!input.isTTY) {
    const rl = createInterface({ input, output: undefined, terminal: false });
    return new Promise((resolve, reject) => {
      rl.once("line", (line) => {
        rl.close();
        resolve(line.trim());
      });
      rl.once("close", () => reject(new Error("No input on stdin")));
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

async function promptHidden(question: string): Promise<string> {
  if (!input.isTTY) {
    const rl = createInterface({ input, output: undefined, terminal: false });
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
    const onData = (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      for (const ch of s) {
        if (ch === "\n" || ch === "\r" || ch === "\u0004") {
          cleanup();
          output.write("\n");
          resolve(buf);
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          output.write("\n");
          reject(new Error("Interrupted"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
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

function printHelp(): void {
  console.log(`password-space — interactive Terminal vault (humans) + MCP for agents

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
  get <name>             Print secret value (human only — not for agents)
  audit                  Recent access events (no values)
  help                   Show this help

Session duration (unlock / setup / change-passphrase):
  Interactive prompt: 1 day · 1 week · until lock
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
Agents use MCP inject/list while the session is valid — no passphrase re-prompt.
`);
}

async function getPassphrase(flags: Record<string, string | boolean>, prompt: string): Promise<string> {
  if (typeof flags.passphrase === "string") return flags.passphrase;
  if (process.env.PASSWORD_SPACE_PASSPHRASE) return process.env.PASSWORD_SPACE_PASSPHRASE;
  return promptHidden(prompt);
}

async function promptNewPassphrase(
  flags: Record<string, string | boolean>,
): Promise<string> {
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

/**
 * Resolve unlock TTL: flag wins; otherwise interactive menu on TTY;
 * non-TTY / env scripts keep the 8h default.
 */
async function resolveSessionTtl(
  flags: Record<string, string | boolean>,
  opts: { askInteractively?: boolean } = {},
): Promise<SessionTtlMs> {
  if (flags.ttl !== undefined) {
    return parseSessionTtlInput(flags.ttl);
  }
  const ask = opts.askInteractively !== false && input.isTTY && !process.env.PASSWORD_SPACE_PASSPHRASE;
  if (!ask) {
    return parseSessionTtlInput(undefined);
  }
  console.log(`
How long should the vault stay unlocked?
  1) 1 day
  2) 1 week
  3) Until lock  (no auto-expiry — run lock when done)
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

function printUnlockResult(expiresAt: string | null, dataDir: string): void {
  console.log(`✓ Unlocked ${formatSessionExpiry(expiresAt)}`);
  console.log(`  Session: ${sessionPath(dataDir)} (mode 0600)`);
  console.log("  MCP agents can inject/list until expiry or you run lock.");
}

function vaultSnapshot(dataDir: string): {
  initialized: boolean;
  unlocked: boolean;
  session: boolean;
  expiresAt: string | null;
  untilLock: boolean;
  secretCount: number | null;
} {
  const store = openVault({ dataDir, useSession: true });
  const initialized = store.isInitialized();
  const unlocked = store.isUnlocked;
  const sp = sessionPath(dataDir);
  let session = false;
  let expiresAt: string | null = null;
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

async function runSetupWizard(
  dataDir: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
  console.log(`
Password Space — setup
──────────────────────
• Vault home: ${dataDir}
• Passphrase stays in Terminal — never in Cursor chat
• Unlock session: ~/.password-space/session (0600)
`);

  const probe = openVault({ dataDir, useSession: true });
  const initialized = probe.isInitialized();
  const needsUnlock = !probe.isUnlocked || !hasValidSession(sessionPath(dataDir));
  probe.close();

  let passphrase: string | undefined;
  if (!initialized) {
    passphrase = await promptNewPassphrase(flags);
    const store = openVault({ dataDir, useSession: false });
    await store.init(passphrase);
    store.close();
    console.log(`✓ Vault created at ${vaultDbPath(dataDir)}`);
  } else {
    console.log("✓ Vault already exists (not overwritten).");
  }

  if (!initialized || needsUnlock) {
    const ttlMs = await resolveSessionTtl(flags);
    const pass =
      passphrase ??
      (await getPassphrase(flags, "Unlock passphrase (hidden): "));
    const { expiresAt } = await unlockVaultToSession(pass, { dataDir, ttlMs });
    printUnlockResult(expiresAt, dataDir);
  } else {
    console.log("✓ Already unlocked.");
  }

  console.log(`
Next (still in Terminal — never paste values in Cursor chat):
  ${selfCmd()} set
  # or: ${selfCmd()}   → interactive menu

Back in Cursor after unlock:
  • vault_status / list_secrets / inject_secret
`);
}

async function runUnlock(
  dataDir: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
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

async function runLock(dataDir: string): Promise<void> {
  lockVaultSession({ dataDir });
  console.log("✓ Locked. Unlock session cleared.");
  console.log(`  (${sessionPath(dataDir)} removed)`);
}

async function runStatus(
  dataDir: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
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
    session_path: sessionPath(dataDir),
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

async function runChangePassphrase(
  dataDir: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const current = await getPassphrase(flags, "Current passphrase (hidden): ");
  const next = await promptNewPassphrase({});
  const ttlMs = await resolveSessionTtl(flags);
  const { expiresAt } = await changeVaultPassphrase(current, next, { dataDir, ttlMs });
  console.log("✓ Passphrase updated.");
  printUnlockResult(expiresAt, dataDir);
}

async function runSet(
  dataDir: string,
  args: Args,
): Promise<void> {
  let name = args.positional[0];
  let value: string | undefined =
    typeof args.flags.value === "string" ? args.flags.value : undefined;

  // Non-TTY: one stdin blob — optional first line = name when positional missing.
  if (!input.isTTY && value === undefined) {
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
  if (value === undefined) {
    value = await promptHidden(`Value for ${name} (hidden): `);
  }
  if (!value) {
    store.close();
    throw new VaultError("Secret value cannot be empty", "INVALID");
  }
  const tags =
    typeof args.flags.tags === "string"
      ? args.flags.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
  const notes = typeof args.flags.notes === "string" ? args.flags.notes : null;
  const meta = store.setSecret({ name, value, tags, notes });
  store.close();
  if (args.flags.json) {
    console.log(JSON.stringify(meta, null, 2));
  } else {
    console.log(`✓ Saved ${meta.name} (id ${meta.id})`);
    console.log("  Value was not printed. In Cursor: list_secrets / inject_secret.");
  }
}

async function runRemove(
  dataDir: string,
  args: Args,
): Promise<void> {
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
    for (const s of list) console.log(`  • ${s.name}`);
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
  console.log(`✓ Deleted ${name}`);
}

async function runList(
  dataDir: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const store = openVault({ dataDir, useSession: true });
  ensureUnlocked(store);
  const tag = typeof flags.tag === "string" ? flags.tag : undefined;
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

async function runInteractiveMenu(
  dataDir: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
  if (!input.isTTY) {
    printHelp();
    return;
  }

  for (;;) {
    const snap = vaultSnapshot(dataDir);
    const unlockLine = snap.session
      ? `unlocked · ${formatSessionExpiry(snap.expiresAt)}`
      : snap.initialized
        ? "locked"
        : "not created";
    console.log(`
Password Space
──────────────
Vault:  ${dataDir}
Status: ${unlockLine}${snap.secretCount !== null ? ` · ${snap.secretCount} secret(s)` : ""}

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
          console.log("Enter a number 1–9.");
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const dataDir = dataDirFrom(args.flags);
  let command = args.command;

  // Bare invocation → interactive menu on TTY
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
        // `init` alone creates without unlock when --no-unlock; keep setup as create+unlock.
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
          console.log("Password Space — next step\n");
          console.log("  Open Terminal and run (plugin-bundled CLI — no clone):");
          console.log('    node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup');
          console.log(`    (or: ${selfCmd()} setup)`);
          console.log("\n  You will choose unlock duration: 1 day · 1 week · until lock.");
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

function ensureUnlocked(store: ReturnType<typeof openVault>): void {
  if (!store.isInitialized()) {
    throw new VaultError("Vault not initialized. Run: password-space setup", "NOT_INITIALIZED");
  }
  if (!store.isUnlocked) {
    throw new VaultError("Vault is locked. Run: password-space unlock", "LOCKED");
  }
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    input.on("data", (c) => chunks.push(Buffer.from(c)));
    input.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    input.on("error", reject);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  exit(1);
});
