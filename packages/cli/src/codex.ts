import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { VaultError } from "@password-space/vault";

export const CODEX_SETUP_USAGE = `Register Password Space with OpenAI Codex:
  password-space codex-setup              Print the config.toml block (changes nothing)
  password-space codex-setup --write      Append it to ~/.codex/config.toml (never edits existing lines)

  --no-hooks             Leave out the SessionStart hint and the prompt guard hook
  --no-skill             With --write: do not copy the skill to ~/.agents/skills/password-space
  --plugin-root <dir>    Plugin folder that holds dist/index.js (default: next to this CLI)
  --codex-home <dir>     Codex home (default: $CODEX_HOME or ~/.codex)`;

export type CodexSetupOptions = {
  pluginRoot: string;
  hooks: boolean;
  /** Set as PASSWORD_SPACE_HOME for the MCP server when the store is not the default. */
  dataDir?: string;
};

/** Files a plugin folder must have for the Codex config to work. */
const REQUIRED = ["dist/index.js", "dist/cli.js", "scripts/prompt-guard.mjs"] as const;

export function isPluginRoot(dir: string): boolean {
  return REQUIRED.every((f) => existsSync(join(dir, f)));
}

/**
 * Find the plugin folder from the running CLI file: `<root>/dist/cli.js` when bundled,
 * or the repo's `plugins/password-space` when run from `packages/cli/dist/index.js`.
 */
export function resolvePluginRoot(cliFile: string, override?: string): string {
  if (override) {
    const dir = resolve(override);
    if (!isPluginRoot(dir)) {
      throw new VaultError(`${dir} is not a Password Space plugin folder (needs ${REQUIRED.join(", ")})`, "INVALID");
    }
    return dir;
  }
  const here = dirname(resolve(cliFile));
  const candidates = [dirname(here), resolve(here, "../../../plugins/password-space")];
  const found = candidates.find(isPluginRoot);
  if (!found) {
    throw new VaultError(
      `Could not find the plugin folder next to ${cliFile}. Run the bundled CLI (plugins/password-space/dist/cli.js) or pass --plugin-root.`,
      "INVALID",
    );
  }
  return found;
}

export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.CODEX_HOME?.trim();
  return raw ? resolve(raw) : join(homedir(), ".codex");
}

/** TOML basic string. JSON escapes (\\ \" \n \uXXXX) are valid TOML escapes. */
function tomlString(s: string): string {
  return JSON.stringify(s);
}

/** Double-quote a path for the hook's shell command (sh and cmd both accept "…"). */
function shellPath(p: string): string {
  if (p.includes('"')) throw new VaultError(`Path contains a double quote: ${p}`, "INVALID");
  return `"${p}"`;
}

export function codexConfigSnippet(opts: CodexSetupOptions): string {
  const root = opts.pluginRoot;
  const lines = [
    "# Password Space: MCP server (tools: vault_status, list_secrets, inject_secret, …)",
    "[mcp_servers.password-space]",
    `command = "node"`,
    `args = [${tomlString(join(root, "dist", "index.js"))}]`,
  ];
  if (opts.dataDir) {
    lines.push("", "[mcp_servers.password-space.env]", `PASSWORD_SPACE_HOME = ${tomlString(opts.dataDir)}`);
  }
  if (opts.hooks) {
    const hint = `node ${shellPath(join(root, "scripts", "claude-session-hint.mjs"))} --host codex`;
    const guard = `node ${shellPath(join(root, "scripts", "prompt-guard.mjs"))} --format codex`;
    lines.push(
      "",
      "# Password Space: setup hint at session start, and block prompts that contain a stored value.",
      "# Codex runs new hooks only after you trust them with /hooks.",
      "[[hooks.SessionStart]]",
      `matcher = "startup"`,
      "",
      "[[hooks.SessionStart.hooks]]",
      `type = "command"`,
      `command = ${tomlString(hint)}`,
      "timeout = 10",
      "",
      "[[hooks.UserPromptSubmit]]",
      "",
      "[[hooks.UserPromptSubmit.hooks]]",
      `type = "command"`,
      `command = ${tomlString(guard)}`,
      "timeout = 10",
    );
  }
  return `${lines.join("\n")}\n`;
}

export type ExistingConfig = {
  /** A `[mcp_servers.password-space]` table is already there. */
  hasServer: boolean;
  /** A Password Space prompt guard hook is already there. */
  hasHooks: boolean;
  /** Inline `mcp_servers = {…}` or `hooks = {…}`: appending tables would redefine the key. */
  inlineConflict?: "mcp_servers" | "hooks";
};

export function inspectCodexConfig(text: string): ExistingConfig {
  const hasServer = /^\s*\[\s*mcp_servers\s*\.\s*(?:password-space|"password-space"|'password-space')\s*\]/m.test(text);
  const hasHooks = /prompt-guard\.mjs/.test(text);
  const inline = /^\s*(mcp_servers|hooks)\s*=/m.exec(text);
  return { hasServer, hasHooks, ...(inline ? { inlineConflict: inline[1] as "mcp_servers" | "hooks" } : {}) };
}

export type WriteResult = {
  configPath: string;
  wrote: "all" | "server" | "hooks" | "nothing";
  skill: "copied" | "exists" | "skipped";
  skillPath?: string;
};

/**
 * Append the Password Space block to Codex's config.toml. Never rewrites existing
 * lines: if the server or hook is already present, that part is skipped.
 */
export function writeCodexConfig(
  opts: CodexSetupOptions & { codexHome: string; skill: boolean; home?: string },
): WriteResult {
  const configPath = join(opts.codexHome, "config.toml");
  const current = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const found = inspectCodexConfig(current);
  if (found.inlineConflict) {
    throw new VaultError(
      `${configPath} sets \`${found.inlineConflict} = …\` inline, so tables cannot be appended safely. ` +
        `Add the block from \`password-space codex-setup\` by hand.`,
      "INVALID",
    );
  }

  const addServer = !found.hasServer;
  const addHooks = opts.hooks && !found.hasHooks;
  let wrote: WriteResult["wrote"] = "nothing";
  if (addServer || addHooks) {
    let block = codexConfigSnippet({ ...opts, hooks: addHooks });
    if (!addServer) block = block.slice(block.indexOf("\n# Password Space: setup hint") + 1);
    mkdirSync(opts.codexHome, { recursive: true });
    const sep = current === "" ? "" : current.endsWith("\n") ? "\n" : "\n\n";
    appendFileSync(configPath, sep + block, { mode: 0o600 });
    // "all" = everything that was asked for (the server, plus hooks unless --no-hooks).
    wrote = addServer && (addHooks || !opts.hooks) ? "all" : addServer ? "server" : "hooks";
  }

  let skill: WriteResult["skill"] = "skipped";
  let skillPath: string | undefined;
  if (opts.skill) {
    const src = join(opts.pluginRoot, "skills", "password-space", "SKILL.md");
    skillPath = join(opts.home ?? homedir(), ".agents", "skills", "password-space", "SKILL.md");
    if (existsSync(skillPath)) {
      skill = "exists";
    } else if (existsSync(src)) {
      mkdirSync(dirname(skillPath), { recursive: true });
      copyFileSync(src, skillPath);
      skill = "copied";
    }
  }
  return { configPath, wrote, skill, ...(skillPath ? { skillPath } : {}) };
}
