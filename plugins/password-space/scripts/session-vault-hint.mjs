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
        "Password Space: store not set up — run /setup-password-space, call vault_onboard, follow primary_action (Terminal: node \"${CURSOR_PLUGIN_ROOT}/dist/cli.js\" setup, then set — no clone, no passphrase, no unlock). Never ask for secret values in chat. Do not use App forms. Do not ask the user to edit mcp.json.",
    }),
  );
}

main();
