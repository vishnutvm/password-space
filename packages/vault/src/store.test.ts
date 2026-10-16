import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultStore } from "./store.js";
import { VaultError } from "./types.js";
import { writeSession, readSession, clearSession } from "./session.js";
import { redactSecrets, looksLikeSecretLeak } from "./redact.js";
import { writeInjectFile } from "./inject.js";

const dirs: string[] = [];

function tmpVault(): { dir: string; store: VaultStore } {
  const dir = mkdtempSync(join(tmpdir(), "ps-vault-"));
  dirs.push(dir);
  return { dir, store: new VaultStore(join(dir, "vault.db")) };
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe("VaultStore lock state", () => {
  it("init → unlock → set/list/get/delete", async () => {
    const { store } = tmpVault();
    await store.init("test-passphrase-ok");
    expect(store.isInitialized()).toBe(true);
    expect(store.isUnlocked).toBe(false);

    expect(() => store.listSecrets()).toThrow(VaultError);

    await store.unlock("test-passphrase-ok");
    expect(store.isUnlocked).toBe(true);

    const meta = store.setSecret({
      name: "GITHUB_TOKEN",
      value: "ghp_supersecret123",
      tags: ["api", "github"],
      notes: "pat",
    });
    expect(meta.name).toBe("GITHUB_TOKEN");
    expect(meta.tags).toContain("github");

    const listed = store.listSecrets();
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("value");
    expect(JSON.stringify(listed)).not.toContain("ghp_supersecret123");

    const md = store.getMetadata("GITHUB_TOKEN");
    expect(md.id).toBe(meta.id);
    expect(JSON.stringify(md)).not.toContain("ghp_supersecret123");

    const full = store.getSecret("GITHUB_TOKEN");
    expect(full.value).toBe("ghp_supersecret123");

    store.deleteSecret(meta.id);
    expect(store.listSecrets()).toHaveLength(0);

    store.lock();
    expect(store.isUnlocked).toBe(false);
    store.close();
  });

  it("rejects wrong passphrase", async () => {
    const { store } = tmpVault();
    await store.init("test-passphrase-ok");
    await expect(store.unlock("wrong-passphrase!!")).rejects.toMatchObject({
      code: "WRONG_PASSPHRASE",
    });
    store.close();
  });

  it("session write/read restores vault key", async () => {
    const { dir, store } = tmpVault();
    await store.init("test-passphrase-ok");
    const key = await store.unlock("test-passphrase-ok");
    const sessionFile = join(dir, "session");
    writeSession(sessionFile, key, dir);
    key.fill(0);
    store.lock();

    const session = readSession(sessionFile);
    store.unlockWithKey(session.vaultKey);
    store.setSecret({ name: "x", value: "y" });
    expect(store.getSecret("x").value).toBe("y");
    session.vaultKey.fill(0);
    clearSession(sessionFile);
    store.close();
  });

  it("expired session is rejected and cleared", async () => {
    const { dir, store } = tmpVault();
    await store.init("test-passphrase-ok");
    const key = await store.unlock("test-passphrase-ok");
    const sessionFile = join(dir, "session");
    writeSession(sessionFile, key, dir, -1000);
    key.fill(0);
    store.lock();
    expect(() => readSession(sessionFile)).toThrow(VaultError);
    expect(existsSync(sessionFile)).toBe(false);
    store.close();
  });

  it("setSecret updates by name and rejects duplicate names", async () => {
    const { store } = tmpVault();
    await store.init("test-passphrase-ok");
    await store.unlock("test-passphrase-ok");
    store.setSecret({ name: "A", value: "one" });
    store.setSecret({ name: "B", value: "two" });
    store.setSecret({ name: "A", value: "one-updated" });
    expect(store.getSecret("A").value).toBe("one-updated");
    expect(() => store.setSecret({ name: "B", value: "x", id: store.getMetadata("A").id })).toThrow(
      /already exists/i,
    );
    store.close();
  });
});

describe("redaction", () => {
  it("strips known secrets from text", () => {
    const secrets = ["ghp_supersecret123", "short"];
    const text = "token=ghp_supersecret123 and short end";
    expect(redactSecrets(text, secrets)).toBe("token=[REDACTED] and [REDACTED] end");
    expect(looksLikeSecretLeak(text, secrets)).toBe(true);
    expect(looksLikeSecretLeak("clean", secrets)).toBe(false);
  });
});

describe("inject", () => {
  it("writes env file without putting value in handle", () => {
    const { dir } = tmpVault();
    const handle = writeInjectFile(dir, {
      secretId: "id-1",
      secretName: "API_KEY",
      value: "plain-value-xyz",
    });
    expect(handle.handle).toBe("ps://API_KEY");
    expect(handle.redact_in_transcript).toBe(true);
    expect(JSON.stringify(handle)).not.toContain("plain-value-xyz");
    const body = readFileSync(handle.envFile, "utf8");
    expect(body).toContain("plain-value-xyz");
  });
});
