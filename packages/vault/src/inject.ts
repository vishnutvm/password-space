import { chmodSync, mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { injectDir } from "./paths.js";

export type InjectHandle = {
  /** Opaque handle agents may reference in chat */
  handle: string;
  /** Absolute path to env-style file (KEY=value) — consume then delete */
  envFile: string;
  /** Environment variable name written */
  envVar: string;
  secretId: string;
  secretName: string;
  /** ISO expiry for the inject file */
  expiresAt: string;
  /** Instruct clients to redact tool results in transcripts */
  redact_in_transcript: true;
};

/**
 * Write secret to a short-lived env file under the data dir.
 * Agents / tooling should source or read this file, then delete it.
 * Chat should only ever see the handle, never the value.
 */
export function writeInjectFile(
  dataDir: string,
  opts: {
    secretId: string;
    secretName: string;
    value: string;
    envVar?: string;
    ttlMs?: number;
  },
): InjectHandle {
  const dir = injectDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const token = randomBytes(16).toString("hex");
  const envVar = opts.envVar ?? sanitizeEnvName(opts.secretName);
  const envFile = join(dir, `${token}.env`);
  const ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  const content = [
    `# password-space inject — expires ${expiresAt}`,
    `# secret: ${opts.secretName} (${opts.secretId})`,
    `# delete after use`,
    `${envVar}=${shellEscape(opts.value)}`,
    "",
  ].join("\n");

  writeFileSync(envFile, content, { mode: 0o600 });
  try {
    chmodSync(envFile, 0o600);
  } catch {
    // ignore
  }

  return {
    handle: `ps://${opts.secretName}`,
    envFile,
    envVar,
    secretId: opts.secretId,
    secretName: opts.secretName,
    expiresAt,
    redact_in_transcript: true,
  };
}

export function clearInjectFile(envFile: string): void {
  if (existsSync(envFile)) unlinkSync(envFile);
}

function sanitizeEnvName(name: string): string {
  const cleaned = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "SECRET";
}

function shellEscape(value: string): string {
  // Store as single-quoted shell string with embedded quotes escaped
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
