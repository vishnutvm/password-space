import { openVault, type VaultStore } from "@password-space/vault";

/**
 * Open the store for one tool call, then close it.
 * The callback is awaited so async tools finish before the store closes.
 */
export async function withVaultStore<T>(
  dataDir: string,
  fn: (store: VaultStore) => T | Promise<T>,
): Promise<T> {
  const store = openVault({ dataDir });
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}
