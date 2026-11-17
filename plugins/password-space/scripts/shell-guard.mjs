#!/usr/bin/env node
/**
 * Tool hook for Claude Code (PreToolUse on Bash / Read / Grep) and Cursor
 * (beforeShellExecution / beforeReadFile): stops an agent from reading secret
 * values around Password Space instead of using them by name.
 *
 * Blocked:
 *   - `password-space get` / `cli.js get` (the CLI also refuses without a TTY)
 *   - direct keychain reads: `security find-generic-password`, `security dump-keychain`,
 *     `secret-tool lookup|search`, Windows `CredRead` / `Get-StoredCredential` / `PasswordVault`
 *   - reading inject/*.env files, except sourcing them (`. FILE` / `source FILE`)
 *   - reading secrets.json in the store directory
 *
 * This is a guard rail for an agent that tries the obvious commands, not a
 * sandbox: an agent with a shell can still obfuscate a command (variables,
 * base64, a script file) or source an inject file and print the variable.
 * See SECURITY.md, "What an agent with shell access can still do".
 *
 * Output by host (auto-detected from hook_event_name, or --format cursor|claude):
 *   claude: reason on stderr, exit 2 (Claude Code blocks the tool call and tells the agent)
 *   cursor: stdout {"permission": "deny", ...}, exit 2; allow prints {"permission": "allow"}
 * If the guard itself fails, the call is allowed and a warning goes to stderr.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Same rule as the vault's defaultDataDir: PASSWORD_SPACE_HOME or ~/.password-space. */
export function guardDataDir(env = process.env) {
  const raw = (env.PASSWORD_SPACE_HOME ?? "").trim();
  if (raw && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(raw)) return resolve(raw);
  return join(homedir(), ".password-space");
}

const RUN_HINT =
  "Use the secret by name instead: password-space run -s NAME -- <command> (or the inject_secret MCP tool).";

const COMMAND_RULES = [
  {
    re: /(?:password-space|cli\.m?js)["']?\s+get\b/i,
    why: "`password-space get` prints a secret value",
  },
  {
    re: /\b(?:find-generic-password|find-internet-password|dump-keychain)\b/i,
    why: "reading values straight from the macOS keychain bypasses Password Space",
  },
  {
    re: /\bsecret-tool\b[^\n;|&]*\b(?:lookup|search)\b/i,
    why: "reading values straight from the Linux Secret Service bypasses Password Space",
  },
  {
    re: /\b(?:CredReadW?|Get-StoredCredential|PasswordVault)\b/i,
    why: "reading values straight from Windows Credential Manager bypasses Password Space",
  },
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Spellings an agent might use for the store directory in a command. */
function dataDirSpellings(dataDir) {
  const home = homedir();
  const out = new Set([dataDir, dataDir.replace(/\\/g, "/")]);
  if (dataDir.startsWith(home)) {
    const rest = dataDir.slice(home.length);
    out.add(`~${rest}`);
    out.add(`$HOME${rest}`);
    out.add(`\${HOME}${rest}`);
  }
  out.add(".password-space");
  out.add("$PASSWORD_SPACE_HOME");
  out.add("${PASSWORD_SPACE_HOME}");
  return [...out].filter(Boolean);
}

function storePathRe(dataDir, leaf) {
  const dirs = dataDirSpellings(dataDir).map(escapeRe).join("|");
  return new RegExp(`(?:${dirs})["']?[\\\\/]+["']?${leaf}`, "gi");
}

/**
 * Decide whether a shell command may run.
 * @returns {{ blocked: false } | { blocked: true, reason: string }}
 */
export function checkCommand(command, { dataDir = guardDataDir() } = {}) {
  if (typeof command !== "string" || !command.trim()) return { blocked: false };
  for (const rule of COMMAND_RULES) {
    if (rule.re.test(command)) return { blocked: true, reason: `${rule.why}. ${RUN_HINT}` };
  }

  // secrets.json: names only with a keychain, but values with the file fallback.
  const mentionsStoreDir = dataDirSpellings(dataDir).some((d) => command.includes(d));
  if (storePathRe(dataDir, "secrets\\.json").test(command) || (mentionsStoreDir && /\bsecrets\.json\b/.test(command))) {
    return {
      blocked: true,
      reason: `the Password Space store file is off limits to agents (it can hold values). Use the list_secrets MCP tool for names. ${RUN_HINT}`,
    };
  }

  // inject/*.env: only `. FILE` or `source FILE` (load into the env of the same command).
  const injectRe = storePathRe(dataDir, "inject\\b[^\\s;|&'\"]*");
  const bareInjectRe = /[\\/]inject[\\/][0-9a-f]{32}\.env\b/gi;
  const uses = [];
  for (const re of [injectRe, bareInjectRe]) {
    for (const m of command.matchAll(re)) uses.push(m.index);
  }
  if (mentionsStoreDir && /\binject\b/.test(command) && uses.length === 0) uses.push(command.search(/\binject\b/));
  for (const at of uses) {
    // Walk back to the start of the path argument and look at the word before it.
    let start = at;
    while (start > 0 && !/[\s;|&(]/.test(command[start - 1])) start--;
    const before = command.slice(0, start).replace(/\s+$/, "");
    if (!/(?:^|[\s;|&(])(?:source|\.)$/.test(before)) {
      return {
        blocked: true,
        reason: `inject files may only be sourced into a command (set -a; . FILE; set +a; <command>), never read or printed. ${RUN_HINT}`,
      };
    }
  }
  return { blocked: false };
}

/**
 * Decide whether a file read tool may open a path.
 * @returns {{ blocked: false } | { blocked: true, reason: string }}
 */
export function checkReadPath(path, { dataDir = guardDataDir() } = {}) {
  if (typeof path !== "string" || !path.trim()) return { blocked: false };
  const abs = resolve(path.replace(/^~(?=$|[\\/])/, homedir()));
  const base = resolve(dataDir);
  const inside = (p) => abs === p || abs.startsWith(p + "/") || abs.startsWith(p + "\\");
  if (inside(join(base, "inject"))) {
    return { blocked: true, reason: `inject files hold secret values and must not be read. ${RUN_HINT}` };
  }
  if (abs === join(base, "secrets.json") || abs === base) {
    return {
      blocked: true,
      reason: `the Password Space store is off limits to agents (it can hold values). Use the list_secrets MCP tool for names. ${RUN_HINT}`,
    };
  }
  return { blocked: false };
}

/** Pick what to check from a Claude Code or Cursor hook payload. */
export function checkHookInput(input, opts) {
  if (!input || typeof input !== "object") return { blocked: false };
  const tool = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  if (typeof input.command === "string") return checkCommand(input.command, opts); // Cursor shell
  if (typeof tool.command === "string") return checkCommand(tool.command, opts); // Claude Bash
  const path = input.file_path ?? tool.file_path ?? tool.path ?? tool.notebook_path;
  if (typeof path === "string") return checkReadPath(path, opts);
  return { blocked: false };
}

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  const i = process.argv.indexOf("--format");
  let input = null;
  try {
    input = JSON.parse(raw);
  } catch {
    // not JSON
  }
  const event = typeof input?.hook_event_name === "string" ? input.hook_event_name : "";
  const format = (i > 0 ? process.argv[i + 1] : undefined) ?? (event === "PreToolUse" ? "claude" : "cursor");

  let verdict = { blocked: false };
  try {
    verdict = checkHookInput(input);
  } catch (err) {
    console.error(`password-space shell guard: check skipped (${err instanceof Error ? err.message : err})`);
  }

  if (!verdict.blocked) {
    if (format === "cursor") process.stdout.write(JSON.stringify({ permission: "allow" }));
    process.exit(0);
  }
  const message = `Password Space blocked this: ${verdict.reason}`;
  if (format === "cursor") {
    process.stdout.write(
      JSON.stringify({
        permission: "deny",
        user_message: message,
        agent_message: message,
        userMessage: message,
        agentMessage: message,
      }),
    );
  } else {
    console.error(message);
  }
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
