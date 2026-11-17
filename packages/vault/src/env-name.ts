/**
 * Shell-safe environment variable name for a secret name, as used by
 * `password-space run -s NAME` (e.g. "github token" → GITHUB_TOKEN).
 */
export function envNameFor(secretName: string): string {
  const cleaned = secretName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) return "SECRET";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}
