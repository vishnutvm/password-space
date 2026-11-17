/**
 * Redact known secret values from text. Used by hooks and MCP result wrappers.
 * Longest-first replacement avoids partial overlaps leaving fragments.
 */
export function redactSecrets(text: string, secrets: string[]): string {
  const unique = [...new Set(secrets.filter((s) => s && s.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  let out = text;
  for (const secret of unique) {
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

/** Mask a secret for display: show first/last char only when long enough. */
export function looksLikeSecretLeak(text: string, secrets: string[]): boolean {
  return secrets.some((s) => s.length > 0 && text.includes(s));
}
