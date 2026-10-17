import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultStore } from "@password-space/vault";
import {
  assertNoPlaintext,
  getSecretMetadataTool,
  injectSecretTool,
  listSecretsTool,
  resolveSecretTool,
} from "./tools.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

async function unlockedStore(): Promise<{ dir: string; store: VaultStore; value: string }> {
  const dir = mkdtempSync(join(tmpdir(), "ps-mcp-"));
  dirs.push(dir);
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
