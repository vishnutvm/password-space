import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultStore } from "./store.js";
import { redactSecrets, looksLikeSecretLeak } from "./redact.js";
import {
  DEFAULT_INJECT_TTL_MS,
  clearExpiredInjectFiles,
  scheduleInjectCleanup,
  writeInjectFile,
} from "./inject.js";
import { auditLogPath, secretsStorePath } from "./paths.js";

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

  it("hasSecret matches names case-insensitively and ids exactly", () => {
    const { store } = tmpVault();
    store.ensure();
    const meta = store.setSecret({ name: "GitHub Token", value: "v-123456" });
    expect(store.hasSecret("github token")).toBe(true);
    expect(store.hasSecret(meta.id)).toBe(true);
    expect(store.hasSecret("nope")).toBe(false);
    store.close();
  });

  it("records the actor for set and delete in the audit log, never the value", () => {
    const { dir, store } = tmpVault();
    store.ensure();
    store.setSecret({ name: "K", value: "audit-value-987654", actor: "mcp-agent" });
    store.deleteSecret("K", "mcp-agent");
    store.setSecret({ name: "H", value: "human-value-987654" });
    const log = readFileSync(auditLogPath(dir), "utf8");
    expect(log).not.toContain("audit-value-987654");
    expect(log).not.toContain("human-value-987654");
    const events = store.listAudit().filter((e) => e.secretName);
    expect(events.map((e) => [e.action, e.secretName, e.actor])).toEqual([
      ["create", "H", "human"],
      ["delete", "K", "mcp-agent"],
      ["create", "K", "mcp-agent"],
    ]);
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

  it("defaults to a one-minute TTL in an owner-only directory", () => {
    const { dir } = tmpVault();
    expect(DEFAULT_INJECT_TTL_MS).toBe(60_000);
    mkdirSync(join(dir, "inject"), { recursive: true, mode: 0o755 });
    const handle = writeInjectFile(dir, { secretId: "i", secretName: "K", value: "v-123456" });
    const ttl = Date.parse(handle.expiresAt) - Date.now();
    expect(ttl).toBeLessThanOrEqual(60_000);
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "inject")).mode & 0o777).toBe(0o700);
      expect(statSync(handle.envFile).mode & 0o777).toBe(0o600);
    }
  });

  it("scheduleInjectCleanup deletes the file when it expires", () => {
    vi.useFakeTimers();
    try {
      const { dir } = tmpVault();
      const handle = writeInjectFile(dir, { secretId: "i", secretName: "K", value: "v-123456", ttlMs: 1000 });
      let cleared = false;
      scheduleInjectCleanup(handle.envFile, handle.expiresAt, Date.now(), () => (cleared = true));
      vi.advanceTimersByTime(999);
      expect(existsSync(handle.envFile)).toBe(true);
      vi.advanceTimersByTime(2);
      expect(existsSync(handle.envFile)).toBe(false);
      expect(cleared).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("scheduleInjectCleanup can be cancelled", () => {
    vi.useFakeTimers();
    try {
      const { dir } = tmpVault();
      const handle = writeInjectFile(dir, { secretId: "i", secretName: "K", value: "v-123456", ttlMs: 1000 });
      const cancel = scheduleInjectCleanup(handle.envFile, handle.expiresAt);
      cancel();
      vi.advanceTimersByTime(5000);
      expect(existsSync(handle.envFile)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clearExpiredInjectFiles falls back to mtime for files without a header", () => {
    const { dir } = tmpVault();
    const inject = join(dir, "inject");
    mkdirSync(inject, { recursive: true });
    const stale = join(inject, "stale.env");
    const fresh = join(inject, "fresh.env");
    writeFileSync(stale, "SECRET='x'\n", { mode: 0o600 });
    writeFileSync(fresh, "SECRET='y'\n", { mode: 0o600 });
    const old = (Date.now() - 2 * DEFAULT_INJECT_TTL_MS) / 1000;
    utimesSync(stale, old, old);
    expect(clearExpiredInjectFiles(dir)).toBe(1);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});
