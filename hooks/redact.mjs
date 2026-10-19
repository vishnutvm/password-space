#!/usr/bin/env node
/**
 * Redact known Password Space secrets from text (stdin → stdout).
 * Portable utility for Cursor hooks or other message filters.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function dataDir() {
  return process.env.PASSWORD_SPACE_HOME || join(homedir(), ".password-space");
}

function parseArgs(argv) {
  const secrets = [];
  let secretsFile = null;
  let fromInject = false;
  let failOnLeak = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--secret") secrets.push(argv[++i]);
    else if (a === "--secrets-file") secretsFile = argv[++i];
    else if (a === "--from-inject") fromInject = true;
    else if (a === "--fail-on-leak") failOnLeak = true;
    else if (a === "--help" || a === "-h") {
      console.error(`Usage: redact.mjs [--from-inject] [--secrets-file path] [--secret value] [--fail-on-leak]
Reads stdin, writes redacted stdout.`);
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
      // Unquote shell single-quoted form produced by inject.ts
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
