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
      additional_context:
        "Password Space: vault not set up — call vault_onboard and follow primary_action (prefer Terminal: password-space setup; never approve vault_init with empty {}).",
    }),
  );
}

main();
