/**
 * Runs the plugin's prompt hook (plugins/password-space/scripts/prompt-guard.mjs)
 * the way Cursor and Claude Code do, against a temporary store.
 * Uses the committed bundles in plugins/password-space/dist.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = join(root, "plugins/password-space/scripts/prompt-guard.mjs");
const cli = join(root, "plugins/password-space/dist/cli.js");
const VALUE = "sk-guard-test-0123456789abcdef";
let home;

function env() {
  // File backend keeps this test independent of the machine's keychain.
  return { ...process.env, PASSWORD_SPACE_HOME: home, PASSWORD_SPACE_KEYCHAIN: "none" };
}

function runHook(input, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [hook, ...args], { input, encoding: "utf8", env: { ...env(), ...extraEnv } });
}

function noValue(r) {
  assert.ok(!r.stdout.includes(VALUE) && !r.stderr.includes(VALUE), "hook output must never contain the value");
}

before(() => {
  home = mkdtempSync(join(tmpdir(), "ps-hook-"));
  const r = spawnSync(process.execPath, [cli, "set", "OPENAI_KEY", "--value", VALUE], {
    encoding: "utf8",
    env: env(),
  });
  assert.equal(r.status, 0, r.stderr);
});
after(() => rmSync(home, { recursive: true, force: true }));

test("Cursor: lets a prompt with a stored value through with a warning", () => {
  const r = runHook(JSON.stringify({ hook_event_name: "beforeSubmitPrompt", prompt: `use ${VALUE} please` }), [
    "--format",
    "cursor",
  ]);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.continue, true);
  assert.match(out.user_message, /OPENAI_KEY.*sent anyway/);
  noValue(r);
});

test("Cursor: allows a clean prompt", () => {
  const r = runHook(JSON.stringify({ hook_event_name: "beforeSubmitPrompt", prompt: "use OPENAI_KEY please" }));
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { continue: true });
});

test("Claude Code: never blocks; warns the user and tells the agent the stored name", () => {
  const r = runHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: `key=${VALUE}` }));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.match(out.systemMessage, /OPENAI_KEY/);
  assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(out.hookSpecificOutput.additionalContext, /already stored.*OPENAI_KEY/);
  assert.match(out.hookSpecificOutput.additionalContext, /Do not repeat/);
  noValue(r);
});

test("Claude Code: an explicit save request goes through", () => {
  const r = runHook(
    JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: `add ADMIN_API_KEY: "${VALUE}" to password space` }),
    ["--format", "claude"],
  );
  assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /never refuse or stop/);
  noValue(r);
});

test("Claude Code: allows a clean prompt silently", () => {
  const r = runHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hello" }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("Codex: --format codex warns and adds context, never blocks", () => {
  const input = { session_id: "s", turn_id: "t", hook_event_name: "UserPromptSubmit", model: "m", prompt: `token ${VALUE}` };
  const r = runHook(JSON.stringify(input), ["--format", "codex"]);
  assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /OPENAI_KEY/);
  noValue(r);
  const clean = runHook(JSON.stringify({ ...input, prompt: "use OPENAI_KEY" }), ["--format", "codex"]);
  assert.equal(clean.status, 0);
  assert.equal(clean.stdout, "");
});

test("PASSWORD_SPACE_PROMPT_GUARD=block restores blocking", () => {
  const block = { PASSWORD_SPACE_PROMPT_GUARD: "block" };
  const claude = runHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: `key=${VALUE}` }), [], block);
  assert.equal(claude.status, 2);
  assert.match(claude.stderr, /blocked this prompt.*OPENAI_KEY/);
  assert.equal(claude.stdout, "");
  noValue(claude);
  const cursor = runHook(JSON.stringify({ hook_event_name: "beforeSubmitPrompt", prompt: VALUE }), ["--format", "cursor"], block);
  assert.equal(cursor.status, 2);
  assert.equal(JSON.parse(cursor.stdout).continue, false);
  noValue(cursor);
});

test("SessionStart hint: silent with a store, Codex wording without one", () => {
  const hint = join(root, "plugins/password-space/scripts/claude-session-hint.mjs");
  const withStore = spawnSync(process.execPath, [hint, "--host", "codex"], { encoding: "utf8", env: env() });
  assert.equal(withStore.status, 0);
  assert.equal(withStore.stdout, "");

  const empty = mkdtempSync(join(tmpdir(), "ps-hint-empty-"));
  try {
    const { CLAUDE_PLUGIN_ROOT: _drop, ...rest } = env();
    const r = spawnSync(process.execPath, [hint, "--host", "codex"], {
      encoding: "utf8",
      env: { ...rest, PASSWORD_SPACE_HOME: empty },
    });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    assert.equal(out.hookEventName, "SessionStart");
    assert.match(out.additionalContext, /vault_onboard/);
    assert.doesNotMatch(out.additionalContext, /\/password-space:setup/);
    assert.ok(out.additionalContext.includes(join(root, "plugins/password-space/dist/cli.js")));
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("text mode for manual checks", () => {
  assert.equal(runHook(`log line ${VALUE}`).status, 2);
  assert.equal(runHook("nothing here").status, 0);
});

test("no store: allows everything", () => {
  const empty = mkdtempSync(join(tmpdir(), "ps-hook-empty-"));
  try {
    const r = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: VALUE }),
      encoding: "utf8",
      env: { ...env(), PASSWORD_SPACE_HOME: empty },
    });
    assert.equal(r.status, 0);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
