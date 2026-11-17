import { describe, expect, it } from "vitest";
import {
  LinuxSecretService,
  MacKeychain,
  WindowsCredentialManager,
  decodeMacValue,
  encodeMacValue,
  probeKeychain,
  type Keychain,
  type RunResult,
  type Runner,
} from "./keychain.js";

type Call = { cmd: string; args: string[]; input?: string };

function fakeRunner(handler: (c: Call) => Partial<RunResult>): { run: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const run: Runner = (cmd, args, input) => {
    const c = { cmd, args, input };
    calls.push(c);
    return { status: 0, stdout: "", stderr: "", ...handler(c) };
  };
  return { run, calls };
}

const SECRET = "s3cret value with 'quotes' \"and\" $dollars";

describe("macOS backend", () => {
  it("never puts the value on the command line", () => {
    const { run, calls } = fakeRunner(() => ({}));
    new MacKeychain(run, null).set("store:id-1", SECRET, "password-space:API KEY");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(["-i"]);
    expect(calls[0]!.args.join(" ")).not.toContain("s3cret");
    const line = calls[0]!.input!;
    expect(line).toMatch(/^add-generic-password -U -s password-space -a store:id-1 -l password-space:API_KEY -X [0-9a-f]+\n$/);
    const hex = /-X ([0-9a-f]+)/.exec(line)![1]!;
    expect(Buffer.from(hex, "hex").toString("utf8")).toBe(SECRET);
  });

  it("maps exit 44 to a missing item and strips one trailing newline", () => {
    let status = 44;
    const { run } = fakeRunner(() => ({ status, stdout: "abc\n\n" }));
    const kc = new MacKeychain(run, null);
    expect(kc.get("a")).toBeNull();
    status = 0;
    expect(kc.get("a")).toBe("abc\n");
  });

  it("base64-wraps values that are not plain printable ASCII", () => {
    for (const v of ["plain-ascii", "multi\nline", "ünïcødé", "b64:looks-encoded", ""]) {
      expect(decodeMacValue(encodeMacValue(v))).toBe(v);
    }
    expect(encodeMacValue("plain-ascii")).toBe("plain-ascii");
    expect(encodeMacValue("multi\nline")).toMatch(/^b64:/);
  });

  it("passes a custom keychain path to every command", () => {
    const { run, calls } = fakeRunner(() => ({ stdout: "v\n" }));
    const kc = new MacKeychain(run, "/tmp/ci.keychain-db");
    kc.get("a");
    kc.set("a", "v", "l");
    kc.delete("a");
    expect(calls[0]!.args.at(-1)).toBe("/tmp/ci.keychain-db");
    expect(calls[1]!.input!.trim().endsWith("/tmp/ci.keychain-db")).toBe(true);
    expect(calls[2]!.args.at(-1)).toBe("/tmp/ci.keychain-db");
  });

  it("refuses values too long for one security -i line", () => {
    const { run, calls } = fakeRunner(() => ({}));
    const kc = new MacKeychain(run, null);
    kc.set("a", "x".repeat(1800), "l");
    expect(() => kc.set("a", "x".repeat(2100), "l")).toThrow(/too long/);
    expect(calls).toHaveLength(1);
  });

  it("treats errors printed by security -i as failures", () => {
    const { run } = fakeRunner(() => ({ stderr: "security: SecKeychainItemCreateFromContent: User interaction is not allowed." }));
    expect(() => new MacKeychain(run, null).set("a", "v", "l")).toThrow(/write failed/);
  });
});

describe("Linux backend", () => {
  it("sends the value on stdin and distinguishes missing from broken", () => {
    const { run, calls } = fakeRunner((c) => {
      if (c.args[0] === "lookup" && c.args[4] === "missing") return { status: 1 };
      if (c.args[0] === "lookup" && c.args[4] === "broken") {
        return { status: 1, stderr: "secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY" };
      }
      return { stdout: "value" };
    });
    const kc = new LinuxSecretService(run);
    kc.set("acct", SECRET, "label");
    expect(calls[0]!.input).toBe(SECRET);
    expect(calls[0]!.args).toEqual(["store", "--label=label", "service", "password-space", "account", "acct"]);
    expect(kc.get("missing")).toBeNull();
    expect(() => kc.get("broken")).toThrow(/D-Bus/);
    expect(kc.get("acct")).toBe("value");
  });
});

describe("Windows backend", () => {
  it("sends a JSON request with a base64 value on stdin", () => {
    const { run, calls } = fakeRunner((c) => {
      const req = JSON.parse(c.input!);
      if (req.op === "get") {
        return { stdout: JSON.stringify({ ok: true, value: Buffer.from("héllo").toString("base64"), error: null }) };
      }
      return { stdout: JSON.stringify({ ok: true, value: null, error: null }) };
    });
    const kc = new WindowsCredentialManager(run);
    kc.set("store:id", SECRET, "password-space:NAME");
    const req = JSON.parse(calls[0]!.input!);
    expect(req).toMatchObject({ op: "set", target: "password-space:store:id" });
    expect(Buffer.from(req.value, "base64").toString("utf8")).toBe(SECRET);
    expect(calls[0]!.args.join(" ")).not.toContain("s3cret");
    expect(kc.get("store:id")).toBe("héllo");
  });

  it("rejects values over the Credential Manager size limit", () => {
    const { run } = fakeRunner(() => ({}));
    expect(() => new WindowsCredentialManager(run).set("a", "x".repeat(3000), "l")).toThrow(/2560/);
  });

  it("surfaces script errors", () => {
    const { run } = fakeRunner(() => ({ stdout: JSON.stringify({ ok: false, value: null, error: "Access denied" }) }));
    expect(() => new WindowsCredentialManager(run).get("a")).toThrow(/Access denied/);
  });
});

describe("probeKeychain", () => {
  it("reports a failing keychain instead of throwing", () => {
    const broken: Keychain = {
      kind: "memory",
      description: "broken",
      get: () => null,
      set: () => {
        throw new Error("locked");
      },
      delete: () => {},
    };
    expect(probeKeychain(broken)).toEqual({ ok: false, reason: "locked" });
  });
});

/**
 * Real keychain round-trip. Off by default; CI turns it on per OS with
 * PASSWORD_SPACE_KEYCHAIN_IT=1 (see .github/workflows/keychain.yml).
 */
describe.runIf(process.env.PASSWORD_SPACE_KEYCHAIN_IT === "1")("real OS keychain", () => {
  function real(): Keychain {
    if (process.platform === "darwin") return new MacKeychain();
    if (process.platform === "win32") return new WindowsCredentialManager();
    return new LinuxSecretService();
  }

  // Windows: every call starts PowerShell and compiles the helper (~1-2 s).
  it("round-trips tricky values and deletes them", { timeout: 180_000 }, () => {
    const kc = real();
    const account = `it-${process.pid}-${Date.now()}`;
    for (const v of [SECRET, "line1\nline2\n", "ünïcødé ✓", "x".repeat(1500), "b64:not-really"]) {
      kc.set(account, v, "password-space:it");
      expect(kc.get(account)).toBe(v);
    }
    kc.delete(account);
    expect(kc.get(account)).toBeNull();
    kc.delete(account); // idempotent
    expect(probeKeychain(kc)).toEqual({ ok: true });
  });
});
