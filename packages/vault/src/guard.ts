import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { injectDir, secretsStorePath } from "./paths.js";
import { VaultStore } from "./store.js";
import { PromptGuard } from "./guard-core.js";
import type { Keychain } from "./keychain.js";

export * from "./guard-core.js";

/** Values in live inject/*.env files (written by the inject_secret MCP tool). */
export function injectFileValues(dataDir: string): Array<{ name: string; value: string }> {
  const dir = injectDir(dataDir);
  if (!existsSync(dir)) return [];
  const out: Array<{ name: string; value: string }> = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".env")) continue;
    let body: string;
    try {
      body = readFileSync(join(dir, file), "utf8");
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
      if (raw) out.push({ name: line.slice(0, eq).trim(), value: raw });
    }
  }
  return out;
}

/**
 * Build a guard covering every stored secret plus live inject files.
 * Never throws: problems are reported in `guard.warnings`.
 */
export function loadPromptGuard(dataDir: string, opts: { keychain?: Keychain | null } = {}): PromptGuard {
  const warnings: string[] = [];
  const values = injectFileValues(dataDir);
  if (!existsSync(secretsStorePath(dataDir))) return new PromptGuard(values, [], null, warnings);
  try {
    const store = new VaultStore(secretsStorePath(dataDir), opts);
    const m = store.guardMaterial();
    if (m.backend === "file") return new PromptGuard([...values, ...m.values], [], null, warnings);
    if (m.prints.length > 0 && !m.key) {
      warnings.push(
        `cannot check ${m.prints.length} keychain secret(s): ${m.error ?? "guard key missing from keychain (run: password-space set <any secret> to rebuild)"}`,
      );
    }
    return new PromptGuard(values, m.prints, m.key, warnings);
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : String(err));
    return new PromptGuard(values, [], null, warnings);
  }
}
