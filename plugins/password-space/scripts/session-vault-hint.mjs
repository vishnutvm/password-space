#!/usr/bin/env node
/**
 * sessionStart hook: gentle setup hint when the vault file is missing.
 * Does not read passphrases, secrets, or vault contents.
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
  const db = join(dataDir(), "vault.db");
  if (existsSync(db)) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }
  console.log(
    JSON.stringify({
      continue: true,
      additional_context: [
        "Password Space: no local vault yet on this machine.",
        "If the user wants credentials stored safely for the agent, run vault_onboard or use the /setup-password-space command.",
        "Passphrases and secret values must go in MCP tool approval forms or PASSWORD_SPACE_PASSPHRASE — never in chat.",
      ].join(" "),
    }),
  );
}

main();
