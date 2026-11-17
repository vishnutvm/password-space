#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook: block a prompt that contains a known
 * Password Space secret value.
 *
 * Claude Code hooks cannot rewrite the prompt (unlike Cursor's redaction
 * transform), so this blocks instead: exit 2 erases the prompt and shows the
 * stderr message to the user. The secret value is never printed.
 *
 * Known values: secrets.json (the plain-text store) and inject/*.env files.
 * Values shorter than MIN_LEN are skipped to avoid false positives.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const MIN_LEN = 6;

function dataDir() {
  const raw = process.env.PASSWORD_SPACE_HOME?.trim();
  if (!raw || /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(raw)) {
    return join(homedir(), ".password-space");
  }
  return raw;
}

function storeSecrets(dir) {
  const path = join(dir, "secrets.json");
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed?.secrets)) return [];
    return parsed.secrets.map((s) => ({ name: String(s?.name ?? ""), value: String(s?.value ?? "") }));
  } catch {
    return [];
  }
}

function injectSecrets(dir) {
  const inject = join(dir, "inject");
  if (!existsSync(inject)) return [];
  const out = [];
  for (const file of readdirSync(inject)) {
    if (!file.endsWith(".env")) continue;
    let body;
    try {
      body = readFileSync(join(inject, file), "utf8");
    } catch {
      continue;
    }
    for (const line of body.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      let raw = line.slice(eq + 1).trim();
      if (raw.startsWith("'") && raw.endsWith("'")) {
        raw = raw.slice(1, -1).replace(/'\\''/g, "'");
      }
      out.push({ name: line.slice(0, eq).trim(), value: raw });
    }
  }
  return out;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

let prompt = "";
try {
  const input = JSON.parse(await readStdin());
  prompt = typeof input?.prompt === "string" ? input.prompt : "";
} catch {
  process.exit(0); // Not our input shape — never block on a parse error.
}
if (!prompt) process.exit(0);

const dir = dataDir();
const known = [...storeSecrets(dir), ...injectSecrets(dir)].filter(
  (s) => s.value.length >= MIN_LEN,
);
const hits = [...new Set(known.filter((s) => prompt.includes(s.value)).map((s) => s.name || "unnamed"))];

if (hits.length > 0) {
  console.error(
    `Password Space blocked this prompt: it contains the value of stored secret ${hits
      .map((n) => `"${n}"`)
      .join(", ")}. Refer to secrets by name (for example "use ${hits[0]}") and let the agent call inject_secret.`,
  );
  process.exit(2);
}
process.exit(0);
