#!/usr/bin/env node
import { createInterface } from "node:readline";
import { stdin as input, stdout as output, exit } from "node:process";
import {
  VaultError,
  defaultDataDir,
  hasLegacyEncryptedVault,
  openVault,
  secretsStorePath,
  vaultDbPath,
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
      rl.once("close", () => reject(new Error("No value on stdin")));
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
  console.log(`password-space — local plain-text named secrets (Terminal for humans, MCP for agents)

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
  get <name>             Print secret value (human only — not for agents)
  audit                  Recent access events (no values)
  unlock | lock          No-ops (kept for compatibility — not needed)
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
Agents use MCP inject_secret / list_secrets by name — never paste secrets in chat.
Lock/unlock/passphrase are not part of the product path.
`);
}

function storeSnapshot(dataDir: string): {
  initialized: boolean;
  secretCount: number;
  storePath: string;
  legacyEncrypted: boolean;
} {
  const store = openVault({ dataDir });
  const initialized = store.isInitialized();
  const secretCount = initialized ? store.listSecrets().length : 0;
  store.close();
  return {
    initialized,
    secretCount,
    storePath: secretsStorePath(dataDir),
    legacyEncrypted: hasLegacyEncryptedVault(dataDir),
  };
}

function printLegacyHint(dataDir: string): void {
  if (!hasLegacyEncryptedVault(dataDir)) return;
  console.log(`
Note: A legacy encrypted vault.db was found at ${vaultDbPath(dataDir)}.
It is left untouched. Re-add secrets with \`${selfCmd()} set\` into the new plain store.
`);
}

async function runSetupWizard(dataDir: string): Promise<void> {
  console.log(`
Password Space — setup
──────────────────────
• Store home: ${dataDir}
• Plain local files (secrets.json) — values readable at rest
• No passphrase / unlock session required
• Name secrets in Terminal; ask the agent to use them by name
`);

  const store = openVault({ dataDir });
  const wasInit = store.isInitialized();
  store.ensure();
  store.close();
  if (wasInit) {
    console.log(`✓ Store already exists at ${secretsStorePath(dataDir)}`);
  } else {
    console.log(`✓ Store created at ${secretsStorePath(dataDir)}`);
  }
  printLegacyHint(dataDir);

  console.log(`
Next (still in Terminal — never paste values in Cursor chat):
  ${selfCmd()} set
  # or: ${selfCmd()}   → interactive menu

Back in Cursor:
  • vault_status / list_secrets / inject_secret
`);
}

async function runStatus(
  dataDir: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
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
    legacy_db_path: snap.legacyEncrypted ? vaultDbPath(dataDir) : null,
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
    console.log(`legacy db:    ${status.legacy_db_path} (untouched — re-add via set)`);
  }
}

async function runSet(dataDir: string, args: Args): Promise<void> {
  let name = args.positional[0];
  let value: string | undefined =
    typeof args.flags.value === "string" ? args.flags.value : undefined;

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
  const store = openVault({ dataDir });
  store.ensure();
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

async function runRemove(dataDir: string, args: Args): Promise<void> {
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
  const store = openVault({ dataDir });
  if (!store.isInitialized()) {
    store.close();
    console.log("(no store yet — run setup or set)");
    return;
  }
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
    const snap = storeSnapshot(dataDir);
    console.log(`
Password Space
──────────────
Store:  ${dataDir}
Status: ${snap.initialized ? `ready · ${snap.secretCount} secret(s)` : "not created"} · plain text (no unlock)

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
          console.log("Enter a number 1–6.");
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
          console.log("Password Space — next step\n");
          console.log("  Open Terminal and run (plugin-bundled CLI — no clone):");
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
        console.log("✓ Unlock not needed — the store is local plain text.");
        console.log("  Add secrets with set; agents use inject_secret by name.");
        break;

      case "lock":
        console.log("✓ Lock not needed — the store stays readable locally.");
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
