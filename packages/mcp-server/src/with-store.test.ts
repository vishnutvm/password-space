import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

describe("withVaultStore", () => {
  it("awaits vault_init so store creation succeeds without unlock", async () => {
    const dir = tempDir();

    const initResult = await withVaultStore(dir, (store) =>
      vaultInitTool(store, dir, {}),
    );
    const initParsed = JSON.parse(initResult.content[0]!.text) as {
      ok: boolean;
      initialized: boolean;
      lock_unlock_needed: boolean;
    };
    expect(initParsed.ok).toBe(true);
    expect(initParsed.initialized).toBe(true);
    expect(initParsed.lock_unlock_needed).toBe(false);

    const unlockResult = await vaultUnlockTool(dir, {});
    const unlockParsed = JSON.parse(unlockResult.content[0]!.text) as {
      ok: boolean;
      unlocked: boolean;
      deprecated: boolean;
    };
    expect(unlockParsed.ok).toBe(true);
    expect(unlockParsed.unlocked).toBe(true);
    expect(unlockParsed.deprecated).toBe(true);

    const status = await withVaultStore(dir, (store) => {
      expect(store.isInitialized()).toBe(true);
      expect(store.isUnlocked).toBe(true);
      return { ok: true as const };
    });
    expect(status.ok).toBe(true);
  });
});
