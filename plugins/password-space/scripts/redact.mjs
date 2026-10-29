#!/usr/bin/env node
/**
 * Cursor hook entry: redact known Password Space secrets from outbound prompts.
 * Defaults to --from-inject --fail-on-leak so chat cannot send known vault values.
 *
 * Stdin → stdout (Cursor hooks). Exit 3 blocks send when a known secret is present.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function dataDir() {
  const raw = process.env.PASSWORD_SPACE_HOME?.trim();
  if (
    !raw ||
    raw === "${PASSWORD_SPACE_HOME}" ||
    /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(raw)
  ) {
    return join(homedir(), ".password-space");
  }
  return raw;
}

function parseArgs(argv) {
  const secrets = [];
  let secretsFile = null;
  let fromInject = true;
  let failOnLeak = true;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--secret") secrets.push(argv[++i]);
    else if (a === "--secrets-file") secretsFile = argv[++i];
    else if (a === "--from-inject") fromInject = true;
    else if (a === "--no-from-inject") fromInject = false;
    else if (a === "--fail-on-leak") failOnLeak = true;
    else if (a === "--no-fail-on-leak") failOnLeak = false;
    else if (a === "--help" || a === "-h") {
      console.error(
        `Usage: redact.mjs [--from-inject|--no-from-inject] [--fail-on-leak|--no-fail-on-leak] [--secrets-file path] [--secret value]
Reads stdin, writes redacted stdout. Hook defaults: --from-inject --fail-on-leak.`,
      );
      process.exit(0);
    }
  }
  return { secrets, secretsFile, fromInject, failOnLeak };
}

function loadSecretsFile(path) {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function loadInjectSecrets(dir) {
  const inject = join(dir, "inject");
  if (!existsSync(inject)) return [];
  const out = [];
  for (const name of readdirSync(inject)) {
    if (!name.endsWith(".env")) continue;
    const body = readFileSync(join(inject, name), "utf8");
    for (const line of body.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      let raw = line.slice(eq + 1).trim();
      if (raw.startsWith("'") && raw.endsWith("'")) {
        raw = raw.slice(1, -1).replace(/'\\''/g, "'");
      }
      if (raw) out.push(raw);
    }
  }
  return out;
}

function redact(text, secrets) {
  const unique = [...new Set(secrets.filter((s) => s && s.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  let out = text;
  for (const s of unique) out = out.split(s).join("[REDACTED]");
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

const args = parseArgs(process.argv);
const known = [
  ...args.secrets,
  ...loadSecretsFile(args.secretsFile),
  ...(args.fromInject ? loadInjectSecrets(dataDir()) : []),
];

const input = await readStdin();
if (args.failOnLeak && known.some((s) => s && input.includes(s))) {
  console.error("password-space redact: blocked — known secret in outbound text");
  process.exit(3);
}

const output = redact(input, known);
if (known.some((s) => s && output.includes(s))) {
  console.error("password-space redact: residual leak after redaction");
  process.exit(2);
}

process.stdout.write(output);
