#!/usr/bin/env node
/**
 * Claude Code SessionStart hook: add a short setup hint when the store is missing.
 * Reads only whether files exist — never secret values.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function dataDir() {
  const raw = process.env.PASSWORD_SPACE_HOME?.trim();
  if (!raw || /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(raw)) {
    return join(homedir(), ".password-space");
  }
  return raw;
}

const dir = dataDir();
if (!existsSync(join(dir, "secrets.json"))) {
  const root = process.env.CLAUDE_PLUGIN_ROOT || "<plugin root>";
  const cli = `node "${join(root, "dist", "cli.js")}"`;
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext:
          `Password Space: no secret store yet. If the user wants to use stored secrets, run /password-space:setup-password-space ` +
          `(calls vault_onboard). The human step is Terminal only: ${cli} setup, then ${cli} set. ` +
          `Never ask for secret values in chat. No passphrase or unlock is needed.`,
      },
    }),
  );
}
