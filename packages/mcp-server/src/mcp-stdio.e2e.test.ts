/**
 * End-to-end: drive the bundled plugin MCP server (plugins/password-space/dist/index.js)
 * over stdio the way an agent host does — store a secret the user handed over,
 * find it by name, use it through the bundled CLI `run`, then remove it.
 *
 * Needs `pnpm build` first (CI runs build before test). Skipped when the bundle is missing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const pluginDist = join(here, "../../../plugins/password-space/dist");
const serverJs = join(pluginDist, "index.js");
const cliJs = join(pluginDist, "cli.js");
const bundled = existsSync(serverJs) && existsSync(cliJs);

// In CI the bundle is always built first; a silent skip there would hide a regression.
if (process.env.CI && !bundled) {
  throw new Error(`Plugin bundle missing at ${pluginDist}. Run pnpm build before the tests.`);
}

/**
 * PASSWORD_SPACE_KEYCHAIN_IT=1 (the keychain workflow) runs against the real OS keychain;
 * otherwise values go to the 0600 file store so the test never touches a developer's keychain.
 */
const realKeychain = process.env.PASSWORD_SPACE_KEYCHAIN_IT === "1";

const VALUE = "ghp_e2eHandedOverByTheUser_ABCdef123456";
const ROTATED = "ghp_e2eRotatedValue_ZYXwvu987654";

type CallResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };

describe.skipIf(!bundled)("bundled MCP server over stdio", () => {
  let home: string;
  let client: Client;
  let transport: StdioClientTransport;
  let stderr = "";
  const env = (): Record<string, string> => {
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !k.startsWith("PASSWORD_SPACE_")) base[k] = v;
    }
    return {
      ...base,
      PASSWORD_SPACE_HOME: home,
      ...(realKeychain
        ? {
            PASSWORD_SPACE_STORAGE: "keychain",
            ...(process.env.PASSWORD_SPACE_MACOS_KEYCHAIN
              ? { PASSWORD_SPACE_MACOS_KEYCHAIN: process.env.PASSWORD_SPACE_MACOS_KEYCHAIN }
              : {}),
          }
        : { PASSWORD_SPACE_KEYCHAIN: "none", PASSWORD_SPACE_STORAGE: "auto" }),
    };
  };

  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({ name, arguments: args })) as CallResult;
    const text = result.content.map((c) => c.text ?? "").join("\n");
    return { result, text, json: JSON.parse(text) as Record<string, any> };
  }

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "ps-e2e-"));
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--no-warnings", serverJs],
      env: env(),
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    client = new Client({ name: "password-space-e2e", version: "0.0.0" });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("lists the add/remove tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["store_secret", "remove_secret", "list_secrets", "vault_set_secret", "vault_delete_secret"]) {
      expect(names).toContain(n);
    }
    const store = tools.find((t) => t.name === "store_secret")!;
    expect(Object.keys(store.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["name", "value", "overwrite"]),
    );
  });

  it("stores a handed-over secret on a fresh machine without echoing it", async () => {
    const { result, text, json } = await call("store_secret", {
      name: "GITHUB_TOKEN",
      value: VALUE,
      notes: "repo access for the agent",
    });
    expect(result.isError).toBeFalsy();
    expect(text).not.toContain(VALUE);
    expect(json.ok).toBe(true);
    expect(json.action).toBe("created");
    expect(json.env_var).toBe("GITHUB_TOKEN");
    expect(json.run_command).toContain("run -s");
    expect(json.storage).toBe(realKeychain ? "keychain" : "file");
    if (realKeychain) {
      expect(readFileSync(join(home, "secrets.json"), "utf8")).not.toContain(VALUE);
    }
  });

  it("finds it by name in list_secrets (names only)", async () => {
    const { text, json } = await call("list_secrets");
    expect(text).not.toContain(VALUE);
    expect(json.secrets.map((s: { name: string }) => s.name)).toEqual(["GITHUB_TOKEN"]);
  });

  it("refuses to overwrite without the flag, then replaces with overwrite: true", async () => {
    const refused = await call("store_secret", { name: "GITHUB_TOKEN", value: ROTATED });
    expect(refused.result.isError).toBe(true);
    expect(refused.json.code).toBe("already_exists");
    expect(refused.text).not.toContain(ROTATED);

    const replaced = await call("store_secret", { name: "GITHUB_TOKEN", value: ROTATED, overwrite: true });
    expect(replaced.result.isError).toBeFalsy();
    expect(replaced.json.action).toBe("updated");
    expect(replaced.text).not.toContain(ROTATED);
  });

  it("the agent uses it by name through the bundled CLI, with output redacted", () => {
    const r = spawnSync(
      process.execPath,
      [
        "--no-warnings",
        cliJs,
        "run",
        "-s",
        "GITHUB_TOKEN",
        "--",
        process.execPath,
        "-e",
        "const v = process.env.GITHUB_TOKEN || ''; console.log('len=' + v.length + ' value=' + v)",
      ],
      { env: env(), encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`len=${ROTATED.length}`);
    expect(r.stdout).toContain("value=[REDACTED]");
    expect(r.stdout).not.toContain(ROTATED);
  });

  it("removes it with remove_secret", async () => {
    const { result, text, json } = await call("remove_secret", { name: "GITHUB_TOKEN" });
    expect(result.isError).toBeFalsy();
    expect(text).not.toContain(ROTATED);
    expect(json.removed).toBe("GITHUB_TOKEN");
    expect((await call("list_secrets")).json.secrets).toEqual([]);

    const again = await call("remove_secret", { name: "GITHUB_TOKEN" });
    expect(again.result.isError).toBe(true);
    expect(again.json.code).toBe("not_found");
  });

  it("left an audit trail of names only, and never logged a value", () => {
    const audit = readFileSync(join(home, "audit.jsonl"), "utf8");
    for (const v of [VALUE, ROTATED]) {
      expect(audit).not.toContain(v);
      expect(stderr).not.toContain(v);
    }
    const agentEvents = audit
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { action: string; secretName: string | null; actor: string })
      .filter((e) => e.actor === "mcp-agent")
      .map((e) => `${e.action}:${e.secretName}`);
    expect(agentEvents).toEqual(["create:GITHUB_TOKEN", "update:GITHUB_TOKEN", "delete:GITHUB_TOKEN"]);
  });
});
