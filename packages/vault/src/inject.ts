import {
  chmodSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { injectDir } from "./paths.js";

/**
 * Inject files hold a plaintext value on disk, so they live for one minute by
 * default. The MCP server also deletes each file it wrote when its TTL passes
 * and when the server exits (see scheduleInjectCleanup), not only on the next
 * inject.
 */
export const DEFAULT_INJECT_TTL_MS = 60 * 1000;

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
  clearExpiredInjectFiles(dataDir);
  const dir = ensureInjectDir(dataDir);
  const token = randomBytes(16).toString("hex");
  const envVar = opts.envVar ?? sanitizeEnvName(opts.secretName);
  const envFile = join(dir, `${token}.env`);
  const ttlMs = opts.ttlMs ?? DEFAULT_INJECT_TTL_MS;
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

/** Create the inject dir owner-only (0700), tightening an existing one. */
export function ensureInjectDir(dataDir: string): string {
  const dir = injectDir(dataDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Windows / unusual filesystems: best effort
  }
  return dir;
}

export function clearInjectFile(envFile: string): void {
  try {
    if (existsSync(envFile)) unlinkSync(envFile);
  } catch {
    // already gone or not ours to delete
  }
}

/**
 * Delete `envFile` when it expires, without keeping the process alive.
 * Returns a cancel function. Used by the MCP server after inject_secret.
 */
export function scheduleInjectCleanup(
  envFile: string,
  expiresAt: string,
  now = Date.now(),
  onCleared?: () => void,
): () => void {
  const delay = Math.max(0, Date.parse(expiresAt) - now);
  const timer = setTimeout(() => {
    clearInjectFile(envFile);
    onCleared?.();
  }, delay);
  timer.unref?.();
  return () => clearTimeout(timer);
}

/**
 * Delete inject `*.env` files whose `# password-space inject — expires …` header is past.
 * Also removes files that cannot be parsed and are older than the default TTL by mtime.
 */
export function clearExpiredInjectFiles(dataDir: string, now = Date.now()): number {
  const dir = injectDir(dataDir);
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".env")) continue;
    const full = join(dir, name);
    try {
      const body = readFileSync(full, "utf8");
      const match = /^# password-space inject — expires (.+)$/m.exec(body);
      let expiresMs = match ? Date.parse(match[1]!) : NaN;
      if (!Number.isFinite(expiresMs)) {
        expiresMs = statSync(full).mtimeMs + DEFAULT_INJECT_TTL_MS;
      }
      if (expiresMs <= now) {
        unlinkSync(full);
        removed++;
      }
    } catch {
      // ignore unreadable files
    }
  }
  return removed;
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
