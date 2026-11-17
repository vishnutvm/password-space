export * from "./paths.js";
export * from "./types.js";
export * from "./store.js";
export * from "./redact.js";
export * from "./inject.js";

import { VaultStore } from "./store.js";
import { defaultDataDir, secretsStorePath, vaultDbPath } from "./paths.js";

export type OpenVaultOptions = {
  dataDir?: string;
};

/** Open the secret store under the data directory. */
export function openVault(opts: OpenVaultOptions = {}): VaultStore {
  const dataDir = opts.dataDir ?? defaultDataDir();
  return new VaultStore(secretsStorePath(dataDir));
}

export { vaultDbPath };
export * from "./keychain.js";
export * from "./guard.js";
export * from "./env-name.js";
