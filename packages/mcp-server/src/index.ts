#!/usr/bin/env node
/**
 * Password Space MCP server (stdio).
 *
 * Bundled for marketplace installs (`plugins/password-space/dist/index.js`).
 * End users can init / unlock / store secrets via these tools — no separate
 * monorepo clone required for day-1 setup. Prefer inject_secret over resolve_secret.
 *
 * Never log passphrases or secret values.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { defaultDataDir, openVault } from "@password-space/vault";
import {
  getSecretMetadataTool,
  injectSecretTool,
  listSecretsTool,
  resolveSecretTool,
  vaultInitTool,
  vaultLockTool,
  vaultSetSecretTool,
  vaultStatusTool,
  vaultUnlockTool,
} from "./tools.js";

const dataDir =
  process.env.PASSWORD_SPACE_HOME?.trim() || defaultDataDir();

function withStore<T>(fn: (store: ReturnType<typeof openVault>) => T): T {
  const store = openVault({ dataDir, useSession: true });
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

const server = new McpServer({
  name: "password-space",
  version: "0.1.0",
});

server.tool(
  "vault_status",
  "Show whether the local vault is initialized and unlocked. Safe to call anytime; never returns secret values or the passphrase.",
  {},
  async () => {
    try {
      return withStore((store) => vaultStatusTool(store, dataDir));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "vault_init",
  "Create a new encrypted vault. Pass passphrase as a tool argument (preferred: UI/agent secret prompt) or set PASSWORD_SPACE_PASSPHRASE. Never paste the passphrase into chat. Does not unlock — call vault_unlock next.",
  {
    passphrase: z
      .string()
      .optional()
      .describe(
        "Vault passphrase (min 8 chars). Prefer a secret prompt / tool arg — do not echo in chat. Falls back to PASSWORD_SPACE_PASSPHRASE.",
      ),
  },
  async ({ passphrase }) => {
    try {
      return await withStore((store) => vaultInitTool(store, dataDir, { passphrase }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "vault_unlock",
  "Unlock the vault for this machine session (writes a short-lived session file). Pass passphrase via tool arg or PASSWORD_SPACE_PASSPHRASE. Never paste the passphrase into chat.",
  {
    passphrase: z
      .string()
      .optional()
      .describe(
        "Unlock passphrase. Prefer a secret prompt / tool arg — do not echo in chat. Falls back to PASSWORD_SPACE_PASSPHRASE.",
      ),
    ttl_hours: z
      .number()
      .optional()
      .describe("Session TTL in hours (default: 8)"),
  },
  async ({ passphrase, ttl_hours }) => {
    try {
      return await vaultUnlockTool(dataDir, { passphrase, ttl_hours });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "vault_lock",
  "Clear the unlock session so the vault is locked again.",
  {},
  async () => {
    try {
      return vaultLockTool(dataDir);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "vault_set_secret",
  "Store or update a secret (name + value + optional tags). Pass the value as a tool argument — do NOT repeat the value in chat. Returns metadata only.",
  {
    name: z.string().describe("Secret name (e.g. GITHUB_TOKEN)"),
    value: z
      .string()
      .describe(
        "Secret value. Pass via tool arg / secret prompt only — never paste into chat or commit logs.",
      ),
    tags: z
      .array(z.string())
      .optional()
      .describe("Optional tags for filtering (e.g. [\"api\", \"github\"])"),
    notes: z.string().optional().describe("Optional non-secret notes"),
  },
  async ({ name, value, tags, notes }) => {
    try {
      return withStore((store) =>
        vaultSetSecretTool(store, { name, value, tags, notes }),
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "list_secrets",
  "List secret names, ids, and tags. Never returns secret values. Use before inject_secret.",
  {
    tag: z.string().optional().describe("Optional tag filter"),
  },
  async ({ tag }) => {
    try {
      return withStore((store) => listSecretsTool(store, tag));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "get_secret_metadata",
  "Get metadata for one secret by name or id. Never returns the secret value.",
  {
    name: z.string().describe("Secret name or id"),
  },
  async ({ name }) => {
    try {
      return withStore((store) => getSecretMetadataTool(store, name));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "inject_secret",
  "PREFERRED agent access: write secret to a short-lived local env file and return a handle + path. Do NOT read the file into chat. Set redact_in_transcript on any display.",
  {
    name: z.string().describe("Secret name or id"),
    env_var: z
      .string()
      .optional()
      .describe("Environment variable name to write (default: derived from secret name)"),
  },
  async ({ name, env_var }) => {
    try {
      return withStore((store) => injectSecretTool(store, dataDir, { name, env_var }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "resolve_secret",
  "LAST RESORT: return plaintext in the tool result with redact_in_transcript=true. Prefer inject_secret. Requires confirm_redaction=true.",
  {
    name: z.string().describe("Secret name or id"),
    confirm_redaction: z
      .boolean()
      .optional()
      .describe("Must be true to acknowledge client will redact transcripts"),
  },
  async ({ name, confirm_redaction }) => {
    try {
      return withStore((store) =>
        resolveSecretTool(store, { name, confirm_redaction: confirm_redaction === true }),
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: message }, null, 2) }],
    isError: true,
  };
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // Never dump full error objects that might carry tool args.
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
