import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { openVault } from "@password-space/vault";
import { StreamRedactor, envNameFor, parseRunArgs, quoteWindowsArg } from "./run.js";

describe("parseRunArgs", () => {
  it("splits options from the command at --", () => {
    expect(parseRunArgs(["-s", "GITHUB_TOKEN", "-s", "KEY=openai prod", "--", "gh", "-d", "--all"])).toEqual({
      specs: [{ name: "GITHUB_TOKEN" }, { envVar: "KEY", name: "openai prod" }],
      all: false,
      command: ["gh", "-d", "--all"],
    });
  });

  it("stops at the first non-option without --", () => {
    const o = parseRunArgs(["--all", "--no-redact", "env"]);
    expect(o).toMatchObject({ all: true, redact: false, command: ["env"] });
  });

  it("rejects unknown options", () => {
    expect(() => parseRunArgs(["--bogus", "--", "x"])).toThrow(/Unknown run option/);
  });
});

describe("envNameFor", () => {
  it("derives shell-safe names", () => {
    expect(envNameFor("github token")).toBe("GITHUB_TOKEN");
    expect(envNameFor("openai-api-key")).toBe("OPENAI_API_KEY");
    expect(envNameFor("1password")).toBe("_1PASSWORD");
    expect(envNameFor("***")).toBe("SECRET");
  });
});

describe("quoteWindowsArg", () => {
  it("leaves plain arguments alone", () => {
    expect(quoteWindowsArg("gh")).toBe("gh");
    expect(quoteWindowsArg("--flag=1")).toBe("--flag=1");
    expect(quoteWindowsArg("C:\\tools\\node.exe")).toBe("C:\\tools\\node.exe");
  });

  it("quotes paths with spaces and scripts with quotes", () => {
    expect(quoteWindowsArg("C:\\Program Files\\nodejs\\node.exe")).toBe('"C:\\Program Files\\nodejs\\node.exe"');
    expect(quoteWindowsArg("console.log('a b')")).toBe(`"console.log('a b')"`);
    expect(quoteWindowsArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteWindowsArg("")).toBe('""');
    expect(quoteWindowsArg("dir with space\\")).toBe('"dir with space\\\\"');
  });
});

describe("StreamRedactor", () => {
  it("catches a value split across chunks", () => {
    let out = "";
    const r = new StreamRedactor(["supersecret-123"], (s) => (out += s));
    r.push(Buffer.from("token: super"));
    r.push(Buffer.from("secret-123 done\nsupersecret-1"));
    r.push(Buffer.from("23"));
    r.end();
    expect(out).toBe("token: [REDACTED] done\n[REDACTED]");
  });

  it("handles multi-byte characters split across chunks", () => {
    let out = "";
    const r = new StreamRedactor(["ünïcødé-secret"], (s) => (out += s));
    const bytes = Buffer.from("a ünïcødé-secret ✓ b");
    for (let i = 0; i < bytes.length; i += 3) r.push(bytes.subarray(i, i + 3));
    r.end();
    expect(out).toBe("a [REDACTED] ✓ b");
  });

  it("flushes a held tail after an idle gap", async () => {
    let out = "";
    const r = new StreamRedactor(["long-secret-value"], (s) => (out += s), 10);
    r.push("Password: ");
    await new Promise((res) => setTimeout(res, 40));
    expect(out).toBe("Password: ");
    r.end();
  });
});

describe("password-space run (end to end)", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  let dir: string;
  let cli: string;
  const VALUE = "e2e-secret-value-XYZ";

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ps-run-"));
    cli = join(dir, "cli.mjs");
    await build({
      entryPoints: [join(here, "index.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: cli,
      logLevel: "silent",
    });
    const store = openVault({ dataDir: join(dir, "home") });
    store.setSecret({ name: "api token", value: VALUE });
    store.close();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function run(args: string[]) {
    return spawnSync(process.execPath, [cli, "run", ...args], {
      encoding: "utf8",
      env: { ...process.env, PASSWORD_SPACE_HOME: join(dir, "home") },
    });
  }
  const printEnv = (v: string) => ["--", process.execPath, "-e", `process.stdout.write(String(process.env.${v}))`];

  it("passes the secret to the child env and redacts it from piped output", () => {
    const r = run(["-s", "api token", ...printEnv("API_TOKEN")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("[REDACTED]");
  });

  it("checks the child really received the value", () => {
    const check = `process.exit(process.env.TOKEN === ${JSON.stringify(VALUE)} ? 0 : 3)`;
    const r = run(["-s", "TOKEN=api token", "--", process.execPath, "-e", check]);
    expect(r.status).toBe(0);
  });

  it("--no-redact is refused when output is piped (agents, scripts)", () => {
    const r = run(["--no-redact", "-s", "api token", ...printEnv("API_TOKEN")]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain(VALUE);
    expect(r.stderr).toMatch(/--no-redact only works .* interactive terminal/);
  });

  it("get refuses to print a value without an interactive terminal", () => {
    for (const extra of [[], ["--json"]]) {
      const r = spawnSync(process.execPath, [cli, "get", "api token", ...extra], {
        encoding: "utf8",
        env: { ...process.env, PASSWORD_SPACE_HOME: join(dir, "home") },
      });
      expect(r.status).toBe(1);
      expect(r.stdout + r.stderr).not.toContain(VALUE);
      expect(r.stderr).toMatch(/interactive terminal/);
      expect(r.stderr).toMatch(/run -s "api token" -- <command>/);
    }
    // Piping a "y" into stdin does not help either.
    const piped = spawnSync(process.execPath, [cli, "get", "api token"], {
      encoding: "utf8",
      input: "y\n",
      env: { ...process.env, PASSWORD_SPACE_HOME: join(dir, "home") },
    });
    expect(piped.status).toBe(1);
    expect(piped.stdout).not.toContain(VALUE);
  });

  it("propagates the child's exit code", () => {
    const r = run(["-s", "api token", "--", process.execPath, "-e", "process.exit(7)"]);
    expect(r.status).toBe(7);
  });

  it("fails before running anything when a secret is unknown", () => {
    const r = run(["-s", "nope", "--", process.execPath, "-e", "console.log('ran')"]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("ran");
    expect(r.stderr).toMatch(/Secret not found: nope/);
  });

  it("reports a missing command with exit 127", () => {
    const r = run(["-s", "api token", "--", "definitely-not-a-command-ps"]);
    expect(r.status).toBe(127);
    expect(r.stderr).toMatch(/command not found/);
  });

  it("does not let a child's -d flag change the data dir", () => {
    const r = run(["-s", "api token", "--", process.execPath, "-e", "process.exit(0)", "--", "-d", "/nonexistent"]);
    expect(r.status).toBe(0);
  });
});

describe("password-space migrate / status (no keychain on this machine)", () => {
  it("reports the file backend and refuses to migrate with a clear message", () => {
    const home = mkdtempSync(join(tmpdir(), "ps-mig-"));
    try {
      const store = openVault({ dataDir: home });
      store.setSecret({ name: "A", value: "file-backend-value" });
      store.close();
      const status = store.storageInfo();
      expect(status).toMatchObject({ backend: "file", values_on_disk: true, migration_available: false });
      const again = openVault({ dataDir: home });
      expect(() => again.migrate("keychain")).toThrow(/no keychain is available/);
      expect(again.getSecret("A").value).toBe("file-backend-value");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
