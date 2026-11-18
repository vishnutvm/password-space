#!/usr/bin/env node
/**
 * sessionStart hook: gentle setup hint when the plain store (secrets.json) is missing.
 * Only checks that the file exists — never reads secrets or store contents.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function dataDir() {
  const raw = process.env.PASSWORD_SPACE_HOME?.trim();
  if (
    !raw ||
    raw === "${PASSWORD_SPACE_HOME}" ||
    /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(raw)
  ) {
    return join(homedir(), ".password-space");
  }
  return raw;
}

function main() {
  const store = join(dataDir(), "secrets.json");
  if (existsSync(store)) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }
  console.log(
    JSON.stringify({
      continue: true,
      additional_context:
        "Password Space: store not set up. If the user wants to set it up, or hands you a key to save, call the password-space MCP tool setup_vault yourself (or run /setup-password-space). Do not ask the user to paste a Terminal command. Never repeat secret values. No passphrase or unlock. Do not ask the user to edit mcp.json.",
    }),
  );
}

main();
