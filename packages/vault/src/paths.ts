import { homedir } from "node:os";
import { join } from "node:path";

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PASSWORD_SPACE_HOME) {
    return env.PASSWORD_SPACE_HOME;
  }
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
