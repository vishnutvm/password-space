import { openVault, type VaultStore } from "@password-space/vault";

/**
 * Open the vault for one tool call, then close it.
 *
 * Must `await` the callback: vault_init (and any other async tool) runs
 * scrypt + SQLite writes after the first await. Closing synchronously when
 * the callback returns a Promise leaves node:sqlite with "database is not open".
 */
export async function withVaultStore<T>(
  dataDir: string,
  fn: (store: VaultStore) => T | Promise<T>,
): Promise<T> {
  const store = openVault({ dataDir, useSession: true });
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}
