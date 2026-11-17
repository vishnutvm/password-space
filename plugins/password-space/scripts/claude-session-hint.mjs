#!/usr/bin/env node
/**
 * SessionStart hook for Claude Code and Codex (`--host codex`): add a short setup
 * hint when the store is missing. Both hosts read hookSpecificOutput.additionalContext.
 * Reads only whether files exist — never secret values.
 */
import { existsSync } from "node:fs";
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

const dir = dataDir();
if (!existsSync(join(dir, "secrets.json"))) {
  const root = process.env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
  const cli = `node "${join(root, "dist", "cli.js")}"`;
  const start = codex
    ? "call the password-space MCP tool vault_onboard"
    : "run /password-space:setup-password-space (calls vault_onboard)";
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext:
          `Password Space: no secret store yet. If the user wants to use stored secrets, ${start}. ` +
          `The human step is Terminal only: ${cli} setup, then ${cli} set. ` +
          `Never ask for secret values in chat. No passphrase or unlock is needed.`,
      },
    }),
  );
}
