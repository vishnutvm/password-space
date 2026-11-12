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
  HOST_LIMITATION,
  MCP_ENV_PATH,
  NodeVersionError,
  PassphraseRequiredError,
  getSecretMetadataTool,
  injectSecretTool,
  listSecretsTool,
  resolveSecretTool,
  vaultChangePassphraseTool,
  vaultDeleteSecretTool,
  vaultInitTool,
  vaultLockTool,
  vaultManagerTool,
  vaultOnboardTool,
  vaultSetSecretTool,
  vaultStatusTool,
  vaultUnlockTool,
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

const passphraseSchema = z
  .string()
  .min(8, "Passphrase must be at least 8 characters.")
  .describe(
    "Your vault passphrase (8+ characters). Enter here in the MCP approval form — do not paste into chat. Optional if PASSWORD_SPACE_PASSPHRASE is set in MCP Environment.",
  );

const optionalPassphraseShape = {
  passphrase: passphraseSchema.optional(),
};

const server = new McpServer({
  name: "password-space",
  version: "0.1.0",
});

server.registerTool(
  "vault_onboard",
  {
    title: "Get started with Password Space",
    description:
      "Guided setup in four steps — local, encrypted, nothing sensitive in the response. Best first call after install.",
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
      "Quick health check: vault created, unlocked, and your next step. Never returns passphrases or secret values.",
  },
  async () => {
    try {
      return await withVaultStore(dataDir, (store) => vaultStatusTool(store, dataDir));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "vault_init",
  {
    title: "Create your vault",
    description:
      "Step 2 of setup: creates an encrypted vault on this device. Enter your passphrase in the approval form (8+ characters), then call vault_unlock.",
    inputSchema: optionalPassphraseShape,
  },
  async ({ passphrase }) => {
    try {
      return await withVaultStore(dataDir, (store) => vaultInitTool(store, dataDir, { passphrase }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "vault_unlock",
  {
    title: "Unlock your vault",
    description:
      "Step 3 of setup: unlocks for this session so you can save and use credentials. Same passphrase in the approval form.",
    inputSchema: {
      ...optionalPassphraseShape,
      ttl_hours: z
        .number()
        .min(0.1)
        .max(168)
        .optional()
        .describe("How long to stay unlocked in hours (default 8, max 168)."),
    },
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
  "Lock Password Space — clears the unlock session on this machine.",
  {},
  async () => {
    try {
      return vaultLockTool(dataDir);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "vault_change_passphrase",
  {
    title: "Change vault passphrase",
    description:
      "Re-wraps the vault key under a new passphrase. Enter current and new passphrase in the approval form or Vault Manager App — never in chat, never via elicitation.",
    inputSchema: {
      current_passphrase: passphraseSchema.optional().describe(
        "Current vault passphrase. Optional if PASSWORD_SPACE_PASSPHRASE is set.",
      ),
      new_passphrase: z
        .string()
        .min(8)
        .describe("New passphrase (8+ characters). Enter in the approval form only."),
      ttl_hours: z.number().min(0.1).max(168).optional(),
    },
  },
  async ({ current_passphrase, new_passphrase, ttl_hours }) => {
    try {
      return await vaultChangePassphraseTool(dataDir, {
        current_passphrase,
        new_passphrase,
        ttl_hours,
      });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "vault_delete_secret",
  {
    title: "Remove a credential",
    description: "Deletes a saved credential by name. Never returns the secret value.",
    inputSchema: {
      name: z.string().min(1).describe("Secret name or id to delete"),
    },
  },
  async ({ name }) => {
    try {
      return await withVaultStore(dataDir, (store) => vaultDeleteSecretTool(store, name));
    } catch (err) {
      return errorResult(err);
    }
  },
);

registerAppTool(
  server,
  "vault_manager",
  {
    title: "Open Vault Manager",
    description:
      "Interactive Password Space Vault Manager (list/add/edit/remove credentials, lock/unlock, change passphrase). Primary onboarding UI (Cursor MCP Apps 2.6+). If only JSON returns, fall back to vault_init/vault_unlock with a passphrase in the approval form or PASSWORD_SPACE_PASSPHRASE — do not vault_init with empty {}.",
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

server.registerTool(
  "vault_set_secret",
  {
    title: "Save a password or API token",
    description:
      "Stores a credential in your vault. Fill name and value in the MCP approval form — never paste the value into chat. Returns only metadata.",
    inputSchema: {
      name: z
        .string()
        .min(1)
        .describe("Short label for this credential (e.g. GITHUB_TOKEN, OpenAI API key)."),
      value: z
        .string()
        .min(1)
        .describe(
          "The secret itself (token, password, API key). Enter in the approval form only — never in chat.",
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe('Optional labels for filtering (e.g. ["api", "github"]).'),
      notes: z.string().optional().describe("Optional reminder text (not secret)."),
    },
  },
  async ({ name, value, tags, notes }) => {
    try {
      return await withVaultStore(dataDir, (store) =>
        vaultSetSecretTool(store, { name, value, tags, notes }),
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "list_secrets",
  "List saved credential names (no values). Use before inject_secret.",
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
  "PREFERRED: let the agent use a credential without putting it in chat — writes a short-lived local env file and returns a handle. Do NOT read the file into chat.",
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
  "LAST RESORT: returns plaintext in the tool result. Prefer inject_secret. Requires confirm_redaction=true.",
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

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
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
  } else if (err instanceof PassphraseRequiredError) {
    payload.code = err.code;
    payload.host_limitation = err.host_limitation;
    payload.recommended_path = err.recommended_path;
    payload.howToFix =
      "Stop retrying vault_init/unlock with empty {}. Call vault_manager, type the passphrase in a visible approval form, or set PASSWORD_SPACE_PASSPHRASE in MCP Environment.";
    payload.what_happened =
      "Cursor approved the tool with empty {} — no passphrase was provided (common host limitation).";
    payload.what_to_do = [
      "Recommended: call vault_manager — create/unlock in the App UI if it renders.",
      "Or call vault_init / vault_unlock and type the passphrase in the approval form.",
      `Or: ${MCP_ENV_PATH}`,
      "Do not ask the user to reply \"ready\" then call vault_init again without a passphrase channel.",
      "Do not lead newcomers with Terminal CLI.",
    ];
    payload.advanced_escape_hatch = {
      title: "Terminal (power users only)",
      cli_command: CLI_SETUP_COMMANDS.from_clone,
      when: "Only if the user explicitly asks for Terminal / CLI.",
    };
    payload.never = [
      "Approve vault_init / vault_unlock with empty {}",
      'Tell the user to reply "ready" then call vault_init without passphrase',
      "Present Terminal CLI as the default onboarding path",
    ];
  } else if (/passphrase/i.test(message) && /8 character/i.test(message)) {
    payload.code = "passphrase_too_short";
    payload.howToFix = "Choose a passphrase with at least 8 characters, then try again.";
    payload.what_to_do = ["Use 8 or more characters for your vault passphrase."];
  } else if (/Wrong passphrase/i.test(message)) {
    payload.code = "wrong_passphrase";
    payload.howToFix =
      "That passphrase did not unlock the vault. Retry carefully via vault_manager, approval form, or MCP Environment — there is no recovery without the correct passphrase.";
  } else if (/locked/i.test(message)) {
    payload.howToFix =
      "Call vault_manager or vault_unlock with a passphrase in the approval form, or set PASSWORD_SPACE_PASSPHRASE then vault_unlock.";
    payload.host_limitation = HOST_LIMITATION;
    payload.recommended_path = "vault_manager";
  } else if (/not set up|not initialized/i.test(message)) {
    payload.howToFix =
      "Run /setup-password-space and follow primary_action (vault_manager first). Do not vault_init with empty {}.";
    payload.host_limitation = HOST_LIMITATION;
    payload.recommended_path = "vault_manager";
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
