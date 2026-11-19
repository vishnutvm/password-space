#!/usr/bin/env node
/**
 * SessionStart hook for Claude Code and Codex (`--host codex`). Both hosts read
 * hookSpecificOutput.additionalContext.
 *   - No store: tell the agent to run setup itself (setup_vault).
 *   - Store exists: list the saved secret NAMES so a new session uses them by
 *     name instead of asking again or reading a same-named shell variable.
 * Only names are read from secrets.json; values are never read or printed.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const codex = process.argv.includes("--host") && process.argv[process.argv.indexOf("--host") + 1] === "codex";

function dataDir() {
  const raw = process.env.PASSWORD_SPACE_HOME?.trim();
  if (!raw || /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(raw)) {
    return join(homedir(), ".password-space");
  }
  return raw;
}

const MAX_NAMES = 50;

/** Secret names from secrets.json (names only; anything odd is skipped). */
function savedNames(storePath) {
  try {
    const doc = JSON.parse(readFileSync(storePath, "utf8"));
    const list = Array.isArray(doc?.secrets) ? doc.secrets : [];
    return list
      .map((s) => (typeof s?.name === "string" ? s.name : ""))
      // eslint-disable-next-line no-control-regex
      .filter((n) => n && n.length <= 128 && !/[\u0000-\u001f\u007f]/.test(n));
  } catch {
    return [];
  }
}

function emit(additionalContext) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
}

const dir = dataDir();
const storePath = join(dir, "secrets.json");
const root = process.env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = `node "${join(root, "dist", "cli.js")}"`;

if (existsSync(storePath)) {
  const names = savedNames(storePath);
  if (names.length > 0) {
    const shown = names.slice(0, MAX_NAMES).join(", ");
    const more = names.length > MAX_NAMES ? ` (and ${names.length - MAX_NAMES} more; see list_secrets)` : "";
    emit(
      `Password Space: the user's vault has saved secrets named ${shown}${more}. ` +
        `When a task needs one, use it by name: ${cli} run -s NAME -- <command> (the value goes into that command's env and its output is redacted). ` +
        `Do not ask the user for these again, and do not read a same-named variable from the shell environment instead. ` +
        `Save a new key the user hands over with store_secret; remove one with remove_secret. Never repeat secret values.`,
    );
  }
} else {
  const start = codex
    ? "call the password-space MCP tool setup_vault yourself"
    : "call the password-space MCP tool setup_vault yourself (or run /password-space:setup-password-space)";
  emit(
    `Password Space: no secret store yet. If the user wants to set it up, or hands you a key to save, ${start}. ` +
      `Do not ask the user to paste a Terminal command. If the MCP tool is unavailable and Node.js 20+ is installed, run ${cli} setup --yes with Bash. ` +
      `Never repeat secret values. No passphrase or unlock is needed.`,
  );
}
