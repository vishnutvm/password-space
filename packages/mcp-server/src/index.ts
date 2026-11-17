#!/usr/bin/env node
/**
 * Password Space MCP server (stdio).
 *
 * Bundled for marketplace installs (`plugins/password-space/dist/index.js`).
 * End users name secrets via Terminal CLI bundled at `dist/cli.js`
 * (sibling of this file) — no monorepo clone required.
 * Prefer inject_secret over resolve_secret.
 *
 * Never log secret values.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { defaultDataDir } from "@password-space/vault";
import {
  CLI_SETUP_COMMANDS,
  bundledCliCommand,
  NodeVersionError,
  getSecretMetadataTool,
  injectSecretTool,
  listSecretsTool,
  removeSecretTool,
  resolveSecretTool,
  scrubValue,
  storeSecretTool,
  vaultManagerTool,
  vaultOnboardTool,
  vaultStatusTool,
} from "./tools.js";
import { withVaultStore } from "./with-store.js";

const VAULT_MANAGER_UI = "ui://password-space/vault-manager.html";
const FALLBACK_VAULT_MANAGER_HTML =
  `<!DOCTYPE html><html><body><p>Password Space Vault Manager UI is not bundled. Use vault_status / list_secrets / CLI — do not paste App source into chat.</p></body></html>`;

function isBundledVaultManagerHtml(html: string): boolean {
  if (!html.trimStart().startsWith("<!DOCTYPE html>")) return false;
  const opens = html.match(/<script\b/gi) ?? [];
  const closes = html.match(/<\/script>/gi) ?? [];
  // Reject unbundled template (external src) and $&-corrupted multi-script dumps.
  if (opens.length !== 1 || closes.length !== 1) return false;
  if (html.includes('src="./vault-manager-ui.js"')) return false;
  return true;
}

function loadVaultManagerHtml(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Prefer the plugin dist single-file App next to the bundled server.
  const candidates = [
    join(here, "vault-manager.html"),
    join(here, "../../plugins/password-space/dist/vault-manager.html"),
    join(here, "../app/vault-manager.html"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const html = readFileSync(path, "utf8");
    if (isBundledVaultManagerHtml(html)) return html;
  }
  return FALLBACK_VAULT_MANAGER_HTML;
}

// defaultDataDir ignores empty / unresolved `${PASSWORD_SPACE_HOME}` placeholders
const dataDir = defaultDataDir();

const server = new McpServer({
  name: "password-space",
  version: "0.1.0",
});

server.registerTool(
  "vault_onboard",
  {
    title: "Get started with Password Space",
    description:
      "Guided setup — named secrets with values in the OS keychain, nothing sensitive in the response. Best first call after install.",
  },
  async () => {
    try {
      return await withVaultStore(dataDir, (store) => vaultOnboardTool(store, dataDir));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "vault_status",
  {
    title: "Password Space status",
    description:
      "Quick health check: local store ready and your next step. Never returns secret values. Lock/unlock not required.",
  },
  async () => {
    try {
      return await withVaultStore(dataDir, (store) => vaultStatusTool(store, dataDir));
    } catch (err) {
      return errorResult(err);
    }
  },
);

registerAppTool(
  server,
  "vault_manager",
  {
    title: "Vault status (optional)",
    description:
      "Status-only. Do NOT use for add/remove — human UX is the plugin Terminal CLI (`node \"${CURSOR_PLUGIN_ROOT}/dist/cli.js\"` menu|setup|set|remove). Prefer vault_status / list_secrets / inject_secret. Lock/unlock not needed.",
    inputSchema: {},
    _meta: {
      ui: { resourceUri: VAULT_MANAGER_UI },
      "mcp/app": { resourceUri: VAULT_MANAGER_UI },
    },
  },
  async () => {
    try {
      const result = await withVaultStore(dataDir, (store) => vaultManagerTool(store, dataDir));
      // Ensure Apps hosts can bind the UI even when reading tool result only.
      return {
        ...result,
        _meta: {
          ...(result._meta ?? {}),
          ui: { resourceUri: VAULT_MANAGER_UI },
        },
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

registerAppResource(
  server,
  "Password Space Vault Manager",
  VAULT_MANAGER_UI,
  {
    description:
      "Interactive vault manager UI (MCP Apps). If the host does not fetch this resource, show apps_fallback from vault_manager JSON.",
    mimeType: RESOURCE_MIME_TYPE,
  },
  async () => {
    const html = loadVaultManagerHtml();
    return {
      contents: [
        {
          uri: VAULT_MANAGER_UI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: {
            ui: { resourceUri: VAULT_MANAGER_UI },
          },
        },
      ],
    };
  },
);

const STORE_SECRET_DESCRIPTION =
  "Save a credential (API key, token, password) the user gave you, under a name, so you and later sessions can use it by name instead of asking again. " +
  "Call it as soon as the user hands you a secret, then use it with the CLI run command (returned as run_command). " +
  "The value goes to the OS keychain and is never returned. An existing name is not replaced unless overwrite is true. Never repeat the value in chat.";

const storeSecretSchema = {
  name: z
    .string()
    .min(1)
    .max(128)
    .describe("Descriptive name, e.g. GITHUB_TOKEN or OPENAI_API_KEY. Never the secret itself."),
  value: z.string().min(1).describe("The secret value. Stored in the keychain; never echoed back."),
  overwrite: z
    .boolean()
    .optional()
    .describe("Set true only to replace an existing secret of the same name (e.g. a rotated key). Default false."),
  tags: z
    .array(z.string())
    .optional()
    .describe('Optional labels (e.g. ["github"]). Plain text, not secret.'),
  notes: z.string().optional().describe("Optional reminder, e.g. what the key is for. Plain text, not secret."),
};

const storeSecretHandler = async (args: {
  name: string;
  value: string;
  overwrite?: boolean;
  tags?: string[];
  notes?: string;
}) => {
  try {
    return await withVaultStore(dataDir, (store) => storeSecretTool(store, args));
  } catch (err) {
    return errorResult(err, args.value);
  }
};

server.registerTool(
  "store_secret",
  { title: "Save a secret to the vault", description: STORE_SECRET_DESCRIPTION, inputSchema: storeSecretSchema },
  storeSecretHandler,
);

server.registerTool(
  "vault_set_secret",
  {
    title: "Save a secret (alias of store_secret)",
    description: `Same as store_secret. ${STORE_SECRET_DESCRIPTION}`,
    inputSchema: storeSecretSchema,
  },
  storeSecretHandler,
);

const REMOVE_SECRET_DESCRIPTION =
  "Permanently delete a saved secret by name (its keychain value and its name). Only when the user asks to remove or forget it. Never returns the value.";

const removeSecretSchema = {
  name: z.string().min(1).describe("Name (or id) of the secret to delete, as shown by list_secrets."),
};

const removeSecretHandler = async ({ name }: { name: string }) => {
  try {
    return await withVaultStore(dataDir, (store) => removeSecretTool(store, name));
  } catch (err) {
    return errorResult(err);
  }
};

server.registerTool(
  "remove_secret",
  { title: "Delete a secret from the vault", description: REMOVE_SECRET_DESCRIPTION, inputSchema: removeSecretSchema },
  removeSecretHandler,
);

server.registerTool(
  "vault_delete_secret",
  {
    title: "Delete a secret (alias of remove_secret)",
    description: `Same as remove_secret. ${REMOVE_SECRET_DESCRIPTION}`,
    inputSchema: removeSecretSchema,
  },
  removeSecretHandler,
);

server.tool(
  "list_secrets",
  "List saved credential names (no values). Check this first whenever a task needs an API key, token or password: if it is here, use it by name and do not ask the user for it again.",
  {
    tag: z.string().optional().describe("Optional tag filter"),
  },
  async ({ tag }) => {
    try {
      return await withVaultStore(dataDir, (store) => listSecretsTool(store, tag));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "get_secret_metadata",
  "Get details for one saved credential by name. Never returns the secret value.",
  {
    name: z.string().describe("Secret name or id"),
  },
  async ({ name }) => {
    try {
      return await withVaultStore(dataDir, (store) => getSecretMetadataTool(store, name));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "inject_secret",
  "Writes a short-lived local env file with the credential and returns a handle. Prefer running commands with the Terminal CLI `run -s NAME -- <command>` (see vault_status run_command), which writes no file. Do NOT read the file into chat.",
  {
    name: z.string().describe("Secret name or id"),
    env_var: z
      .string()
      .optional()
      .describe("Environment variable name to write (default: derived from secret name)"),
  },
  async ({ name, env_var }) => {
    try {
      return await withVaultStore(dataDir, (store) => injectSecretTool(store, dataDir, { name, env_var }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "resolve_secret",
  "LAST RESORT: returns plaintext in the tool result. Prefer the CLI run command or inject_secret. Requires confirm_redaction=true.",
  {
    name: z.string().describe("Secret name or id"),
    confirm_redaction: z
      .boolean()
      .optional()
      .describe("Must be true to acknowledge client will redact transcripts"),
  },
  async ({ name, confirm_redaction }) => {
    try {
      return await withVaultStore(dataDir, (store) =>
        resolveSecretTool(store, { name, confirm_redaction: confirm_redaction === true }),
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

function errorResult(err: unknown, secretValue?: string) {
  // Never let an error message carry a value an agent just tried to store.
  const message = scrubValue(err instanceof Error ? err.message : String(err), secretValue);
  const payload: Record<string, unknown> = { ok: false, error: message };

  if (err instanceof NodeVersionError) {
    payload.code = err.code;
    payload.found = err.found;
    payload.required = err.required;
    payload.howToFix =
      "Install Node.js 20+ from https://nodejs.org, then reload Cursor. Do not edit mcp.json.";
    payload.what_to_do = [
      "Run `node -v` in Terminal — it must be v20 or newer.",
      "Reload the Cursor window.",
      "Run /setup-password-space again.",
    ];
  } else if (/not set up|not initialized/i.test(message)) {
    payload.howToFix = `Run \`${CLI_SETUP_COMMANDS.plugin_setup}\` or /setup-password-space and follow primary_action (Terminal-first; no clone).`;
    payload.recommended_path = "cli_setup";
    payload.copy_paste_command = bundledCliCommand("setup");
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  };
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
