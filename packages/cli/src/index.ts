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
  type StorageInfo,
} from "@password-space/vault";
import { parseRunArgs, runWithSecrets, RUN_USAGE } from "./run.js";

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
  console.log(`password-space — named secrets in your OS keychain (Terminal for humans, MCP for agents)

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
  get <name>             Print secret value (human only — not for agents)
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
  PASSWORD_SPACE_STORAGE   auto (default) | keychain | file — backend for a new store

Store: ~/.password-space/secrets.json holds names, tags and notes (mode 0600).
Values live in the macOS Keychain, Windows Credential Manager or Linux Secret
Service. Without one, they fall back to secrets.json in plain text.
Agents use secrets by name (run / inject_secret) — never paste secrets in chat.
`);
}

function describeStorage(info: StorageInfo): string {
  if (info.backend === "keychain") return `OS keychain (${info.keychain})`;
  if (info.backend === "file") return "secrets.json — plain text on disk (no OS keychain in use)";
  return "not created";
}

function storeSnapshot(dataDir: string): {
  initialized: boolean;
  secretCount: number;
  storePath: string;
  legacyEncrypted: boolean;
  storage: StorageInfo;
} {
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
    storage,
  };
}

function printLegacyHint(dataDir: string): void {
  if (!hasLegacyEncryptedVault(dataDir)) return;
  console.log(`
Note: A legacy encrypted vault.db was found at ${vaultDbPath(dataDir)}.
It is left untouched. Re-add secrets with \`${selfCmd()} set\` into the new plain store.
`);
}

async function runSetupWizard(
  dataDir: string,
  flags: Record<string, string | boolean> = {},
): Promise<void> {
  console.log(`
Password Space — setup
──────────────────────
• Store home: ${dataDir}
• Names and tags: secrets.json · values: your OS keychain
• No passphrase / unlock session required
• Name secrets in Terminal; ask the agent to use them by name
`);

  const store = openVault({ dataDir });
  const wasInit = store.isInitialized();
  store.ensure();
  const info = store.storageInfo();
  const count = store.listSecrets().length;
  store.close();
  console.log(`${wasInit ? "✓ Store already exists" : "✓ Store created"} at ${secretsStorePath(dataDir)}`);
  console.log(`  Values: ${describeStorage(info)}`);
  if (info.fallback_reason) {
    console.log(`  (No usable keychain: ${info.fallback_reason})`);
  }
  if (info.migration_available) {
    console.log(`
${count} secret value(s) are stored in plain text in secrets.json, and this machine has a keychain.`);
    const move =
      flags.yes || !input.isTTY
        ? false
        : /^(y|yes|)$/i.test(await promptVisible("Move them into the OS keychain now? [Y/n]: "));
    if (move) {
      await runMigrate(dataDir, { to: "keychain" });
    } else {
      console.log(`  Later: ${selfCmd()} migrate`);
    }
  }
  printLegacyHint(dataDir);

  console.log(`
Next (still in Terminal — never paste values in chat):
  ${selfCmd()} set
  # or: ${selfCmd()}   → interactive menu

Back in your agent:
  • vault_status / list_secrets
  • ${selfCmd()} run -s NAME -- <command>   (secret goes into the command's env)
`);
}

async function runMigrate(
  dataDir: string,
  opts: { to: "keychain" | "file"; json?: boolean },
): Promise<void> {
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
    console.log(`✓ Values are already in ${describeStorage(info)}.`);
    return;
  }
  console.log(`✓ Moved ${result.moved} value(s): ${result.from} → ${result.to}.`);
  console.log(`  Values: ${describeStorage(info)}`);
  if (opts.to === "keychain") {
    console.log("  secrets.json now holds names, tags and notes only.");
  }
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
    secretCount: snap.secretCount,
    storage: snap.storage.backend,
    values: snap.storage,
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
  console.log(`values:       ${describeStorage(snap.storage)}`);
  console.log(`secrets:      ${status.secretCount}`);
  if (snap.storage.migration_available) {
    console.log(`tip:          ${selfCmd()} migrate   (move values into the OS keychain)`);
  }
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
    console.log(`  Value was not printed. Agents: ${selfCmd()} run -s ${meta.name} -- <command>`);
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
Status: ${snap.initialized ? `ready · ${snap.secretCount} secret(s)` : "not created"} · values: ${describeStorage(snap.storage)}

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
  // `run` parses its own options: flags after `--` belong to the child command.
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
