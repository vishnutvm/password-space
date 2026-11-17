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

function runHook(input, args = []) {
  return spawnSync(process.execPath, [hook, ...args], { input, encoding: "utf8", env: env() });
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

test("Cursor: blocks a prompt with a stored value (not only injected ones)", () => {
  const r = runHook(JSON.stringify({ hook_event_name: "beforeSubmitPrompt", prompt: `use ${VALUE} please` }), [
    "--format",
    "cursor",
  ]);
  assert.equal(r.status, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.continue, false);
  assert.match(out.user_message, /OPENAI_KEY/);
  assert.ok(!r.stdout.includes(VALUE) && !r.stderr.includes(VALUE));
});

test("Cursor: allows a clean prompt", () => {
  const r = runHook(JSON.stringify({ hook_event_name: "beforeSubmitPrompt", prompt: "use OPENAI_KEY please" }));
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { continue: true });
});

test("Claude Code: blocks with exit 2 and a reason on stderr", () => {
  const r = runHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: `key=${VALUE}` }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /blocked this prompt.*OPENAI_KEY/);
  assert.equal(r.stdout, "");
  assert.ok(!r.stderr.includes(VALUE));
});

test("Claude Code: allows a clean prompt silently", () => {
  const r = runHook(JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hello" }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
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
