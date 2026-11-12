import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultStore, openVault } from "@password-space/vault";
import {
  assertNoPlaintext,
  checkPrerequisites,
  BUNDLED_CLI_NODE,
  CLI_SETUP_COMMANDS,
  bundledCliCommand,
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
      primary_action: { id: string; copy_paste_command?: string };
      recommended_path: string | null;
      host_limitation?: string;
      next_steps: Array<{ tool?: string }>;
    };
    expect(parsed.initialized).toBe(false);
    expect(parsed.unlocked).toBe(false);
    expect(parsed.setup_state).toBe("needs_init");
    expect(parsed.prerequisites.node_ok).toBe(true);
    expect(parsed.prerequisites.required_node).toBe(`>=${MIN_NODE_MAJOR}`);
    expect(parsed.primary_action.id).toBe("cli_setup");
    expect(parsed.recommended_path).toBe("cli_setup");
    expect(parsed.host_limitation).toMatch(/empty \{\}/i);
    expect(parsed.next).toMatch(/Terminal|copy_paste|setup/i);
    expect(parsed.primary_action.copy_paste_command).toBe(bundledCliCommand("setup"));
    expect(parsed.primary_action.copy_paste_command).toContain("cli.js");
    expect(parsed.next_steps.some((s) => s.tool === "cli_setup")).toBe(true);
    store.close();
  });

  it("buildPrimaryAction prefers cli_setup when vault missing and no env", () => {
    const action = buildPrimaryAction(false, false, false);
    expect(action.id).toBe("cli_setup");
    expect(action.recommended_path).toBe("cli_setup");
    expect(action.mcp_tool).toBeUndefined();
    expect(action.copy_paste_command).toBe(bundledCliCommand("setup"));
    expect(action.copy_paste_command).toMatch(/cli\.js/);
    expect(action.host_limitation).toMatch(/empty \{\}/i);
    expect(action.never).toMatch(/ready/i);
    expect(action.alternatives?.some((a) => a.id === "mcp_env")).toBe(true);
    expect(action.advanced_escape_hatch?.cli_command).toBe(
      CLI_SETUP_COMMANDS.from_clone_optional,
    );
  });

  it("buildPrimaryAction prefers ready (no CLI dump) when vault unlocked", () => {
    const action = buildPrimaryAction(true, true, true);
    expect(action.id).toBe("ready");
    expect(action.recommended_path).toBe("ready");
    expect(action.copy_paste_command).toBeUndefined();
    expect(action.mcp_tool).toBe("inject_secret");
    expect(action.do_this).toMatch(/Vault ready/i);
    expect(action.do_this).toMatch(/GITHUB_TOKEN|named secret/i);
    expect(action.do_this).not.toMatch(/copy_paste_command/i);
    const addAlt = action.alternatives?.find((a) => a.id === "cli_set");
    expect(addAlt?.copy_paste_command).toBe(bundledCliCommand("set"));
  });

  it("CLI_SETUP_COMMANDS.plugin_* use CURSOR_PLUGIN_ROOT bundled cli.js", () => {
    expect(CLI_SETUP_COMMANDS.plugin_setup).toBe(`${BUNDLED_CLI_NODE} setup`);
    expect(CLI_SETUP_COMMANDS.plugin_unlock).toBe(`${BUNDLED_CLI_NODE} unlock`);
    expect(CLI_SETUP_COMMANDS.plugin_set).toBe(`${BUNDLED_CLI_NODE} set`);
    expect(CLI_SETUP_COMMANDS.plugin_setup).toContain("${CURSOR_PLUGIN_ROOT}/dist/cli.js");
  });

  it("buildPrimaryAction prefers vault_init_env when PASSWORD_SPACE_PASSPHRASE set", () => {
    process.env.PASSWORD_SPACE_PASSPHRASE = "env-passphrase-xx";
    const action = buildPrimaryAction(false, false, false);
    expect(action.id).toBe("vault_init_env");
    expect(action.mcp_tool).toBe("vault_init");
    expect(action.recommended_path).toBe("mcp_env");
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

  it("vault_onboard returns cli_setup primary_action for newcomers", () => {
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
        mcp_tool?: string;
        copy_paste_command?: string;
        recommended_path?: string;
        advanced_escape_hatch?: { when: string };
      };
      recommended_path: string | null;
      host_limitation?: string;
      copy_paste_command?: string;
      what_to_do: string[];
      never_do: string[];
      elicitation_note: string;
      never_edit: string[];
      recovery: { code: string; howToFix: string };
      progress: { phase: string };
      trust_line: string;
    };
    expect(parsed.checklist.length).toBeGreaterThan(3);
    expect(parsed.checklist.find((s) => s.id === "init")?.done).toBe(false);
    expect(parsed.human_summary).toMatch(/Terminal|Welcome|Password Space/i);
    expect(parsed.progress.phase).toMatch(/\d\/4/);
    expect(parsed.trust_line).toMatch(/encrypted/i);
    expect(parsed.setup_state).toBe("needs_init");
    expect(parsed.primary_action.id).toBe("cli_setup");
    expect(parsed.recommended_path).toBe("cli_setup");
    expect(parsed.primary_action.mcp_tool).toBeUndefined();
    expect(parsed.host_limitation).toMatch(/empty \{\}/i);
    expect(parsed.copy_paste_command).toBe(bundledCliCommand("setup"));
    expect(parsed.primary_action.do_this).toMatch(/Terminal|copy_paste/i);
    expect(parsed.what_to_do).toHaveLength(1);
    expect(parsed.never_do.some((n) => /ready/i.test(n))).toBe(true);
    expect(parsed.elicitation_note).toMatch(/never via MCP elicitation/i);
    expect(parsed.never_edit).toContain("mcp.json");
    expect(parsed.recovery.howToFix).toMatch(/Terminal|password-space setup/i);
    store.close();
  });

  it("vault_onboard guides cli_unlock when vault already exists", async () => {
    const dir = tempDir();
    const store = new VaultStore(join(dir, "vault.db"));
    await store.init("existing-vault-pass");
    store.lock();
    const result = vaultOnboardTool(store, dir);
    const parsed = JSON.parse(result.content[0]!.text) as {
      setup_state: string;
      primary_action: { id: string; mcp_tool?: string; copy_paste_command?: string };
      recommended_path: string | null;
      recovery: { code: string; howToFix: string };
      human_summary: string;
    };
    expect(parsed.setup_state).toBe("needs_unlock");
    expect(parsed.primary_action.id).toBe("cli_unlock");
    expect(parsed.recommended_path).toBe("cli_unlock");
    expect(parsed.primary_action.mcp_tool).toBeUndefined();
    expect(parsed.primary_action.copy_paste_command).toBe(bundledCliCommand("unlock"));
    expect(parsed.recovery.code).toBe("vault_locked");
    expect(parsed.recovery.howToFix).toMatch(/do not run vault_init/i);
    expect(parsed.human_summary).toMatch(/already exists/i);
    store.close();
  });

  it("vault_onboard stays short when vault is ready (no CLI path dump)", async () => {
    const dir = tempDir();
    const store = new VaultStore(join(dir, "vault.db"));
    await store.init("ready-vault-pass-xx");
    store.close();
    await vaultUnlockTool(dir, { passphrase: "ready-vault-pass-xx", ttl_hours: 1 });
    const unlocked = openVault({ dataDir: dir, useSession: true });
    const result = vaultOnboardTool(unlocked, dir);
    const parsed = JSON.parse(result.content[0]!.text) as {
      setup_state: string;
      human_summary: string;
      primary_action: {
        id: string;
        do_this: string;
        mcp_tool?: string;
        copy_paste_command?: string;
        alternatives?: Array<{ id: string; copy_paste_command?: string }>;
      };
      copy_paste_command: string | null;
      next_tool: string;
      recovery: { code: string; howToFix: string };
    };
    expect(parsed.setup_state).toBe("ready");
    expect(parsed.primary_action.id).toBe("ready");
    expect(parsed.primary_action.mcp_tool).toBe("inject_secret");
    expect(parsed.copy_paste_command).toBeNull();
    expect(parsed.primary_action.copy_paste_command).toBeUndefined();
    expect(parsed.primary_action.do_this).toMatch(/Vault ready/i);
    expect(parsed.primary_action.do_this).not.toMatch(/dist\/cli\.js/);
    expect(parsed.human_summary).toMatch(/Vault ready/i);
    expect(parsed.human_summary).not.toMatch(/dist\/cli\.js/);
    expect(parsed.next_tool).toBe("inject_secret");
    expect(parsed.recovery.code).toBe("ready");
    expect(parsed.recovery.howToFix).not.toMatch(/dist\/cli\.js/);
    expect(
      parsed.primary_action.alternatives?.find((a) => a.id === "cli_set")?.copy_paste_command,
    ).toBe(bundledCliCommand("set"));
    unlocked.close();
  });

  it("PassphraseRequiredError carries host_limitation and cli_setup path", () => {
    const err = new PassphraseRequiredError();
    expect(err.code).toBe("passphrase_missing");
    expect(err.recommended_path).toBe("cli_setup");
    expect(err.host_limitation).toMatch(/empty \{\}/i);
    expect(err.message).toMatch(/empty \{\}/i);
    expect(err.message).toMatch(/Terminal|password-space setup/i);
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
      apps_ui_expected: boolean;
      agent_contract: string;
      apps_fallback: {
        recommended_path: string;
        copy_paste_command?: string | null;
        never?: string[];
      };
      secrets: Array<{ name: string; value?: string }>;
      capabilities: Record<string, string>;
    };
    expect(parsed.app).toBe("vault-manager");
    expect(parsed.ui_resource).toMatch(/^ui:\/\//);
    expect(parsed.apps_ui_expected).toBe(false);
    expect(parsed.apps_fallback.recommended_path).toBe("ready");
    expect(parsed.apps_fallback.copy_paste_command).toBeNull();
    expect(parsed.agent_contract).toMatch(/Vault ready|inject_secret/i);
    expect(parsed.apps_fallback.never?.join(" ")).toMatch(/App forms|vault-manager\.html/i);
    expect(result.content[0]!.text).not.toMatch(/<!DOCTYPE html>/i);
    expect(result.content[0]!.text).not.toMatch(/ZodError|invalid_union/);
    expect(parsed.secrets[0]?.name).toBe("DEMO_KEY");
    expect(parsed.secrets[0]?.value).toBeUndefined();
    expect(parsed.capabilities.remove).toMatch(/Terminal remove/i);
    store.close();
  });

  it("vault_manager apps_fallback recommends cli_setup when vault missing", () => {
    const dir = tempDir();
    const store = new VaultStore(join(dir, "vault.db"));
    const result = vaultManagerTool(store, dir);
    const parsed = JSON.parse(result.content[0]!.text) as {
      apps_fallback: {
        recommended_path: string;
        next_tool: string;
        never?: string[];
      };
      host_limitation?: string;
    };
    expect(parsed.apps_fallback.recommended_path).toBe("cli_setup");
    expect(parsed.apps_fallback.next_tool).toBe("cli_setup");
    expect(parsed.apps_fallback.never?.join(" ")).toMatch(/App forms|vault-manager\.html/i);
    expect(parsed.host_limitation).toMatch(/empty \{\}/i);
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
      recommended_path: string;
      primary_action: { id: string };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/already initialized/i);
    expect(parsed.code).toBe("vault_already_exists");
    expect(parsed.howToFix).toMatch(/Terminal|unlock|MCP Environment/i);
    expect(parsed.primary_action.id).toBe("cli_unlock");
    expect(parsed.recommended_path).toBe("cli_unlock");
    store.close();
  });
});
