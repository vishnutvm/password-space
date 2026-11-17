import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryKeychain,
  VaultStore,
  auditLogPath,
  openVault,
  secretsStorePath,
  vaultDbPath,
} from "@password-space/vault";
import {
  AGENT_ACTOR,
  assertNoPlaintext,
  removeSecretTool,
  scrubValue,
  storeSecretTool,
  checkPrerequisites,
  clearOwnInjectFiles,
  RESOLVE_SECRET_DESCRIPTION,
  RESOLVE_SECRET_ENV,
  resolveSecretEnabled,
  BUNDLED_CLI_NODE,
  CLI_SETUP_COMMANDS,
  bundledCliCommand,
  getSecretMetadataTool,
  injectSecretTool,
  listSecretsTool,
  MIN_NODE_MAJOR,
  buildPrimaryAction,
  vaultOnboardTool,
  resolveSecretTool,
  vaultDeleteSecretTool,
  vaultManagerTool,
  vaultSetSecretTool,
  vaultStatusTool,
} from "./tools.js";

const dirs: string[] = [];

afterEach(() => {
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

  it("resolve_secret is off by default and never reads the value", () => {
    const { store, value } = readyStore();
    const prev = process.env[RESOLVE_SECRET_ENV];
    delete process.env[RESOLVE_SECRET_ENV];
    try {
      const denied = resolveSecretTool(store, { name: "DEMO_KEY", confirm_redaction: true });
      assertNoPlaintext(denied, value);
      const parsed = JSON.parse(denied.content[0]!.text) as { ok: boolean; code: string; enable_hint: string };
      expect(parsed.ok).toBe(false);
      expect(parsed.code).toBe("resolve_disabled");
      expect(parsed.enable_hint).toContain(RESOLVE_SECRET_ENV);
      // No audit "get" event: the value was never read.
      expect(store.listAudit(50).some((e) => e.action === "get")).toBe(false);
    } finally {
      if (prev !== undefined) process.env[RESOLVE_SECRET_ENV] = prev;
    }
    store.close();
  });

  it("resolveSecretEnabled only accepts an explicit opt-in", () => {
    expect(resolveSecretEnabled({})).toBe(false);
    expect(resolveSecretEnabled({ [RESOLVE_SECRET_ENV]: "" })).toBe(false);
    expect(resolveSecretEnabled({ [RESOLVE_SECRET_ENV]: "0" })).toBe(false);
    expect(resolveSecretEnabled({ [RESOLVE_SECRET_ENV]: "1" })).toBe(true);
    expect(resolveSecretEnabled({ [RESOLVE_SECRET_ENV]: "true" })).toBe(true);
    expect(RESOLVE_SECRET_DESCRIPTION).toMatch(/PLAINTEXT/);
  });

  it("resolve_secret, when the user enabled it, still requires confirm_redaction", () => {
    const { store, value } = readyStore();
    const denied = resolveSecretTool(store, { name: "DEMO_KEY" }, { enabled: true });
    assertNoPlaintext(denied, value);
    const allowed = resolveSecretTool(store, { name: "DEMO_KEY", confirm_redaction: true }, { enabled: true });
    const parsed = JSON.parse(allowed.content[0]!.text) as { value: string; redact_in_transcript: boolean };
    expect(parsed.value).toBe(value);
    expect(parsed.redact_in_transcript).toBe(true);
    store.close();
  });

  it("inject_secret files expire in about a minute and are deleted on shutdown", () => {
    clearOwnInjectFiles(); // files left by earlier tests in this process
    const { dir, store, value } = readyStore();
    const result = injectSecretTool(store, dir, { name: "DEMO_KEY" });
    assertNoPlaintext(result, value);
    const parsed = JSON.parse(result.content[0]!.text) as { env_file: string; expires_at: string; instructions: string[] };
    const ttl = Date.parse(parsed.expires_at) - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
    expect(parsed.instructions.join(" ")).toMatch(/never cat/);
    expect(existsSync(parsed.env_file)).toBe(true);
    expect(clearOwnInjectFiles()).toBe(1);
    expect(existsSync(parsed.env_file)).toBe(false);
    expect(clearOwnInjectFiles()).toBe(0);
    store.close();
  });

  it("list works without an unlock step", () => {
    const { store } = readyStore();
    expect(() => listSecretsTool(store)).not.toThrow();
    store.close();
  });
});

describe("vault lifecycle MCP tools", () => {
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
    expect(parsed.storage).toBeNull();
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
    const action = buildPrimaryAction(false);
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
    const action = buildPrimaryAction(true);
    expect(action.id).toBe("cli_set");
    expect(action.recommended_path).toBe("cli_set");
    expect(action.copy_paste_command).toBe(bundledCliCommand("set"));
  });

  it("CLI_SETUP_COMMANDS.plugin_* use CURSOR_PLUGIN_ROOT bundled cli.js", () => {
    expect(CLI_SETUP_COMMANDS.plugin_setup).toBe(`${BUNDLED_CLI_NODE} setup`);
    expect(CLI_SETUP_COMMANDS.plugin_set).toBe(`${BUNDLED_CLI_NODE} set`);
    expect(CLI_SETUP_COMMANDS.plugin_setup).toContain("${CURSOR_PLUGIN_ROOT}/dist/cli.js");
  });

  it("buildPrimaryAction returns fix_node when prereq fails", () => {
    const action = buildPrimaryAction(false, false);
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
    expect(parsed.trust_line).toMatch(/keychain/i);
    expect(parsed.storage).toBeNull();
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
    store.ensure();
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

  it("set_secret via MCP without leaking secrets", () => {
    const dir = tempDir();
    const secretValue = "store-me-BUT-NEVER-LEAK-xyz";

    const store = openVault({ dataDir: dir });
    store.ensure();
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

    const again = openVault({ dataDir: dir });
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

});

describe("storage reporting", () => {
  it("reports the keychain backend and run_command without values", () => {
    const dir = tempDir();
    const kc = new MemoryKeychain();
    const store = new VaultStore(secretsStorePath(dir), { keychain: kc });
    const value = "keychain-only-value-123456";
    store.setSecret({ name: "GH", value });
    const result = vaultStatusTool(store, dir);
    assertNoPlaintext(result, value);
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown> & {
      values: { backend: string; values_on_disk: boolean };
    };
    expect(parsed.storage).toBe("keychain");
    expect(parsed.values.values_on_disk).toBe(false);
    expect(parsed.run_command).toMatch(/run -s <SECRET_NAME> -- <command>/);
    expect(parsed.migrate_command).toBeUndefined();
    store.close();
  });

  it("suggests migrate when values are on disk and a keychain exists", () => {
    const dir = tempDir();
    const store = new VaultStore(secretsStorePath(dir), { keychain: new MemoryKeychain(), storage: "file" });
    store.setSecret({ name: "GH", value: "file-value-123456" });
    const parsed = JSON.parse(vaultOnboardTool(store, dir).content[0]!.text) as Record<string, unknown>;
    expect(parsed.storage).toBe("file");
    expect(parsed.migrate_command).toMatch(/ migrate$/);
    store.close();
  });

  it("inject_secret points agents at the run command", () => {
    const { dir, store, value } = readyStore();
    const result = injectSecretTool(store, dir, { name: "DEMO_KEY" });
    assertNoPlaintext(result, value);
    expect(result.content[0]!.text).toMatch(/run -s \\"DEMO_KEY\\" -- <command>/);
    store.close();
  });
});

describe("agent-managed secrets (store_secret / remove_secret)", () => {
  const VALUE = "ghp_agentHandedThisOver_1234567890";

  function keychainStore(): { dir: string; store: VaultStore; kc: MemoryKeychain } {
    const dir = tempDir();
    const kc = new MemoryKeychain();
    const store = new VaultStore(secretsStorePath(dir), { keychain: kc });
    return { dir, store, kc };
  }

  function parse(result: { content: Array<{ text: string }> }): Record<string, any> {
    return JSON.parse(result.content[0]!.text) as Record<string, any>;
  }

  function auditText(dir: string): string {
    const path = auditLogPath(dir);
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  }

  it("stores a new secret (creating the store), returns how to use it by name, never the value", () => {
    const { dir, store, kc } = keychainStore();
    expect(store.isInitialized()).toBe(false);
    const result = storeSecretTool(store, { name: "GITHUB_TOKEN", value: VALUE, notes: "repo access" });
    assertNoPlaintext(result, VALUE);
    expect(result.isError).toBeUndefined();
    expect(result._meta?.redact_in_transcript).toBe(true);
    const p = parse(result);
    expect(p.ok).toBe(true);
    expect(p.action).toBe("created");
    expect(p.secret.name).toBe("GITHUB_TOKEN");
    expect(p.secret.notes).toBe("repo access");
    expect(p.storage).toBe("keychain");
    expect(p.env_var).toBe("GITHUB_TOKEN");
    expect(p.run_command).toMatch(/run -s "GITHUB_TOKEN" -- <command>/);

    // Value is in the keychain, not in secrets.json; usable by name.
    expect([...kc.items.values()]).toContain(VALUE);
    expect(readFileSync(secretsStorePath(dir), "utf8")).not.toContain(VALUE);
    expect(store.getSecret("GITHUB_TOKEN").value).toBe(VALUE);
    store.close();
  });

  it("audit-logs adds and removes by name with the agent actor, never the value", () => {
    const { dir, store } = keychainStore();
    storeSecretTool(store, { name: "OPENAI_API_KEY", value: VALUE });
    storeSecretTool(store, { name: "OPENAI_API_KEY", value: `${VALUE}-rotated`, overwrite: true });
    removeSecretTool(store, "OPENAI_API_KEY");
    const log = auditText(dir);
    expect(log).not.toContain(VALUE);
    const events = log
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { action: string; secretName: string; actor: string })
      .filter((e) => e.secretName === "OPENAI_API_KEY");
    expect(events.map((e) => [e.action, e.actor])).toEqual([
      ["create", AGENT_ACTOR],
      ["update", AGENT_ACTOR],
      ["delete", AGENT_ACTOR],
    ]);
    store.close();
  });

  it("refuses to replace an existing name without overwrite", () => {
    const { store } = keychainStore();
    storeSecretTool(store, { name: "GITHUB_TOKEN", value: VALUE });
    const other = "ghp_aDifferentValue_0987654321";
    const result = storeSecretTool(store, { name: "github_token", value: other });
    assertNoPlaintext(result, VALUE);
    assertNoPlaintext(result, other);
    expect(result.isError).toBe(true);
    const p = parse(result);
    expect(p.ok).toBe(false);
    expect(p.code).toBe("already_exists");
    expect(p.how_to_replace).toMatch(/overwrite: true/);
    expect(p.run_command).toMatch(/GITHUB_TOKEN/);
    expect(store.getSecret("GITHUB_TOKEN").value).toBe(VALUE);
    store.close();
  });

  it("replaces with overwrite: true, keeping the stored name, id, tags and notes", () => {
    const { store } = keychainStore();
    const first = parse(storeSecretTool(store, { name: "GITHUB_TOKEN", value: VALUE, tags: ["git"], notes: "ci" }));
    const rotated = "ghp_rotated_value_1111111111";
    const result = storeSecretTool(store, { name: "github_token", value: rotated, overwrite: true });
    assertNoPlaintext(result, rotated);
    const p = parse(result);
    expect(p.ok).toBe(true);
    expect(p.action).toBe("updated");
    expect(p.secret.name).toBe("GITHUB_TOKEN");
    expect(p.secret.id).toBe(first.secret.id);
    expect(p.secret.tags).toEqual(["git"]);
    expect(p.secret.notes).toBe("ci");
    expect(store.listSecrets()).toHaveLength(1);
    expect(store.getSecret("GITHUB_TOKEN").value).toBe(rotated);
    store.close();
  });

  it("rejects a value that would end up in plain-text name, notes or tags", () => {
    const { store } = keychainStore();
    for (const args of [
      { name: `key ${VALUE}`, value: VALUE },
      { name: "K", value: VALUE, notes: `token is ${VALUE}` },
      { name: "K", value: VALUE, tags: [VALUE] },
    ]) {
      const result = storeSecretTool(store, args);
      expect(result.isError).toBe(true);
      expect(parse(result).code).toBe("value_in_metadata");
      assertNoPlaintext(result, VALUE);
    }
    expect(store.isInitialized() ? store.listSecrets() : []).toHaveLength(0);
    store.close();
  });

  it("rejects empty or multi-line names", () => {
    const { store } = keychainStore();
    expect(parse(storeSecretTool(store, { name: "  ", value: VALUE })).code).toBe("invalid_name");
    expect(parse(storeSecretTool(store, { name: "A\nB", value: VALUE })).code).toBe("invalid_name");
    expect(parse(storeSecretTool(store, { name: "x".repeat(129), value: VALUE })).code).toBe("invalid_name");
    expect(parse(storeSecretTool(store, { name: "OK", value: "" })).code).toBe("invalid_value");
    store.close();
  });

  it("keeps the keychain size-limit message and scrubs the value from any error", () => {
    const dir = tempDir();
    const tooLong = new MemoryKeychain();
    const store = new VaultStore(secretsStorePath(dir), { keychain: tooLong });
    store.ensure();
    expect(store.storageInfo().backend).toBe("keychain");
    // Simulate the macOS backend refusing an oversized value (message shape from keychain.ts).
    tooLong.set = (_account: string, value: string) => {
      throw new Error(
        `Secret is too long for the macOS Keychain helper (${Buffer.byteLength(value)} bytes, about 1900 allowed). Value was ${value}`,
      );
    };
    let message = "";
    try {
      storeSecretTool(store, { name: "BIG_CERT", value: VALUE });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/too long for the macOS Keychain helper/);
    expect(message).toMatch(/1900 allowed/);
    expect(message).not.toContain(VALUE);
    expect(message).toContain("[REDACTED]");
    expect(store.hasSecret("BIG_CERT")).toBe(false);
    store.close();
  });

  it("scrubValue replaces every occurrence", () => {
    expect(scrubValue("a SECRET b SECRET", "SECRET")).toBe("a [REDACTED] b [REDACTED]");
    expect(scrubValue("nothing", undefined)).toBe("nothing");
  });

  it("remove_secret deletes the name and the keychain value", () => {
    const { dir, store, kc } = keychainStore();
    storeSecretTool(store, { name: "GITHUB_TOKEN", value: VALUE });
    storeSecretTool(store, { name: "OTHER", value: "other-value-abcdef" });
    const result = removeSecretTool(store, "github_token");
    assertNoPlaintext(result, VALUE);
    const p = parse(result);
    expect(p.ok).toBe(true);
    expect(p.removed).toBe("GITHUB_TOKEN");
    expect(store.hasSecret("GITHUB_TOKEN")).toBe(false);
    expect([...kc.items.values()]).not.toContain(VALUE);
    expect(store.listSecrets().map((m) => m.name)).toEqual(["OTHER"]);
    expect(readFileSync(secretsStorePath(dir), "utf8")).not.toContain("GITHUB_TOKEN");
    store.close();
  });

  it("remove_secret on an unknown name changes nothing and lists what exists", () => {
    const { store } = keychainStore();
    storeSecretTool(store, { name: "GITHUB_TOKEN", value: VALUE });
    const result = removeSecretTool(store, "NOPE");
    expect(result.isError).toBe(true);
    const p = parse(result);
    expect(p.code).toBe("not_found");
    expect(p.available).toEqual(["GITHUB_TOKEN"]);
    expect(store.hasSecret("GITHUB_TOKEN")).toBe(true);
    store.close();
  });

  it("remove_secret before setup explains how to set up", () => {
    const { store } = keychainStore();
    expect(() => removeSecretTool(store, "X")).toThrow(/not set up/);
    store.close();
  });

  it("legacy tool names point at the same implementations", () => {
    expect(vaultSetSecretTool).toBe(storeSecretTool);
    expect(vaultDeleteSecretTool).toBe(removeSecretTool);
  });
});
