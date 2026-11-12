import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openVault } from "@password-space/vault";
import { vaultInitTool, vaultUnlockTool } from "./tools.js";
import { withVaultStore } from "./with-store.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ps-with-store-"));
  dirs.push(dir);
  return dir;
}

/**
 * Reproduces the pre-fix MCP App Create-vault race:
 * sync withStore closed the DB when vaultInitTool returned a Promise,
 * then await store.init hit node:sqlite "database is not open".
 */
function withStoreBrokenSyncClose<T>(
  dataDir: string,
  fn: (store: ReturnType<typeof openVault>) => T,
): T {
  const store = openVault({ dataDir, useSession: true });
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

describe("withVaultStore", () => {
  it("broken sync close surfaces database is not open during vault_init", async () => {
    const dir = tempDir();
    const passphrase = "create-vault-passphrase";

    await expect(
      withStoreBrokenSyncClose(dir, (store) =>
        vaultInitTool(store, dir, { passphrase }),
      ),
    ).rejects.toThrow(/database is not open/i);
  });

  it("awaits vault_init so Create vault (App UI) succeeds", async () => {
    const dir = tempDir();
    const passphrase = "create-vault-passphrase";

    const initResult = await withVaultStore(dir, (store) =>
      vaultInitTool(store, dir, { passphrase }),
    );
    const initParsed = JSON.parse(initResult.content[0]!.text) as {
      ok: boolean;
      initialized: boolean;
    };
    expect(initParsed.ok).toBe(true);
    expect(initParsed.initialized).toBe(true);

    const unlockResult = await vaultUnlockTool(dir, { passphrase, ttl_hours: 1 });
    const unlockParsed = JSON.parse(unlockResult.content[0]!.text) as {
      ok: boolean;
      unlocked: boolean;
    };
    expect(unlockParsed.ok).toBe(true);
    expect(unlockParsed.unlocked).toBe(true);

    const status = await withVaultStore(dir, (store) => {
      expect(store.isInitialized()).toBe(true);
      expect(store.isUnlocked).toBe(true);
      return { ok: true as const };
    });
    expect(status.ok).toBe(true);
  });
});
