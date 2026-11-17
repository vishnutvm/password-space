#!/usr/bin/env node
/**
 * Prompt hook for Cursor (beforeSubmitPrompt) and Claude Code (UserPromptSubmit):
 * blocks a prompt that contains the value of any stored Password Space secret.
 *
 * Checks every stored secret, not only recently injected ones:
 *   - keychain store: keyed fingerprints in secrets.json, key read once from the
 *     OS keychain (the hook never reads the secret values themselves)
 *   - file store (no keychain): the values in secrets.json
 *   - live inject/*.env files
 * Values shorter than 6 characters are skipped to avoid false blocks.
 *
 * Output by host (auto-detected from hook_event_name, or --format cursor|claude|text):
 *   cursor: stdout {"continue": false, "user_message": ...}, exit 2
 *   claude: reason on stderr, exit 2 (Claude Code erases the prompt and shows it)
 *   text:   stdin is the raw text; names on stderr, exit 2
 * Never prints a secret value. If the guard itself fails, the prompt is allowed
 * and a warning goes to stderr, so a broken keychain never locks you out of chat.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function argFormat() {
  const i = process.argv.indexOf("--format");
  return i > 0 ? process.argv[i + 1] : undefined;
}

const raw = await readStdin();
let input = null;
try {
  input = JSON.parse(raw);
} catch {
  // not JSON: plain text mode
}

const event = typeof input?.hook_event_name === "string" ? input.hook_event_name : "";
const format =
  argFormat() ??
  (input === null || typeof input !== "object"
    ? "text"
    : event === "UserPromptSubmit"
      ? "claude"
      : "cursor");
const prompt = format === "text" ? raw : typeof input?.prompt === "string" ? input.prompt : "";

function allow() {
  if (format === "cursor") process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

if (!prompt) allow();

let hits = [];
try {
  const here = dirname(fileURLToPath(import.meta.url));
  const { loadPromptGuard, defaultDataDir } = await import(join(here, "..", "dist", "guard.js"));
  const guard = loadPromptGuard(defaultDataDir());
  for (const w of guard.warnings) console.error(`password-space prompt guard: ${w}`);
  hits = guard.check(prompt);
} catch (err) {
  console.error(`password-space prompt guard: check skipped (${err instanceof Error ? err.message : err})`);
  allow();
}

if (hits.length === 0) allow();

const names = hits.map((n) => `"${n}"`).join(", ");
const message =
  `Password Space blocked this prompt: it contains the value of stored secret ${names}. ` +
  `Refer to secrets by name instead (for example "use ${hits[0]}"); the agent can run commands with ` +
  `password-space run -s ${JSON.stringify(hits[0])} -- <command>.`;

if (format === "cursor") {
  process.stdout.write(JSON.stringify({ continue: false, user_message: message }));
} else {
  console.error(message);
}
process.exit(2);
