import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultStore, openVault, secretsStorePath, vaultDbPath } from "@password-space/vault";
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

function readyStore(): { dir: string; store: VaultStore; value: string } {
  const dir = tempDir();
  const store = new VaultStore(secretsStorePath(dir));
  store.ensure();
  const value = "mcp-secret-value-SHOULD-NOT-LEAK";
  store.setSecret({ name: "DEMO_KEY", value, tags: ["demo"] });
  return { dir, store, value };
}

describe("MCP tools contract", () => {
  it("list_secrets returns names only", () => {
    const { store, value } = readyStore();
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

  it("get_secret_metadata has no value", () => {
    const { store, value } = readyStore();
    const result = getSecretMetadataTool(store, "DEMO_KEY");
    assertNoPlaintext(result, value);
    store.close();
  });

  it("inject_secret returns handle without plaintext", () => {
    const { dir, store, value } = readyStore();
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

  it("resolve_secret requires confirm_redaction", () => {
    const { store, value } = readyStore();
    const denied = resolveSecretTool(store, { name: "DEMO_KEY" });
    assertNoPlaintext(denied, value);
    const allowed = resolveSecretTool(store, { name: "DEMO_KEY", confirm_redaction: true });
    const parsed = JSON.parse(allowed.content[0]!.text) as { value: string; redact_in_transcript: boolean };
    expect(parsed.value).toBe(value);
    expect(parsed.redact_in_transcript).toBe(true);
    store.close();
  });

  it("list works without unlock session", () => {
    const { store } = readyStore();
    store.lock();
    expect(() => listSecretsTool(store)).not.toThrow();
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

  it("vault_status reports uninitialized store with next_steps", () => {
    const dir = tempDir();
    const store = new VaultStore(secretsStorePath(dir));
    const result = vaultStatusTool(store, dir);
    const parsed = JSON.parse(result.content[0]!.text) as {
      initialized: boolean;
      unlocked: boolean;
      next: string;
      setup_state: string;
      storage: string;
      lock_unlock_needed: boolean;
      prerequisites: { node_ok: boolean; required_node: string };
      primary_action: { id: string; copy_paste_command?: string };
      recommended_path: string | null;
      next_steps: Array<{ tool?: string }>;
    };
    expect(parsed.initialized).toBe(false);
    expect(parsed.setup_state).toBe("needs_init");
    expect(parsed.storage).toBe("plain-json");
    expect(parsed.lock_unlock_needed).toBe(false);
    expect(parsed.prerequisites.node_ok).toBe(true);
    expect(parsed.prerequisites.required_node).toBe(`>=${MIN_NODE_MAJOR}`);
    expect(parsed.primary_action.id).toBe("cli_setup");
    expect(parsed.recommended_path).toBe("cli_setup");
    expect(parsed.next).toMatch(/Terminal|copy_paste|setup/i);
    expect(parsed.primary_action.copy_paste_command).toBe(bundledCliCommand("setup"));
    expect(parsed.next_steps.some((s) => s.tool === "cli_setup")).toBe(true);
    store.close();
  });

  it("buildPrimaryAction prefers cli_setup when store missing", () => {
    const action = buildPrimaryAction(false, false, false);
    expect(action.id).toBe("cli_setup");
    expect(action.recommended_path).toBe("cli_setup");
    expect(action.mcp_tool).toBeUndefined();
    expect(action.copy_paste_command).toBe(bundledCliCommand("setup"));
    expect(action.copy_paste_command).toMatch(/cli\.js/);
    expect(action.advanced_escape_hatch?.cli_command).toBe(
      CLI_SETUP_COMMANDS.from_clone_optional,
    );
  });

  it("buildPrimaryAction prefers cli_set when store ready", () => {
    const action = buildPrimaryAction(true, true, true);
    expect(action.id).toBe("cli_set");
    expect(action.recommended_path).toBe("cli_set");
    expect(action.copy_paste_command).toBe(bundledCliCommand("set"));
  });

  it("CLI_SETUP_COMMANDS.plugin_* use CURSOR_PLUGIN_ROOT bundled cli.js", () => {
    expect(CLI_SETUP_COMMANDS.plugin_setup).toBe(`${BUNDLED_CLI_NODE} setup`);
    expect(CLI_SETUP_COMMANDS.plugin_unlock).toBe(`${BUNDLED_CLI_NODE} unlock`);
    expect(CLI_SETUP_COMMANDS.plugin_set).toBe(`${BUNDLED_CLI_NODE} set`);
    expect(CLI_SETUP_COMMANDS.plugin_setup).toContain("${CURSOR_PLUGIN_ROOT}/dist/cli.js");
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
    const store = new VaultStore(secretsStorePath(dir));
    const result = vaultOnboardTool(store, dir);
    const parsed = JSON.parse(result.content[0]!.text) as {
      checklist: Array<{ id: string; done: boolean }>;
      human_summary: string;
      setup_state: string;
      storage: string;
      lock_unlock_needed: boolean;
      primary_action: {
        id: string;
        do_this: string;
        mcp_tool?: string;
        copy_paste_command?: string;
        recommended_path?: string;
      };
      recommended_path: string | null;
      copy_paste_command?: string;
      what_to_do: string[];
      never_do: string[];
      elicitation_note: string;
      never_edit: string[];
      recovery: { code: string; howToFix: string };
      progress: { phase: string };
      trust_line: string;
    };
    expect(parsed.checklist.length).toBeGreaterThan(2);
    expect(parsed.checklist.find((s) => s.id === "init")?.done).toBe(false);
    expect(parsed.human_summary).toMatch(/Terminal|Welcome|Password Space/i);
    expect(parsed.trust_line).toMatch(/plain/i);
    expect(parsed.storage).toBe("plain-json");
    expect(parsed.lock_unlock_needed).toBe(false);
    expect(parsed.setup_state).toBe("needs_init");
    expect(parsed.primary_action.id).toBe("cli_setup");
    expect(parsed.recommended_path).toBe("cli_setup");
    expect(parsed.primary_action.mcp_tool).toBeUndefined();
    expect(parsed.copy_paste_command).toBe(bundledCliCommand("setup"));
    expect(parsed.primary_action.do_this).toMatch(/Terminal|copy_paste/i);
    expect(parsed.what_to_do).toHaveLength(1);
    expect(parsed.never_do.some((n) => /chat/i.test(n))).toBe(true);
    expect(parsed.elicitation_note).toMatch(/never via MCP elicitation/i);
    expect(parsed.never_edit).toContain("mcp.json");
    expect(parsed.recovery.howToFix).toMatch(/Terminal|setup/i);
    store.close();
  });

  it("vault_onboard guides cli_set when store already exists", async () => {
    const dir = tempDir();
    const store = new VaultStore(secretsStorePath(dir));
    await store.init();
    const result = vaultOnboardTool(store, dir);
    const parsed = JSON.parse(result.content[0]!.text) as {
      setup_state: string;
      primary_action: { id: string; mcp_tool?: string; copy_paste_command?: string };
      recommended_path: string | null;
      recovery: { code: string };
      human_summary: string;
      lock_unlock_needed: boolean;
    };
    expect(parsed.setup_state).toBe("ready");
    expect(parsed.primary_action.id).toBe("cli_set");
    expect(parsed.recommended_path).toBe("cli_set");
    expect(parsed.lock_unlock_needed).toBe(false);
    expect(parsed.primary_action.copy_paste_command).toBe(bundledCliCommand("set"));
    expect(parsed.recovery.code).toBe("ready");
    expect(parsed.human_summary).toMatch(/ready|inject/i);
    store.close();
  });

  it("vault_onboard notes legacy encrypted vault without wiping it", () => {
    const dir = tempDir();
    writeFileSync(vaultDbPath(dir), "legacy-encrypted-placeholder");
    const store = new VaultStore(secretsStorePath(dir));
    const result = vaultOnboardTool(store, dir);
    const parsed = JSON.parse(result.content[0]!.text) as {
      legacy_encrypted_vault: boolean;
      recovery: { code: string; howToFix: string };
      human_summary: string;
    };
    expect(parsed.legacy_encrypted_vault).toBe(true);
    expect(parsed.recovery.code).toBe("legacy_encrypted_vault");
    expect(parsed.recovery.howToFix).toMatch(/untouched|re-add/i);
    expect(parsed.human_summary).toMatch(/legacy|untouched/i);
    store.close();
  });

  it("PassphraseRequiredError carries Terminal path", () => {
    const err = new PassphraseRequiredError();
    expect(err.code).toBe("passphrase_missing");
    expect(err.recommended_path).toBe("cli_setup");
    expect(err.message).toMatch(/Terminal|setup/i);
  });

  it("vault_init → set_secret without unlock or leaking secrets", async () => {
    const dir = tempDir();
    const secretValue = "store-me-BUT-NEVER-LEAK-xyz";

    const initStore = new VaultStore(secretsStorePath(dir));
    const initResult = await vaultInitTool(initStore, dir, {});
    const initParsed = JSON.parse(initResult.content[0]!.text) as {
      ok: boolean;
      initialized: boolean;
      unlocked: boolean;
      lock_unlock_needed: boolean;
    };
    expect(initParsed.ok).toBe(true);
    expect(initParsed.initialized).toBe(true);
    expect(initParsed.unlocked).toBe(true);
    expect(initParsed.lock_unlock_needed).toBe(false);
    initStore.close();

    const unlockResult = await vaultUnlockTool(dir, {});
    const unlockParsed = JSON.parse(unlockResult.content[0]!.text) as {
      ok: boolean;
      unlocked: boolean;
      deprecated: boolean;
    };
    expect(unlockParsed.ok).toBe(true);
    expect(unlockParsed.unlocked).toBe(true);
    expect(unlockParsed.deprecated).toBe(true);

    const store = openVault({ dataDir: dir });
    expect(store.isUnlocked).toBe(true);
    const status = vaultStatusTool(store, dir);
    const statusParsed = JSON.parse(status.content[0]!.text) as {
      initialized: boolean;
      unlocked: boolean;
      storage: string;
    };
    expect(statusParsed.initialized).toBe(true);
    expect(statusParsed.unlocked).toBe(true);
    expect(statusParsed.storage).toBe("plain-json");

    const setResult = vaultSetSecretTool(store, {
      name: "API_TOKEN",
      value: secretValue,
      tags: ["api", "demo"],
    });
    assertNoPlaintext(setResult, secretValue);
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
    const lockParsed = JSON.parse(lockResult.content[0]!.text) as {
      deprecated: boolean;
      note: string;
    };
    expect(lockParsed.deprecated).toBe(true);
    expect(lockParsed.note).toMatch(/no-op|not needed|plain/i);

    const again = openVault({ dataDir: dir });
    expect(again.isUnlocked).toBe(true);
    expect(again.getSecret("API_TOKEN").value).toBe(secretValue);
    again.close();
  });

  it("vault_manager returns secrets metadata without plaintext", () => {
    const { dir, store, value } = readyStore();
    const result = vaultManagerTool(store, dir);
    assertNoPlaintext(result, value);
    const parsed = JSON.parse(result.content[0]!.text) as {
      app: string;
      ui_resource: string;
      apps_ui_expected: boolean;
      agent_contract: string;
      apps_fallback: { recommended_path: string; never?: string[] };
      secrets: Array<{ name: string; value?: string }>;
      capabilities: Record<string, string>;
    };
    expect(parsed.app).toBe("vault-manager");
    expect(parsed.ui_resource).toMatch(/^ui:\/\//);
    expect(parsed.apps_ui_expected).toBe(false);
    expect(parsed.apps_fallback.recommended_path).toBe("cli_set");
    expect(parsed.agent_contract).toMatch(/Terminal/i);
    expect(parsed.apps_fallback.never?.join(" ")).toMatch(/App forms|vault-manager\.html/i);
    expect(result.content[0]!.text).not.toMatch(/<!DOCTYPE html>/i);
    expect(parsed.secrets[0]?.name).toBe("DEMO_KEY");
    expect(parsed.secrets[0]?.value).toBeUndefined();
    expect(parsed.capabilities.remove).toMatch(/Terminal remove/i);
    expect(parsed.capabilities.unlock).toMatch(/Not needed/i);
    store.close();
  });

  it("vault_manager apps_fallback recommends cli_setup when store missing", () => {
    const dir = tempDir();
    const store = new VaultStore(secretsStorePath(dir));
    const result = vaultManagerTool(store, dir);
    const parsed = JSON.parse(result.content[0]!.text) as {
      apps_fallback: {
        recommended_path: string;
        next_tool: string;
        never?: string[];
      };
    };
    expect(parsed.apps_fallback.recommended_path).toBe("cli_setup");
    expect(parsed.apps_fallback.next_tool).toBe("cli_setup");
    expect(parsed.apps_fallback.never?.join(" ")).toMatch(/App forms|vault-manager\.html/i);
    store.close();
  });

  it("vault_delete_secret removes without leaking", () => {
    const { store, value } = readyStore();
    const result = vaultDeleteSecretTool(store, "DEMO_KEY");
    assertNoPlaintext(result, value);
    expect(store.listSecrets()).toHaveLength(0);
    store.close();
  });

  it("vault_change_passphrase reports deprecated", async () => {
    const dir = tempDir();
    const result = await vaultChangePassphraseTool(dir, {
      current_passphrase: "change-pass-old-1",
      new_passphrase: "change-pass-new-2",
    });
    const parsed = JSON.parse(result.content[0]!.text) as {
      ok: boolean;
      deprecated: boolean;
      code: string;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.deprecated).toBe(true);
    expect(parsed.code).toBe("passphrase_not_used");
  });

  it("vault_init works without passphrase", async () => {
    const dir = tempDir();
    const store = new VaultStore(secretsStorePath(dir));
    const result = await vaultInitTool(store, dir, {});
    expect(store.isInitialized()).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text) as { ok: boolean; storage: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.storage).toBe("plain-json");
    store.close();
  });

  it("vault_init when already initialized points to cli_set", async () => {
    const dir = tempDir();
    const store = new VaultStore(secretsStorePath(dir));
    await store.init();
    const result = await vaultInitTool(store, dir, {});
    const parsed = JSON.parse(result.content[0]!.text) as {
      ok: boolean;
      code: string;
      recommended_path: string;
      primary_action: { id: string };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.code).toBe("store_already_exists");
    expect(parsed.primary_action.id).toBe("cli_set");
    expect(parsed.recommended_path).toBe("cli_set");
    store.close();
  });
});
