import { createHmac } from "node:crypto";

/** Values shorter than this are not guarded: too many false positives on everyday text. */
export const GUARD_MIN_LENGTH = 6;

/** Keyed fingerprint of a secret value: its length and a truncated HMAC-SHA256. */
export type GuardPrint = { len: number; mac: string };

function mac(key: Buffer, text: string): string {
  return createHmac("sha256", key).update(text, "utf8").digest("hex").slice(0, 32);
}

export function guardPrint(key: Buffer, value: string): GuardPrint | undefined {
  if (value.length < GUARD_MIN_LENGTH) return undefined;
  return { len: value.length, mac: mac(key, value) };
}

/** Above this many HMACs per check, only word-boundary windows are hashed. */
export const FULL_SCAN_BUDGET = 250_000;

const WORD = /[A-Za-z0-9]/;
function isBoundary(text: string, i: number): boolean {
  return i === 0 || !WORD.test(text[i - 1]!) || !WORD.test(text[i]!);
}

export type GuardHit = { name: string; start: number; end: number };

/**
 * Finds stored secret values inside outbound text.
 *
 * Plain values (file backend, inject files) are matched directly. Keychain
 * values are matched by fingerprint: every substring whose length equals a
 * stored value's length is HMAC'd with the store's key and compared, so the
 * hook never needs to read the values themselves.
 */
export class PromptGuard {
  private readonly values: Array<{ name: string; value: string }>;
  private readonly byLen = new Map<number, Map<string, string>>();

  constructor(
    values: Array<{ name: string; value: string }>,
    prints: Array<{ name: string } & GuardPrint>,
    private readonly key: Buffer | null,
    /** Problems loading guard material (e.g. keychain unreachable). */
    readonly warnings: string[] = [],
  ) {
    this.values = values.filter((v) => v.value.length >= GUARD_MIN_LENGTH);
    if (key) {
      for (const p of prints) {
        if (p.len < GUARD_MIN_LENGTH) continue;
        let m = this.byLen.get(p.len);
        if (!m) this.byLen.set(p.len, (m = new Map()));
        m.set(p.mac, p.name);
      }
    }
  }

  /** Number of secrets this guard can detect. */
  get size(): number {
    let n = this.values.length;
    for (const m of this.byLen.values()) n += m.size;
    return n;
  }

  findHits(text: string): GuardHit[] {
    const hits: GuardHit[] = [];
    for (const { name, value } of this.values) {
      let i = text.indexOf(value);
      while (i !== -1) {
        hits.push({ name, start: i, end: i + value.length });
        i = text.indexOf(value, i + 1);
      }
    }
    if (this.key && this.byLen.size > 0) {
      // Hash every window when that is cheap (~2µs per HMAC). For long text,
      // only hash windows that start where a word starts or ends: pasted
      // secrets almost always follow a space, quote, "=", ":" and the like.
      const full = text.length * this.byLen.size <= FULL_SCAN_BUDGET;
      for (const [len, macs] of this.byLen) {
        for (let i = 0; i + len <= text.length; i++) {
          if (!full && !isBoundary(text, i)) continue;
          const name = macs.get(mac(this.key, text.slice(i, i + len)));
          if (name !== undefined) hits.push({ name, start: i, end: i + len });
        }
      }
    }
    return hits.sort((a, b) => a.start - b.start || b.end - a.end);
  }

  /** Distinct names of secrets found in the text. */
  check(text: string): string[] {
    return [...new Set(this.findHits(text).map((h) => h.name))];
  }

  redact(text: string, marker = "[REDACTED]"): string {
    const hits = this.findHits(text);
    if (hits.length === 0) return text;
    let out = "";
    let pos = 0;
    for (const h of hits) {
      if (h.end <= pos) continue;
      if (h.start > pos) out += text.slice(pos, h.start);
      if (h.start >= pos) out += marker;
      pos = h.end;
    }
    return out + text.slice(pos);
  }
}
