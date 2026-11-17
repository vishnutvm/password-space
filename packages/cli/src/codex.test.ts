import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "smol-toml";
import { codexConfigSnippet, inspectCodexConfig, resolvePluginRoot, writeCodexConfig } from "./codex.js";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const pluginRoot = join(repo, "plugins/password-space");
const bundledCli = join(pluginRoot, "dist/cli.js");

type Hook = { matcher?: string; hooks: { type: string; command: string; timeout: number }[] };
type Config = {
  mcp_servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  hooks?: { SessionStart: Hook[]; UserPromptSubmit: Hook[] };
  model?: string;
};

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ps-codex-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("codexConfigSnippet", () => {
  it("is valid TOML that registers the bundled MCP server and both hooks", () => {
    const cfg = parse(codexConfigSnippet({ pluginRoot, hooks: true })) as unknown as Config;
    expect(cfg.mcp_servers["password-space"]).toEqual({
      command: "node",
      args: [join(pluginRoot, "dist/index.js")],
    });
    expect(cfg.hooks!.SessionStart[0]!.matcher).toBe("startup");
    expect(cfg.hooks!.SessionStart[0]!.hooks[0]!.command).toContain("claude-session-hint.mjs\" --host codex");
    expect(cfg.hooks!.UserPromptSubmit[0]!.hooks[0]!.command).toBe(
      `node "${join(pluginRoot, "scripts/prompt-guard.mjs")}" --format codex`,
    );
  });

  it("escapes Windows paths and sets PASSWORD_SPACE_HOME only when given", () => {
    const win = "C:\\Users\\me\\password-space";
    const cfg = parse(codexConfigSnippet({ pluginRoot: win, hooks: false, dataDir: "D:\\vault" })) as unknown as Config;
    expect(cfg.mcp_servers["password-space"]!.args[0]).toBe(join(win, "dist", "index.js"));
    expect(cfg.mcp_servers["password-space"]!.env).toEqual({ PASSWORD_SPACE_HOME: "D:\\vault" });
    expect(cfg.hooks).toBeUndefined();
  });
});

describe("inspectCodexConfig", () => {
  it("finds an existing server, hook, or inline table", () => {
    expect(inspectCodexConfig('[mcp_servers."password-space"]\ncommand="node"')).toMatchObject({ hasServer: true });
    expect(inspectCodexConfig("[mcp_servers.password-space-old]")).toMatchObject({ hasServer: false });
    expect(inspectCodexConfig('command = "node /x/scripts/prompt-guard.mjs"').hasHooks).toBe(true);
    expect(inspectCodexConfig("mcp_servers = { }").inlineConflict).toBe("mcp_servers");
  });
});

describe("resolvePluginRoot", () => {
  it("finds the plugin from its bundled CLI and from the repo CLI build", () => {
    expect(resolvePluginRoot(bundledCli)).toBe(pluginRoot);
    expect(resolvePluginRoot(join(repo, "packages/cli/dist/index.js"))).toBe(pluginRoot);
  });

  it("rejects a folder that is not the plugin", () => {
    expect(() => resolvePluginRoot(join(tmp, "cli.js"))).toThrow(/plugin folder/);
    expect(() => resolvePluginRoot(bundledCli, tmp)).toThrow(/not a Password Space plugin folder/);
  });
});

describe("writeCodexConfig", () => {
  it("appends to an existing config without touching its lines, then is idempotent", () => {
    const codexHome = join(tmp, ".codex");
    mkdirSync(codexHome);
    const before = 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"';
    writeFileSync(join(codexHome, "config.toml"), before);

    const r = writeCodexConfig({ pluginRoot, hooks: true, codexHome, skill: true, home: tmp });
    expect(r.wrote).toBe("all");
    expect(r.skill).toBe("copied");
    const text = readFileSync(r.configPath, "utf8");
    expect(text.startsWith(before)).toBe(true);
    const cfg = parse(text) as unknown as Config;
    expect(cfg.model).toBe("gpt-5");
    expect(Object.keys(cfg.mcp_servers).sort()).toEqual(["other", "password-space"]);
    expect(readFileSync(r.skillPath!, "utf8")).toBe(
      readFileSync(join(pluginRoot, "skills/password-space/SKILL.md"), "utf8"),
    );

    const again = writeCodexConfig({ pluginRoot, hooks: true, codexHome, skill: true, home: tmp });
    expect(again).toMatchObject({ wrote: "nothing", skill: "exists" });
    expect(readFileSync(r.configPath, "utf8")).toBe(text);
  });

  it("adds only the hooks when the server is already registered", () => {
    const codexHome = join(tmp, ".codex");
    mkdirSync(codexHome);
    writeFileSync(join(codexHome, "config.toml"), '[mcp_servers.password-space]\ncommand = "node"\nargs = ["/old"]\n');
    const r = writeCodexConfig({ pluginRoot, hooks: true, codexHome, skill: false });
    expect(r).toMatchObject({ wrote: "hooks", skill: "skipped" });
    const cfg = parse(readFileSync(r.configPath, "utf8")) as unknown as Config;
    expect(cfg.mcp_servers["password-space"]!.args).toEqual(["/old"]);
    expect(cfg.hooks!.UserPromptSubmit).toHaveLength(1);
  });

  it("creates a new private config.toml", () => {
    const codexHome = join(tmp, "fresh");
    const r = writeCodexConfig({ pluginRoot, hooks: false, codexHome, skill: false });
    expect(r.wrote).toBe("all");
    if (process.platform !== "win32") expect(statSync(r.configPath).mode & 0o777).toBe(0o600);
    expect((parse(readFileSync(r.configPath, "utf8")) as unknown as Config).hooks).toBeUndefined();
  });

  it("refuses to append next to an inline mcp_servers table", () => {
    const codexHome = join(tmp, ".codex");
    mkdirSync(codexHome);
    writeFileSync(join(codexHome, "config.toml"), "mcp_servers = {}\n");
    expect(() => writeCodexConfig({ pluginRoot, hooks: true, codexHome, skill: false })).toThrow(/inline/);
    expect(readFileSync(join(codexHome, "config.toml"), "utf8")).toBe("mcp_servers = {}\n");
  });
});

describe.skipIf(!existsSync(bundledCli))("bundled CLI: codex-setup", () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, [bundledCli, "codex-setup", ...args], {
      encoding: "utf8",
      env: { ...process.env, HOME: tmp, USERPROFILE: tmp, CODEX_HOME: join(tmp, ".codex"), PASSWORD_SPACE_HOME: "" },
    });

  it("prints a block without writing anything", () => {
    const r = run([]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("[mcp_servers.password-space]");
    expect(existsSync(join(tmp, ".codex"))).toBe(false);
  });

  it("--write appends to $CODEX_HOME/config.toml and copies the skill", () => {
    const r = run(["--write"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Added: MCP server and hooks/);
    expect(r.stdout).toMatch(/\/hooks/);
    const cfg = parse(readFileSync(join(tmp, ".codex/config.toml"), "utf8")) as unknown as Config;
    expect(cfg.mcp_servers["password-space"]!.args).toEqual([join(pluginRoot, "dist/index.js")]);
    expect(existsSync(join(tmp, ".agents/skills/password-space/SKILL.md"))).toBe(true);
    expect(run(["--write"]).stdout).toMatch(/already configured/);
  });
});
