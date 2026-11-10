import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultStore, openVault } from "@password-space/vault";
import {
  assertNoPlaintext,
  checkPrerequisites,
  getSecretMetadataTool,
  injectSecretTool,
  listSecretsTool,
  MIN_NODE_MAJOR,
  PassphraseRequiredError,
  resolvePassphrase,
  buildPrimaryAction,
  vaultOnboardTool,
  resolveSecretTool,
  vaultChangePassphraseTool,
  vaultDeleteSecretTool,
  vaultInitTool,
  vaultLockTool,
  vaultManagerTool,
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
    expect(() => resolvePassphrase()).toThrow(PassphraseRequiredError);
    process.env.PASSWORD_SPACE_PASSPHRASE = "env-passphrase-xx";
    expect(resolvePassphrase()).toBe("env-passphrase-xx");
    expect(resolvePassphrase("arg-passphrase-yy")).toBe("arg-passphrase-yy");
    expect(() => resolvePassphrase("short")).toThrow(/8 character/i);
  });

  it("vault_status reports uninitialized vault with next_steps and prerequisites", () => {
    const dir = tempDir();
    const store = new VaultStore(join(dir, "vault.db"));
    const result = vaultStatusTool(store, dir);
    const parsed = JSON.parse(result.content[0]!.text) as {
      initialized: boolean;
      unlocked: boolean;
      next: string;
      setup_state: string;
      prerequisites: { node_ok: boolean; required_node: string };
      primary_action: { id: string };
      next_steps: Array<{ tool?: string }>;
    };
    expect(parsed.initialized).toBe(false);
    expect(parsed.unlocked).toBe(false);
    expect(parsed.setup_state).toBe("needs_init");
    expect(parsed.prerequisites.node_ok).toBe(true);
    expect(parsed.prerequisites.required_node).toBe(`>=${MIN_NODE_MAJOR}`);
    expect(parsed.primary_action.id).toBe("vault_init");
    expect(parsed.next).toMatch(/vault_init|approval form/i);
    expect(parsed.next_steps.some((s) => s.tool === "vault_init")).toBe(true);
    store.close();
  });

  it("buildPrimaryAction prefers vault_init MCP form when vault missing", () => {
    const action = buildPrimaryAction(false, false, false);
    expect(action.id).toBe("vault_init");
    expect(action.mcp_tool).toBe("vault_init");
    expect(action.never).toMatch(/empty/i);
    expect(action.advanced_escape_hatch?.cli_command).toBe("password-space setup");
    expect(action).not.toHaveProperty("or_alternative");
  });

  it("buildPrimaryAction returns fix_node when prereq fails", () => {
    const action = buildPrimaryAction(false, false, false, false);
    expect(action.id).toBe("fix_node");
    expect(action.do_this).toMatch(/Node\.js/i);
  });

  it("checkPrerequisites rejects Node below minimum", () => {
    const bad = checkPrerequisites("v18.20.0");
    expect(bad.ok).toBe(false);
    expect(bad.node_ok).toBe(false);
    expect(bad.howToFix).toMatch(/Node\.js/i);
    const good = checkPrerequisites("v20.11.0");
    expect(good.ok).toBe(true);
  });

  it("vault_onboard returns single primary_action for MCP path", () => {
    const dir = tempDir();
    const store = new VaultStore(join(dir, "vault.db"));
    const result = vaultOnboardTool(store, dir);
    const parsed = JSON.parse(result.content[0]!.text) as {
      checklist: Array<{ id: string; done: boolean }>;
      human_summary: string;
      setup_state: string;
      primary_action: {
        id: string;
        do_this: string;
        advanced_escape_hatch?: { cli_command: string };
      };
      what_to_do: string[];
      elicitation_note: string;
      never_edit: string[];
      recovery: { code: string; howToFix: string };
      progress: { phase: string };
      trust_line: string;
    };
    expect(parsed.checklist.length).toBeGreaterThan(3);
    expect(parsed.checklist.find((s) => s.id === "init")?.done).toBe(false);
    expect(parsed.human_summary).toMatch(/Welcome|Password Space/i);
    expect(parsed.progress.phase).toMatch(/\d\/4/);
    expect(parsed.trust_line).toMatch(/encrypted/i);
    expect(parsed.setup_state).toBe("needs_init");
    expect(parsed.primary_action.id).toBe("vault_init");
    expect(parsed.primary_action.do_this).toMatch(/vault_init|approval form/i);
    expect(parsed.primary_action.advanced_escape_hatch?.cli_command).toBe(
      "password-space setup",
    );
    expect(parsed.what_to_do).toHaveLength(1);
    expect(parsed.elicitation_note).toMatch(/never via MCP elicitation/i);
    expect(parsed.never_edit).toContain("mcp.json");
    expect(parsed.recovery.howToFix).toMatch(/vault_init|passphrase/i);
    store.close();
  });

  it("vault_onboard guides unlock when vault already exists", async () => {
    const dir = tempDir();
    const store = new VaultStore(join(dir, "vault.db"));
    await store.init("existing-vault-pass");
    store.lock();
    const result = vaultOnboardTool(store, dir);
    const parsed = JSON.parse(result.content[0]!.text) as {
      setup_state: string;
      primary_action: { id: string };
      recovery: { code: string; howToFix: string };
      human_summary: string;
    };
    expect(parsed.setup_state).toBe("needs_unlock");
    expect(parsed.primary_action.id).toBe("vault_unlock");
    expect(parsed.recovery.code).toBe("vault_locked");
    expect(parsed.recovery.howToFix).toMatch(/do not run vault_init/i);
    expect(parsed.human_summary).toMatch(/already exists/i);
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

  it("vault_manager returns secrets metadata without plaintext", async () => {
    const { dir, store, value } = await unlockedStore();
    const result = vaultManagerTool(store, dir);
    assertNoPlaintext(result, value);
    const parsed = JSON.parse(result.content[0]!.text) as {
      app: string;
      ui_resource: string;
      secrets: Array<{ name: string; value?: string }>;
      capabilities: Record<string, string>;
    };
    expect(parsed.app).toBe("vault-manager");
    expect(parsed.ui_resource).toMatch(/^ui:\/\//);
    expect(parsed.secrets[0]?.name).toBe("DEMO_KEY");
    expect(parsed.secrets[0]?.value).toBeUndefined();
    expect(parsed.capabilities.remove).toBe("vault_delete_secret");
    store.close();
  });

  it("vault_delete_secret removes without leaking", async () => {
    const { store, value } = await unlockedStore();
    const result = vaultDeleteSecretTool(store, "DEMO_KEY");
    assertNoPlaintext(result, value);
    expect(store.listSecrets()).toHaveLength(0);
    store.close();
  });

  it("vault_change_passphrase keeps secrets and refreshes session", async () => {
    const dir = tempDir();
    const store = new VaultStore(join(dir, "vault.db"));
    await store.init("change-pass-old-1");
    store.close();
    await vaultUnlockTool(dir, { passphrase: "change-pass-old-1", ttl_hours: 1 });
    const unlocked = openVault({ dataDir: dir, useSession: true });
    unlocked.setSecret({ name: "X", value: "token-keep-me" });
    unlocked.close();

    const result = await vaultChangePassphraseTool(dir, {
      current_passphrase: "change-pass-old-1",
      new_passphrase: "change-pass-new-2",
      ttl_hours: 1,
    });
    assertNoPlaintext(result, "change-pass-old-1");
    assertNoPlaintext(result, "change-pass-new-2");
    assertNoPlaintext(result, "token-keep-me");

    const again = openVault({ dataDir: dir, useSession: true });
    expect(again.isUnlocked).toBe(true);
    expect(again.getSecret("X").value).toBe("token-keep-me");
    again.close();
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

  it("vault_init refuses when already initialized with unlock recovery", async () => {
    const dir = tempDir();
    const store = new VaultStore(join(dir, "vault.db"));
    await store.init("already-inited-xx");
    const result = await vaultInitTool(store, dir, { passphrase: "already-inited-xx" });
    const parsed = JSON.parse(result.content[0]!.text) as {
      ok: boolean;
      error: string;
      code: string;
      howToFix: string;
      primary_action: { id: string };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/already initialized/i);
    expect(parsed.code).toBe("vault_already_exists");
    expect(parsed.howToFix).toMatch(/vault_unlock/i);
    expect(parsed.primary_action.id).toBe("vault_unlock");
    store.close();
  });
});
