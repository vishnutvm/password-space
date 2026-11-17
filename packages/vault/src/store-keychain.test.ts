import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultStore } from "./store.js";
import { MemoryKeychain, type Keychain } from "./keychain.js";
import { loadPromptGuard } from "./guard.js";
import { secretsStorePath } from "./paths.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "ps-kc-"));
  dirs.push(d);
  return d;
}

const VALUE = "ghp_keychainvalue_1234567890";

describe("keychain backend", () => {
  it("keeps values out of secrets.json and in the keychain", () => {
    const dir = tmp();
    const kc = new MemoryKeychain();
    const store = new VaultStore(secretsStorePath(dir), { keychain: kc });
    store.ensure();
    expect(store.backend).toBe("keychain");
    store.setSecret({ name: "GITHUB_TOKEN", value: VALUE, tags: ["gh"] });

    const onDisk = readFileSync(secretsStorePath(dir), "utf8");
    expect(onDisk).not.toContain(VALUE);
    expect(JSON.parse(onDisk).backend).toBe("keychain");
    expect([...kc.items.values()]).toContain(VALUE);

    const reopened = new VaultStore(secretsStorePath(dir), { keychain: kc });
    expect(reopened.getSecret("GITHUB_TOKEN").value).toBe(VALUE);
    expect(reopened.listSecrets()[0]).not.toHaveProperty("value");
    expect(reopened.storageInfo()).toMatchObject({ backend: "keychain", values_on_disk: false });

    reopened.setSecret({ name: "GITHUB_TOKEN", value: "rotated-value-abcdef" });
    expect(reopened.getSecret("GITHUB_TOKEN").value).toBe("rotated-value-abcdef");
    reopened.deleteSecret("GITHUB_TOKEN");
    // only the guard key is left
    expect([...kc.items.keys()].every((k) => k.endsWith(":guard-key"))).toBe(true);
  });

  it("does not record anything when the keychain write fails", () => {
    const dir = tmp();
    const kc = new MemoryKeychain();
    const store = new VaultStore(secretsStorePath(dir), { keychain: kc });
    store.ensure();
    kc.set = () => {
      throw new Error("keychain locked");
    };
    expect(() => store.setSecret({ name: "X", value: VALUE })).toThrow(/locked/);
    expect(new VaultStore(secretsStorePath(dir), { keychain: kc }).listSecrets()).toHaveLength(0);
  });

  it("explains a value missing from the keychain", () => {
    const dir = tmp();
    const kc = new MemoryKeychain();
    const store = new VaultStore(secretsStorePath(dir), { keychain: kc });
    store.setSecret({ name: "GONE", value: VALUE });
    for (const k of [...kc.items.keys()]) if (!k.endsWith("guard-key")) kc.items.delete(k);
    expect(() => store.getSecret("GONE")).toThrow(/missing from the in-memory keychain/);
  });
});

describe("fallback without a keychain", () => {
  it("auto uses the file backend and says why", () => {
    const dir = tmp();
    const store = new VaultStore(secretsStorePath(dir), { keychain: null });
    store.ensure();
    expect(store.storageInfo()).toMatchObject({
      backend: "file",
      values_on_disk: true,
      migration_available: false,
      fallback_reason: expect.stringMatching(/no OS keychain/),
    });
    store.setSecret({ name: "A", value: VALUE });
    expect(readFileSync(secretsStorePath(dir), "utf8")).toContain(VALUE);
  });

  it("auto falls back when the keychain exists but is unusable", () => {
    const kc = new MemoryKeychain();
    kc.set = () => {
      throw new Error("Cannot autolaunch D-Bus");
    };
    const store = new VaultStore(secretsStorePath(tmp()), { keychain: kc });
    store.ensure();
    expect(store.backend).toBe("file");
    expect(store.storageInfo().fallback_reason).toMatch(/D-Bus/);
  });

  it("storage=keychain refuses to fall back", () => {
    const store = new VaultStore(secretsStorePath(tmp()), { keychain: null, storage: "keychain" });
    expect(() => store.ensure()).toThrow(/PASSWORD_SPACE_STORAGE=keychain/);
  });

  it("storage=file never touches the keychain", () => {
    const kc = new MemoryKeychain();
    const store = new VaultStore(secretsStorePath(tmp()), { keychain: kc, storage: "file" });
    store.setSecret({ name: "A", value: VALUE });
    expect(kc.items.size).toBe(0);
    expect(store.storageInfo().migration_available).toBe(true);
  });
});

describe("migration", () => {
  function v1Store(dir: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      secretsStorePath(dir),
      JSON.stringify({
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        secrets: [
          { id: "id-a", name: "A", value: VALUE, tags: ["x"], notes: null, createdAt: "t", updatedAt: "t" },
          { id: "id-b", name: "B", value: "multi\nline ✓ value", tags: [], notes: "n", createdAt: "t", updatedAt: "t" },
        ],
      }),
    );
  }

  it("reads a v1 plain secrets.json as the file backend", () => {
    const dir = tmp();
    v1Store(dir);
    const store = new VaultStore(secretsStorePath(dir), { keychain: new MemoryKeychain() });
    expect(store.backend).toBe("file");
    expect(store.getSecret("A").value).toBe(VALUE);
    expect(store.storageInfo().migration_available).toBe(true);
  });

  it("moves v1 values into the keychain and back", () => {
    const dir = tmp();
    v1Store(dir);
    const kc = new MemoryKeychain();
    const store = new VaultStore(secretsStorePath(dir), { keychain: kc });
    expect(store.migrate("keychain")).toEqual({ moved: 2, from: "file", to: "keychain" });

    const onDisk = readFileSync(secretsStorePath(dir), "utf8");
    expect(onDisk).not.toContain(VALUE);
    expect(onDisk).not.toContain("multi");
    const reopened = new VaultStore(secretsStorePath(dir), { keychain: kc });
    expect(reopened.backend).toBe("keychain");
    expect(reopened.getSecret("B").value).toBe("multi\nline ✓ value");
    expect(reopened.getMetadata("A")).toMatchObject({ id: "id-a", tags: ["x"] });
    expect(reopened.migrate("keychain").moved).toBe(0);

    expect(reopened.migrate("file")).toMatchObject({ moved: 2, to: "file" });
    expect(kc.items.size).toBe(0);
    const back = new VaultStore(secretsStorePath(dir), { keychain: kc });
    expect(back.getSecret("A").value).toBe(VALUE);
    expect(readFileSync(secretsStorePath(dir), "utf8")).toContain(VALUE);
  });

  it("leaves the file store untouched when a keychain write fails part-way", () => {
    const dir = tmp();
    v1Store(dir);
    const before = readFileSync(secretsStorePath(dir), "utf8");
    const kc = new MemoryKeychain();
    let writes = 0;
    const realSet = kc.set.bind(kc);
    kc.set = (a: string, v: string) => {
      // let the probe (set) through, then fail on the second secret
      writes++;
      if (writes === 3) throw new Error("disk full");
      realSet(a, v);
    };
    const store = new VaultStore(secretsStorePath(dir), { keychain: kc });
    expect(() => store.migrate("keychain")).toThrow(/disk full/);
    expect(readFileSync(secretsStorePath(dir), "utf8")).toBe(before);
    expect(kc.items.size).toBe(0);
    expect(store.getSecret("A").value).toBe(VALUE);
  });

  it("refuses when the read-back does not match", () => {
    const dir = tmp();
    v1Store(dir);
    const kc: Keychain = Object.assign(new MemoryKeychain(), {});
    const mem = kc as MemoryKeychain;
    const realGet = mem.get.bind(mem);
    mem.get = (a: string) => (a.endsWith("id-b") ? "corrupted" : realGet(a));
    const store = new VaultStore(secretsStorePath(dir), { keychain: kc });
    expect(() => store.migrate("keychain")).toThrow(/Read-back/);
    expect(new VaultStore(secretsStorePath(dir), { keychain: kc }).backend).toBe("file");
  });
});

describe("prompt guard", () => {
  it("detects keychain values by fingerprint without reading them", () => {
    const dir = tmp();
    const kc = new MemoryKeychain();
    const store = new VaultStore(secretsStorePath(dir), { keychain: kc });
    store.setSecret({ name: "GITHUB_TOKEN", value: VALUE });
    store.setSecret({ name: "SHORT", value: "abc" });

    const reads: string[] = [];
    const realGet = kc.get.bind(kc);
    kc.get = (a: string) => {
      reads.push(a);
      return realGet(a);
    };
    const guard = loadPromptGuard(dir, { keychain: kc });
    expect(reads.every((a) => a.endsWith(":guard-key"))).toBe(true);
    expect(guard.size).toBe(1);
    expect(guard.check(`please use ${VALUE} for the push`)).toEqual(["GITHUB_TOKEN"]);
    expect(guard.check("token=" + VALUE)).toEqual(["GITHUB_TOKEN"]);
    expect(guard.check(VALUE.slice(0, -1))).toEqual([]);
    expect(guard.redact(`a ${VALUE} b ${VALUE}`)).toBe("a [REDACTED] b [REDACTED]");
    expect(guard.warnings).toEqual([]);
  });

  it("detects file-backend values and inject files", () => {
    const dir = tmp();
    const store = new VaultStore(secretsStorePath(dir), { keychain: null });
    store.setSecret({ name: "PLAIN", value: VALUE });
    mkdirSync(join(dir, "inject"), { recursive: true });
    writeFileSync(join(dir, "inject", "t.env"), "# header\nAPI_KEY='inj'\\''ected-value'\n");
    const guard = loadPromptGuard(dir, { keychain: null });
    expect(guard.check(`x ${VALUE} y inj'ected-value`).sort()).toEqual(["API_KEY", "PLAIN"]);
  });

  it("warns instead of throwing when the keychain is unreachable", () => {
    const dir = tmp();
    const kc = new MemoryKeychain();
    new VaultStore(secretsStorePath(dir), { keychain: kc }).setSecret({ name: "K", value: VALUE });
    kc.get = () => {
      throw new Error("keychain locked");
    };
    const guard = loadPromptGuard(dir, { keychain: kc });
    expect(guard.check(VALUE)).toEqual([]);
    expect(guard.warnings.join()).toMatch(/cannot check 1 keychain secret.*locked/);
  });

  it("returns an empty guard when there is no store", () => {
    expect(loadPromptGuard(tmp(), { keychain: null }).size).toBe(0);
  });

  it("finds values in long text via word-boundary windows", () => {
    const dir = tmp();
    const kc = new MemoryKeychain();
    new VaultStore(secretsStorePath(dir), { keychain: kc }).setSecret({ name: "K", value: VALUE });
    const guard = loadPromptGuard(dir, { keychain: kc });
    const filler = "lorem ipsum dolor sit amet ".repeat(20_000);
    expect(guard.check(`${filler} Authorization: Bearer ${VALUE}\n${filler}`)).toEqual(["K"]);
  });
});

describe.runIf(process.env.PASSWORD_SPACE_KEYCHAIN_IT === "1")("real OS keychain store", () => {
  it("set → guard → migrate to file → back to keychain → delete", { timeout: 180_000 }, async () => {
    const { MacKeychain, WindowsCredentialManager, LinuxSecretService } = await import("./keychain.js");
    const kc: Keychain =
      process.platform === "darwin"
        ? new MacKeychain()
        : process.platform === "win32"
          ? new WindowsCredentialManager()
          : new LinuxSecretService();
    const dir = tmp();
    const store = new VaultStore(secretsStorePath(dir), { keychain: kc, storage: "keychain" });
    store.setSecret({ name: "IT_TOKEN", value: VALUE });
    expect(readFileSync(secretsStorePath(dir), "utf8")).not.toContain(VALUE);
    expect(loadPromptGuard(dir, { keychain: kc }).check(`use ${VALUE}`)).toEqual(["IT_TOKEN"]);
    store.migrate("file");
    expect(store.getSecret("IT_TOKEN").value).toBe(VALUE);
    store.migrate("keychain");
    expect(new VaultStore(secretsStorePath(dir), { keychain: kc }).getSecret("IT_TOKEN").value).toBe(VALUE);
    store.deleteSecret("IT_TOKEN");
    store.migrate("file"); // removes the guard key from the keychain
  });
});
