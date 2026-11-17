import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
  it("awaits async callbacks before closing the store", async () => {
    const dir = tempDir();
    await withVaultStore(dir, async (store) => {
      await Promise.resolve();
      store.ensure();
    });
    const status = await withVaultStore(dir, (store) => ({
      initialized: store.isInitialized(),
    }));
    expect(status.initialized).toBe(true);
  });
});
