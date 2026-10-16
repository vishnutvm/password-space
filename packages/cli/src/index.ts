#!/usr/bin/env node
import { createInterface } from "node:readline";
import { stdin as input, stdout as output, exit } from "node:process";
import {
  VaultError,
  defaultDataDir,
  hasValidSession,
  lockVaultSession,
  openVault,
  sessionPath,
  unlockVaultToSession,
  vaultDbPath,
} from "@password-space/vault";

type Args = {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): Args {
  const [, , command = "help", ...rest] = argv;
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

async function promptHidden(question: string): Promise<string> {
  if (!input.isTTY) {
    // Non-interactive: read one line from stdin
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
  console.log(`password-space — local credential vault for humans & AI agents

Usage:
  password-space <command> [options]

Commands:
  init                 Create a new encrypted vault
  unlock               Unlock vault for this machine session
  lock                 Clear unlock session
  status               Show vault / lock status
  set <name>           Store or update a secret (prompts for value)
  get <name>           Print secret value (human only — not for agents)
  list                 List secret names / metadata (no values)
  delete <name>        Delete a secret
  audit                Show recent access events (no values)
  help                 Show this help

Options:
  --data-dir, -d       Vault data directory (default: ~/.password-space)
  --value <text>       Secret value for set (prefer prompt / stdin)
  --tags <a,b,c>       Comma-separated tags for set
  --notes <text>       Notes for set
  --tag <tag>          Filter list by tag
  --json               Machine-readable output where applicable
  --ttl <hours>        Unlock session TTL in hours (default: 8)

Environment:
  PASSWORD_SPACE_HOME  Same as --data-dir
  PASSWORD_SPACE_PASSPHRASE  Non-interactive unlock/init (CI / scripts)

Agents should use the MCP server — not \`get\` — so values stay out of chat.
`);
}

async function getPassphrase(flags: Record<string, string | boolean>, prompt: string): Promise<string> {
  if (typeof flags.passphrase === "string") return flags.passphrase;
  if (process.env.PASSWORD_SPACE_PASSPHRASE) return process.env.PASSWORD_SPACE_PASSPHRASE;
  return promptHidden(prompt);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const dataDir = dataDirFrom(args.flags);

  try {
    switch (args.command) {
      case "help":
      case "--help":
      case "-h":
        printHelp();
        break;

      case "init": {
        const store = openVault({ dataDir, useSession: false });
        if (store.isInitialized()) {
          store.close();
          throw new VaultError("Vault already initialized", "ALREADY_INITIALIZED");
        }
        const pass = await getPassphrase(args.flags, "Create unlock passphrase: ");
        const confirm = process.env.PASSWORD_SPACE_PASSPHRASE
          ? pass
          : await getPassphrase({}, "Confirm passphrase: ");
        if (pass !== confirm) {
          store.close();
          throw new VaultError("Passphrases do not match", "INVALID");
        }
        await store.init(pass);
        store.close();
        console.log(`Vault initialized at ${vaultDbPath(dataDir)}`);
        console.log("Next: password-space unlock");
        break;
      }

      case "unlock": {
        const ttlHours = Number(args.flags.ttl ?? 8);
        const pass = await getPassphrase(args.flags, "Unlock passphrase: ");
        const { expiresAt } = await unlockVaultToSession(pass, {
          dataDir,
          ttlMs: ttlHours * 60 * 60 * 1000,
        });
        console.log(`Unlocked until ${expiresAt}`);
        console.log(`Session: ${sessionPath(dataDir)}`);
        break;
      }

      case "lock": {
        lockVaultSession({ dataDir });
        console.log("Locked. Unlock session cleared.");
        break;
      }

      case "status": {
        const store = openVault({ dataDir, useSession: true });
        const status = {
          dataDir,
          dbPath: vaultDbPath(dataDir),
          initialized: store.isInitialized(),
          unlocked: store.isUnlocked,
          session: hasValidSession(sessionPath(dataDir)),
          secretCount: store.isUnlocked ? store.listSecrets().length : null,
        };
        store.close();
        if (args.flags.json) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          console.log(`data dir:    ${status.dataDir}`);
          console.log(`initialized: ${status.initialized}`);
          console.log(`unlocked:    ${status.unlocked}`);
          console.log(`session:     ${status.session}`);
          if (status.secretCount !== null) console.log(`secrets:     ${status.secretCount}`);
        }
        break;
      }

      case "set": {
        const name = args.positional[0];
        if (!name) throw new VaultError("Usage: password-space set <name>", "INVALID");
        const store = openVault({ dataDir, useSession: true });
        ensureUnlocked(store);
        let value: string;
        if (typeof args.flags.value === "string") {
          value = args.flags.value;
        } else if (!input.isTTY) {
          value = await readAllStdin();
          value = value.replace(/\n$/, "");
        } else {
          value = await promptHidden(`Value for ${name}: `);
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
          console.log(`Saved ${meta.name} (${meta.id})`);
        }
        break;
      }

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

      case "list": {
        const store = openVault({ dataDir, useSession: true });
        ensureUnlocked(store);
        const tag = typeof args.flags.tag === "string" ? args.flags.tag : undefined;
        const list = store.listSecrets(tag);
        store.close();
        if (args.flags.json) {
          console.log(JSON.stringify(list, null, 2));
        } else if (list.length === 0) {
          console.log("(no secrets)");
        } else {
          for (const s of list) {
            const tags = s.tags.length ? ` [${s.tags.join(", ")}]` : "";
            console.log(`${s.name}${tags}  ${s.id}`);
          }
        }
        break;
      }

      case "delete":
      case "rm": {
        const name = args.positional[0];
        if (!name) throw new VaultError("Usage: password-space delete <name>", "INVALID");
        const store = openVault({ dataDir, useSession: true });
        ensureUnlocked(store);
        store.deleteSecret(name);
        store.close();
        console.log(`Deleted ${name}`);
        break;
      }

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
        console.error(`Unknown command: ${args.command}`);
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
    throw new VaultError("Vault not initialized. Run: password-space init", "NOT_INITIALIZED");
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
