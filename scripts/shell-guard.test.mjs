/**
 * Tests the plugin's tool hook (plugins/password-space/scripts/shell-guard.mjs):
 * the pure checks, and the hook run the way Claude Code and Cursor run it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkCommand,
  checkHookInput,
  checkReadPath,
  guardDataDir,
} from "../plugins/password-space/scripts/shell-guard.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = join(root, "plugins/password-space/scripts/shell-guard.mjs");
const dataDir = join(homedir(), ".password-space");
const opts = { dataDir };
const INJECT = `${dataDir}/inject/0123456789abcdef0123456789abcdef.env`;

const blocked = [
  'node "/x/plugins/password-space/dist/cli.js" get OPENAI_KEY',
  "password-space get GITHUB_TOKEN | pbcopy",
  "pnpm password-space get X",
  "security find-generic-password -s password-space -a abc:def -w",
  "echo 'find-generic-password -s password-space -w' | security -i",
  "security dump-keychain -d",
  "secret-tool lookup service password-space account abc:def",
  "secret-tool search --all service password-space",
  "powershell -c \"[CredRead]...\"",
  "Get-StoredCredential -Target password-space:abc",
  "cat ~/.password-space/secrets.json",
  "jq . $HOME/.password-space/secrets.json",
  "cd ~/.password-space && cat secrets.json",
  `cat ${INJECT}`,
  `cat ~/.password-space/inject/*.env`,
  `env $(cat ${INJECT}) node app.js`,
  "cd ~/.password-space && cat inject/*.env",
  `grep -r KEY ${dataDir}/inject`,
];

const allowed = [
  'node "/x/dist/cli.js" run -s OPENAI_KEY -- curl https://api.example.com',
  "password-space list",
  "password-space set NEW_KEY",
  "git status",
  "cat package.json",
  "jq . secrets.json", // some other project's file, not the store
  `set -a; . "${INJECT}"; set +a; npm run deploy`,
  `source ${INJECT} && ./deploy.sh`,
  "ls ~/.password-space",
  "tail ~/.password-space/audit.jsonl",
];

for (const cmd of blocked) {
  test(`blocks: ${cmd}`, () => {
    const v = checkCommand(cmd, opts);
    assert.equal(v.blocked, true);
    assert.match(v.reason, /run -s NAME -- <command>/);
  });
}

for (const cmd of allowed) {
  test(`allows: ${cmd}`, () => {
    assert.deepEqual(checkCommand(cmd, opts), { blocked: false });
  });
}

test("custom PASSWORD_SPACE_HOME is honoured", () => {
  const custom = "/srv/vault-home";
  assert.equal(guardDataDir({ PASSWORD_SPACE_HOME: custom }), custom);
  assert.equal(guardDataDir({ PASSWORD_SPACE_HOME: "${PASSWORD_SPACE_HOME}" }), dataDir);
  assert.equal(checkCommand(`cat ${custom}/secrets.json`, { dataDir: custom }).blocked, true);
  assert.equal(checkCommand(`cat ${custom}/inject/a.env`, { dataDir: custom }).blocked, true);
});

test("read tools: inject files and the store are off limits", () => {
  assert.equal(checkReadPath(INJECT, opts).blocked, true);
  assert.equal(checkReadPath("~/.password-space/secrets.json", opts).blocked, true);
  assert.equal(checkReadPath(`${dataDir}/inject`, opts).blocked, true);
  assert.equal(checkReadPath(`${dataDir}/audit.jsonl`, opts).blocked, false);
  assert.equal(checkReadPath("/tmp/secrets.json", opts).blocked, false);
});

test("hook payloads: Claude Bash / Read / Grep and Cursor shell / read", () => {
  assert.equal(checkHookInput({ tool_name: "Bash", tool_input: { command: "password-space get X" } }, opts).blocked, true);
  assert.equal(checkHookInput({ tool_name: "Read", tool_input: { file_path: INJECT } }, opts).blocked, true);
  assert.equal(checkHookInput({ tool_name: "Grep", tool_input: { pattern: "KEY", path: `${dataDir}/inject` } }, opts).blocked, true);
  assert.equal(checkHookInput({ hook_event_name: "beforeShellExecution", command: "secret-tool lookup a b" }, opts).blocked, true);
  assert.equal(checkHookInput({ hook_event_name: "beforeReadFile", file_path: INJECT }, opts).blocked, true);
  assert.equal(checkHookInput({ tool_name: "Read", tool_input: { file_path: "/tmp/x" } }, opts).blocked, false);
  assert.equal(checkHookInput(null, opts).blocked, false);
});

function runHook(payload, format) {
  return spawnSync(process.execPath, [hook, "--format", format], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, PASSWORD_SPACE_HOME: dataDir },
  });
}

test("Claude Code: exit 2 with the reason on stderr", () => {
  const r = runHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "password-space get X" } }, "claude");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Password Space blocked this/);
  const ok = runHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }, "claude");
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, "");
});

test("Cursor: permission deny / allow JSON", () => {
  const r = runHook({ hook_event_name: "beforeShellExecution", command: `cat ${INJECT}` }, "cursor");
  assert.equal(r.status, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.permission, "deny");
  assert.match(out.agent_message, /inject files/);
  const ok = runHook({ hook_event_name: "beforeShellExecution", command: "ls" }, "cursor");
  assert.equal(ok.status, 0);
  assert.deepEqual(JSON.parse(ok.stdout), { permission: "allow" });
});

test("a broken payload is allowed, never crashes the agent", () => {
  const r = spawnSync(process.execPath, [hook, "--format", "claude"], { input: "not json", encoding: "utf8" });
  assert.equal(r.status, 0);
});
