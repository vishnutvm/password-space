import { homedir } from "node:os";
import { join } from "node:path";

/** Unresolved template like `${PASSWORD_SPACE_HOME}` left by hosts that do not substitute. */
const UNRESOLVED_ENV_PLACEHOLDER = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

/**
 * Normalize PASSWORD_SPACE_HOME from the environment.
 * Empty, unset, and unresolved `${VAR}` placeholders → undefined (caller uses default).
 */
export function resolvePasswordSpaceHome(
  raw: string | undefined | null,
): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (
    trimmed === "${PASSWORD_SPACE_HOME}" ||
    UNRESOLVED_ENV_PLACEHOLDER.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

/** Vault data directory: `$PASSWORD_SPACE_HOME` or `~/.password-space`. */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = resolvePasswordSpaceHome(env.PASSWORD_SPACE_HOME);
  if (fromEnv) return fromEnv;
  return join(homedir(), ".password-space");
}

export function vaultDbPath(dataDir: string): string {
  return join(dataDir, "vault.db");
}

export function sessionPath(dataDir: string): string {
  return join(dataDir, "session");
}

export function injectDir(dataDir: string): string {
  return join(dataDir, "inject");
}
