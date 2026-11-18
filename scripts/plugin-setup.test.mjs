/**
 * The plugin's setup path is agent-run: /password-space:setup-password-space calls
 * setup_vault, and only falls back to a Bash command the agent runs itself.
 * These tests keep the command, skill and hints in line with that, and run the
 * Bash fallback exactly as written in the command file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCommand } from "../plugins/password-space/scripts/shell-guard.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "plugins/password-space");
const commandMd = readFileSync(join(plugin, "commands/setup-password-space.md"), "utf8");
const skillMd = readFileSync(join(plugin, "skills/password-space/SKILL.md"), "utf8");

function frontmatterDescription(md) {
  const m = /^---\n[\s\S]*?^description:\s*(.+)$/m.exec(md);
  assert.ok(m, "frontmatter description missing");
  return m[1];
}

function fallbackCommand() {
  const m = /```bash\n([^\n]+)\n\s*```/.exec(commandMd);
  assert.ok(m, "setup command has no bash fallback block");
  return m[1].trim();
}

test("setup command: the agent calls setup_vault, the user pastes nothing", () => {
  assert.match(commandMd, /Call the Password Space MCP tool \*\*`setup_vault`\*\*/);
  assert.match(commandMd, /Do \*\*not\*\* give them a command to paste into Terminal/);
  assert.doesNotMatch(commandMd, /copy_paste_command/);
  assert.doesNotMatch(commandMd, /In Terminal, paste/i);
});

test("setup command: tells the user how to get Node.js 20+ when it is missing", () => {
  assert.match(commandMd, /node -v/);
  assert.match(commandMd, /nodejs\.org/);
  assert.match(commandMd, /brew install node/);
});

test("descriptions trigger on natural phrases", () => {
  const cmd = frontmatterDescription(commandMd);
  assert.match(cmd, /set up password space/i);
  const skill = frontmatterDescription(skillMd);
  for (const phrase of ["set up password space", "save this token", "remove this token", "forget my key"]) {
    assert.ok(skill.toLowerCase().includes(phrase), `skill description lacks "${phrase}"`);
  }
  assert.match(skill, /list_secrets/);
});

test("skill: setup via setup_vault, save via store_secret, remove via remove_secret", () => {
  assert.match(skillMd, /Call \*\*`setup_vault`\*\*/);
  assert.match(skillMd, /`store_secret`/);
  assert.match(skillMd, /`remove_secret`/);
  assert.match(skillMd, /Never\*\* give the user a Terminal command to paste for setup/);
});

test("session hints point the agent at setup_vault, not a Terminal paste", () => {
  for (const f of ["scripts/claude-session-hint.mjs", "scripts/session-vault-hint.mjs"]) {
    const src = readFileSync(join(plugin, f), "utf8");
    assert.match(src, /setup_vault/, f);
    assert.match(src, /Do not ask the user to paste a Terminal command/, f);
  }
});

test("the Bash fallback is not blocked by the plugin's own tool hook", () => {
  assert.deepEqual(checkCommand(fallbackCommand(), { dataDir: join(tmpdir(), "ps-guard") }), { blocked: false });
  assert.deepEqual(checkCommand("node -v", { dataDir: join(tmpdir(), "ps-guard") }), { blocked: false });
});

function runFallback(env) {
  return spawnSync("bash", ["-c", fallbackCommand()], { env, input: "", encoding: "utf8", timeout: 30_000 });
}

function baseEnv(home, dataDir) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("PASSWORD_SPACE_") && k !== "CLAUDE_PLUGIN_ROOT") env[k] = v;
  }
  return { ...env, HOME: home, PASSWORD_SPACE_HOME: dataDir, PASSWORD_SPACE_KEYCHAIN: "none" };
}

const bundled = existsSync(join(plugin, "dist/cli.js"));

test("Bash fallback finds the installed plugin's cli.js and creates the store", { skip: !bundled }, () => {
  const home = mkdtempSync(join(tmpdir(), "ps-home-"));
  try {
    // Same layout as a marketplace install: ~/.claude/plugins/cache/<market>/password-space/<ver>/dist/cli.js
    const installed = join(home, ".claude/plugins/cache/password-space-marketplace/password-space/0.2.0");
    mkdirSync(installed, { recursive: true });
    cpSync(join(plugin, "dist"), join(installed, "dist"), { recursive: true });
    const dataDir = join(home, ".password-space");

    const first = runFallback(baseEnv(home, dataDir));
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Store created/);
    assert.ok(existsSync(join(dataDir, "secrets.json")));

    const again = runFallback(baseEnv(home, dataDir));
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /Store already exists/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Bash fallback uses CLAUDE_PLUGIN_ROOT when it is set", { skip: !bundled }, () => {
  const home = mkdtempSync(join(tmpdir(), "ps-home-"));
  try {
    const dataDir = join(home, "store");
    const r = runFallback({ ...baseEnv(home, dataDir), CLAUDE_PLUGIN_ROOT: plugin });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Store created/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Bash fallback says so when the plugin is not installed", () => {
  const home = mkdtempSync(join(tmpdir(), "ps-home-"));
  try {
    const r = runFallback(baseEnv(home, join(home, "store")));
    assert.match(r.stdout, /cli\.js not found/);
    assert.ok(!existsSync(join(home, "store/secrets.json")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
