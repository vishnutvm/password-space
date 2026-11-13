import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultStore } from "./store.js";
import { VaultError } from "./types.js";
import {
  writeSession,
  readSession,
  clearSession,
  parseSessionTtlInput,
  SESSION_TTL_1_DAY_MS,
  SESSION_TTL_1_WEEK_MS,
} from "./session.js";
import { redactSecrets, looksLikeSecretLeak } from "./redact.js";
import { writeInjectFile, clearExpiredInjectFiles } from "./inject.js";
import { secretsStorePath } from "./paths.js";

const dirs: string[] = [];

function tmpVault(): { dir: string; store: VaultStore } {
  const dir = mkdtempSync(join(tmpdir(), "ps-vault-"));
  dirs.push(dir);
  return { dir, store: new VaultStore(secretsStorePath(dir)) };
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe("VaultStore plain text", () => {
  it("ensure → set/list/get/delete without unlock", async () => {
    const { store, dir } = tmpVault();
    expect(store.isInitialized()).toBe(false);
    store.ensure();
    expect(store.isInitialized()).toBe(true);
    expect(store.isUnlocked).toBe(true);
    expect(existsSync(secretsStorePath(dir))).toBe(true);

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

    const onDisk = readFileSync(secretsStorePath(dir), "utf8");
    expect(onDisk).toContain("ghp_supersecret123");

    const md = store.getMetadata("GITHUB_TOKEN");
    expect(md.id).toBe(meta.id);
    expect(JSON.stringify(md)).not.toContain("ghp_supersecret123");

    const full = store.getSecret("GITHUB_TOKEN");
    expect(full.value).toBe("ghp_supersecret123");

    store.deleteSecret(meta.id);
    expect(store.listSecrets()).toHaveLength(0);

    store.lock();
    expect(store.isUnlocked).toBe(true);
    store.close();
  });

  it("init is idempotent-fail and unlock is a no-op", async () => {
    const { store } = tmpVault();
    await store.init();
    await expect(store.init()).rejects.toMatchObject({ code: "ALREADY_INITIALIZED" });
    const key = await store.unlock();
    expect(key.length).toBe(0);
    expect(store.isUnlocked).toBe(true);
    store.close();
  });

  it("changePassphrase is deprecated", async () => {
    const { store } = tmpVault();
    store.ensure();
    await expect(store.changePassphrase("a", "b")).rejects.toMatchObject({
      code: "DEPRECATED",
    });
    store.close();
  });

  it("setSecret updates by name and rejects duplicate names", () => {
    const { store } = tmpVault();
    store.ensure();
    store.setSecret({ name: "A", value: "one" });
    store.setSecret({ name: "B", value: "two" });
    store.setSecret({ name: "A", value: "one-updated" });
    expect(store.getSecret("A").value).toBe("one-updated");
    expect(() => store.setSecret({ name: "B", value: "x", id: store.getMetadata("A").id })).toThrow(
      /already exists/i,
    );
    store.close();
  });

  it("session helpers still round-trip (legacy leftover files)", () => {
    const { dir } = tmpVault();
    const sessionFile = join(dir, "session");
    const key = Buffer.alloc(32, 7);
    writeSession(sessionFile, key, dir);
    key.fill(0);
    const session = readSession(sessionFile);
    expect(session.vaultKey.length).toBe(32);
    session.vaultKey.fill(0);
    clearSession(sessionFile);
    expect(existsSync(sessionFile)).toBe(false);
  });

  it("expired session is rejected and cleared", () => {
    const { dir } = tmpVault();
    const sessionFile = join(dir, "session");
    const key = Buffer.alloc(32, 3);
    writeSession(sessionFile, key, dir, -1000);
    key.fill(0);
    expect(() => readSession(sessionFile)).toThrow(VaultError);
    expect(existsSync(sessionFile)).toBe(false);
  });

  it("until-lock session never auto-expires", () => {
    const { dir } = tmpVault();
    const sessionFile = join(dir, "session");
    const key = Buffer.alloc(32, 1);
    writeSession(sessionFile, key, dir, null);
    key.fill(0);
    const session = readSession(sessionFile);
    expect(session.untilLock).toBe(true);
    expect(session.expiresAt).toBeNull();
    session.vaultKey.fill(0);
    clearSession(sessionFile);
  });

  it("parseSessionTtlInput accepts presets", () => {
    expect(parseSessionTtlInput("1d")).toBe(SESSION_TTL_1_DAY_MS);
    expect(parseSessionTtlInput("1w")).toBe(SESSION_TTL_1_WEEK_MS);
    expect(parseSessionTtlInput("until-lock")).toBeNull();
    expect(parseSessionTtlInput(2)).toBe(2 * 60 * 60 * 1000);
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

  it("clearExpiredInjectFiles removes past-TTL inject files", () => {
    const { dir } = tmpVault();
    const inject = join(dir, "inject");
    mkdirSync(inject, { recursive: true });
    const expired = join(inject, "old.env");
    const past = new Date(Date.now() - 60_000).toISOString();
    writeFileSync(
      expired,
      `# password-space inject — expires ${past}\nSECRET='x'\n`,
      { mode: 0o600 },
    );
    expect(clearExpiredInjectFiles(dir)).toBe(1);
    expect(existsSync(expired)).toBe(false);
  });
});
