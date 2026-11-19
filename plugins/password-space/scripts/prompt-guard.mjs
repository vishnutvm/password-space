#!/usr/bin/env node
/**
 * Prompt hook for Cursor (beforeSubmitPrompt), Claude Code and Codex (UserPromptSubmit):
 * notices when a prompt contains the value of a stored Password Space secret.
 * It never blocks the prompt: the prompt goes through, you see a warning naming
 * the secret, and the agent is told the value is already stored under that name
 * and must not be repeated. Set PASSWORD_SPACE_PROMPT_GUARD=block to block instead.
 *
 * Checks every stored secret, not only recently injected ones:
 *   - keychain store: keyed fingerprints in secrets.json, key read once from the
 *     OS keychain (the hook never reads the secret values themselves)
 *   - file store (no keychain): the values in secrets.json
 *   - live inject/*.env files
 * Values shorter than 6 characters are skipped to avoid false matches.
 *
 * Output by host (auto-detected from hook_event_name, or --format cursor|claude|codex|text):
 *   cursor: stdout {"continue": true, "user_message": ...}, exit 0
 *   claude: stdout {"systemMessage": ..., "hookSpecificOutput": {"additionalContext": ...}}, exit 0
 *   codex:  same as claude
 *   text:   stdin is the raw text; names on stderr, exit 2 (a check, not a prompt)
 * In block mode cursor gets {"continue": false, ...} and claude/codex get the
 * reason on stderr with exit 2.
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
const requested = argFormat();
const format =
  (requested === "codex" ? "claude" : requested) ??
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
const first = hits[0];
const runHint = `password-space run -s ${JSON.stringify(first)} -- <command>`;
const block = (process.env.PASSWORD_SPACE_PROMPT_GUARD ?? "").toLowerCase() === "block";

if (format === "text") {
  console.error(`Contains the value of stored secret ${names}.`);
  process.exit(2);
}

if (block) {
  const message =
    `Password Space blocked this prompt: it contains the value of stored secret ${names}. ` +
    `Refer to secrets by name instead (for example "use ${first}"); the agent can run commands with ${runHint}.`;
  if (format === "cursor") process.stdout.write(JSON.stringify({ continue: false, user_message: message }));
  else console.error(message);
  process.exit(2);
}

const warning =
  `Password Space: this prompt contains the value of stored secret ${names}. ` +
  `It was sent anyway. Next time you can refer to it by name instead of pasting it.`;
const context =
  `Password Space note: the user's prompt contains the value of a secret that is already stored ` +
  `in Password Space as ${names}. Do not repeat, quote, echo or write that value anywhere ` +
  `(replies, files, commands, commit messages). Refer to it by name. To use it in a command, run ` +
  `${runHint}. If the user asked to save or add this value, do what they asked: it is already stored ` +
  `as ${names}, and if they want it under another name, store it under that name with the ` +
  `Password Space store_secret tool; never refuse or stop because of this note.`;

if (format === "cursor") {
  // Cursor's beforeSubmitPrompt cannot add context for the agent; it only shows the user a message.
  process.stdout.write(JSON.stringify({ continue: true, user_message: warning }));
} else {
  process.stdout.write(
    JSON.stringify({
      systemMessage: warning,
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
    }),
  );
}
process.exit(0);
