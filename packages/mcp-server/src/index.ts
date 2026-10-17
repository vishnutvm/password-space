#!/usr/bin/env node
/**
 * Password Space MCP server (stdio).
 *
 * Humans unlock via CLI; this process reads the unlock session and exposes
 * metadata + inject tools. Prefer inject_secret over resolve_secret.
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
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
