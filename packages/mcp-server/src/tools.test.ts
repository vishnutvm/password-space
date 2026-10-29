import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultStore, openVault } from "@password-space/vault";
import {
  assertNoPlaintext,
  getSecretMetadataTool,
  injectSecretTool,
  listSecretsTool,
  resolvePassphrase,
  resolveSecretTool,
  vaultInitTool,
  vaultLockTool,
  vaultSetSecretTool,
  vaultStatusTool,
  vaultUnlockTool,
} from "./tools.js";

const dirs: string[] = [];

afterEach(() => {
  delete process.env.PASSWORD_SPACE_PASSPHRASE;
  while (dirs.length) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ps-mcp-"));
  dirs.push(dir);
  return dir;
}

async function unlockedStore(): Promise<{ dir: string; store: VaultStore; value: string }> {
  const dir = tempDir();
  const store = new VaultStore(join(dir, "vault.db"));
  await store.init("test-passphrase-ok");
  await store.unlock("test-passphrase-ok");
  const value = "mcp-secret-value-SHOULD-NOT-LEAK";
  store.setSecret({ name: "DEMO_KEY", value, tags: ["demo"] });
  return { dir, store, value };
}

describe("MCP tools contract", () => {
  it("list_secrets returns names only", async () => {
    const { store, value } = await unlockedStore();
    const result = listSecretsTool(store);
    assertNoPlaintext(result, value);
    const parsed = JSON.parse(result.content[0]!.text) as {
      secrets: Array<{ name: string; value?: string }>;
    };
    expect(parsed.secrets).toHaveLength(1);
    expect(parsed.secrets[0]!.name).toBe("DEMO_KEY");
    expect(parsed.secrets[0]!.value).toBeUndefined();
    store.close();
  });

  it("get_secret_metadata has no value", async () => {
    const { store, value } = await unlockedStore();
    const result = getSecretMetadataTool(store, "DEMO_KEY");
    assertNoPlaintext(result, value);
    store.close();
  });

  it("inject_secret returns handle without plaintext", async () => {
    const { dir, store, value } = await unlockedStore();
    const result = injectSecretTool(store, dir, { name: "DEMO_KEY" });
    assertNoPlaintext(result, value);
    const parsed = JSON.parse(result.content[0]!.text) as {
      handle: string;
      env_file: string;
      redact_in_transcript: boolean;
    };
    expect(parsed.handle).toBe("ps://DEMO_KEY");
    expect(parsed.redact_in_transcript).toBe(true);
    expect(parsed.env_file).toContain(dir);
    store.close();
  });

  it("resolve_secret requires confirm_redaction", async () => {
    const { store, value } = await unlockedStore();
    const denied = resolveSecretTool(store, { name: "DEMO_KEY" });
    assertNoPlaintext(denied, value);
    const allowed = resolveSecretTool(store, { name: "DEMO_KEY", confirm_redaction: true });
    const parsed = JSON.parse(allowed.content[0]!.text) as { value: string; redact_in_transcript: boolean };
    expect(parsed.value).toBe(value);
    expect(parsed.redact_in_transcript).toBe(true);
    store.close();
  });

  it("list fails when locked", async () => {
    const { store } = await unlockedStore();
    store.lock();
    expect(() => listSecretsTool(store)).toThrow(/locked/i);
    store.close();
  });
});

describe("vault lifecycle MCP tools", () => {
  it("resolvePassphrase prefers tool arg then env", () => {
    expect(() => resolvePassphrase()).toThrow(/Passphrase required/);
    process.env.PASSWORD_SPACE_PASSPHRASE = "env-passphrase-xx";
    expect(resolvePassphrase()).toBe("env-passphrase-xx");
    expect(resolvePassphrase("arg-passphrase-yy")).toBe("arg-passphrase-yy");
  });

  it("vault_status reports uninitialized vault", () => {
    const dir = tempDir();
    const store = new VaultStore(join(dir, "vault.db"));
    const result = vaultStatusTool(store, dir);
    const parsed = JSON.parse(result.content[0]!.text) as {
      initialized: boolean;
      unlocked: boolean;
      next: string;
    };
    expect(parsed.initialized).toBe(false);
    expect(parsed.unlocked).toBe(false);
    expect(parsed.next).toMatch(/vault_init/);
    store.close();
  });

  it("vault_init → unlock → set_secret without leaking secrets", async () => {
    const dir = tempDir();
    const passphrase = "setup-ux-passphrase";
    const secretValue = "store-me-BUT-NEVER-LEAK-xyz";

    const initStore = new VaultStore(join(dir, "vault.db"));
    const initResult = await vaultInitTool(initStore, dir, { passphrase });
    assertNoPlaintext(initResult, passphrase);
    const initParsed = JSON.parse(initResult.content[0]!.text) as { ok: boolean; initialized: boolean };
    expect(initParsed.ok).toBe(true);
    expect(initParsed.initialized).toBe(true);
    initStore.close();

    const unlockResult = await vaultUnlockTool(dir, { passphrase, ttl_hours: 1 });
    assertNoPlaintext(unlockResult, passphrase);
    const unlockParsed = JSON.parse(unlockResult.content[0]!.text) as {
      ok: boolean;
      unlocked: boolean;
      expires_at: string;
    };
    expect(unlockParsed.ok).toBe(true);
    expect(unlockParsed.unlocked).toBe(true);
    expect(unlockParsed.expires_at).toBeTruthy();

    const store = openVault({ dataDir: dir, useSession: true });
    expect(store.isUnlocked).toBe(true);
    const status = vaultStatusTool(store, dir);
    const statusParsed = JSON.parse(status.content[0]!.text) as {
      initialized: boolean;
      unlocked: boolean;
    };
    expect(statusParsed.initialized).toBe(true);
    expect(statusParsed.unlocked).toBe(true);

    const setResult = vaultSetSecretTool(store, {
      name: "API_TOKEN",
      value: secretValue,
      tags: ["api", "demo"],
    });
    assertNoPlaintext(setResult, secretValue);
    assertNoPlaintext(setResult, passphrase);
    const setParsed = JSON.parse(setResult.content[0]!.text) as {
      ok: boolean;
      secret: { name: string; value?: string; tags: string[] };
    };
    expect(setParsed.ok).toBe(true);
    expect(setParsed.secret.name).toBe("API_TOKEN");
    expect(setParsed.secret.value).toBeUndefined();
    expect(setParsed.secret.tags).toEqual(["api", "demo"]);

    const listed = listSecretsTool(store);
    assertNoPlaintext(listed, secretValue);
    store.close();

    const lockResult = vaultLockTool(dir);
    const lockParsed = JSON.parse(lockResult.content[0]!.text) as { locked: boolean };
    expect(lockParsed.locked).toBe(true);

    const locked = openVault({ dataDir: dir, useSession: true });
    expect(locked.isUnlocked).toBe(false);
    locked.close();
  });

  it("vault_init accepts passphrase from env", async () => {
    const dir = tempDir();
    process.env.PASSWORD_SPACE_PASSPHRASE = "env-only-passphrase";
    const store = new VaultStore(join(dir, "vault.db"));
    const result = await vaultInitTool(store, dir, {});
    assertNoPlaintext(result, "env-only-passphrase");
    expect(store.isInitialized()).toBe(true);
    store.close();
  });

  it("vault_init refuses when already initialized", async () => {
    const dir = tempDir();
    const store = new VaultStore(join(dir, "vault.db"));
    await store.init("already-inited-xx");
    const result = await vaultInitTool(store, dir, { passphrase: "already-inited-xx" });
    const parsed = JSON.parse(result.content[0]!.text) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/already initialized/i);
    store.close();
  });
});
