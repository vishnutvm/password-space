import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";

const FILE_NAME = "unlock-attempts.json";
const MAX_DELAY_MS = 30_000;
const BASE_DELAY_MS = 250;

type AttemptState = {
  failures: number;
  lastFailureAt: string | null;
  lockedUntil: string | null;
};

function pathFor(dataDir: string): string {
  return join(dataDir, FILE_NAME);
}

function readState(dataDir: string): AttemptState {
  const p = pathFor(dataDir);
  if (!existsSync(p)) {
    return { failures: 0, lastFailureAt: null, lockedUntil: null };
  }
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as AttemptState;
    return {
      failures: Number(raw.failures) || 0,
      lastFailureAt: raw.lastFailureAt ?? null,
      lockedUntil: raw.lockedUntil ?? null,
    };
  } catch {
    return { failures: 0, lastFailureAt: null, lockedUntil: null };
  }
}

function writeState(dataDir: string, state: AttemptState): void {
  mkdirSync(dirname(pathFor(dataDir)), { recursive: true });
  const p = pathFor(dataDir);
  writeFileSync(p, JSON.stringify(state), { mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    // best-effort
  }
}

function delayForFailures(failures: number): number {
  if (failures <= 0) return 0;
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(failures - 1, 8));
  return exp;
}

/**
 * Block / delay unlock attempts after repeated wrong passphrases.
 * Local-only throttle — not a substitute for OS auth.
 */
export async function beforeUnlockAttempt(dataDir: string): Promise<void> {
  const state = readState(dataDir);
  const now = Date.now();
  if (state.lockedUntil) {
    const until = Date.parse(state.lockedUntil);
    if (Number.isFinite(until) && until > now) {
      const waitMs = until - now;
      await sleep(waitMs);
    }
  }
  const delay = delayForFailures(state.failures);
  if (delay > 0) await sleep(delay);
}

export function recordUnlockFailure(dataDir: string): void {
  const state = readState(dataDir);
  const failures = state.failures + 1;
  const delay = delayForFailures(failures);
  const lockedUntil =
    failures >= 5 ? new Date(Date.now() + Math.min(MAX_DELAY_MS * 2, delay * 2)).toISOString() : null;
  writeState(dataDir, {
    failures,
    lastFailureAt: new Date().toISOString(),
    lockedUntil,
  });
}

export function recordUnlockSuccess(dataDir: string): void {
  const p = pathFor(dataDir);
  if (existsSync(p)) unlinkSync(p);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
