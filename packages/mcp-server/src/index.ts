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
import { defaultDataDir, openVault } from "@password-space/vault";
import {
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

const VAULT_MANAGER_UI = "ui://password-space/vault-manager.html";

function loadVaultManagerHtml(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "vault-manager.html"),
    join(here, "../app/vault-manager.html"),
    join(here, "../../plugins/password-space/dist/vault-manager.html"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  return `<!DOCTYPE html><html><body><p>Password Space Vault Manager UI is not bundled. Use vault_status / list_secrets tools instead.</p></body></html>`;
}

// defaultDataDir ignores empty / unresolved `${PASSWORD_SPACE_HOME}` placeholders
const dataDir = defaultDataDir();

function withStore<T>(fn: (store: ReturnType<typeof openVault>) => T): T {
  const store = openVault({ dataDir, useSession: true });
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

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
      return withStore((store) => vaultOnboardTool(store, dataDir));
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
      return withStore((store) => vaultStatusTool(store, dataDir));
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
      return await withStore((store) => vaultInitTool(store, dataDir, { passphrase }));
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
      return withStore((store) => vaultDeleteSecretTool(store, name));
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
      "Interactive Password Space Vault Manager (list/add/edit/remove credentials, lock/unlock, change passphrase). Progressive enhancement: hosts without MCP Apps still get structured JSON.",
    inputSchema: {},
    _meta: {
      ui: { resourceUri: VAULT_MANAGER_UI },
    },
  },
  async () => {
    try {
      return withStore((store) => vaultManagerTool(store, dataDir));
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
    description: "Interactive vault manager UI",
    mimeType: RESOURCE_MIME_TYPE,
  },
  async () => ({
    contents: [
      {
        uri: VAULT_MANAGER_UI,
        mimeType: RESOURCE_MIME_TYPE,
        text: loadVaultManagerHtml(),
      },
    ],
  }),
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
  "List saved credential names (no values). Use before inject_secret.",
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
  "Get details for one saved credential by name. Never returns the secret value.",
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
      return withStore((store) => injectSecretTool(store, dataDir, { name, env_var }));
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
    payload.howToFix =
      "Open the approval form again, enter your vault passphrase, then approve. Do not approve with empty {}.";
    payload.what_happened = "The passphrase field was empty.";
    payload.what_to_do = [
      "Type your passphrase in the approval form — don't approve with empty fields.",
      "Optional: Settings → MCP → password-space → Environment → PASSWORD_SPACE_PASSPHRASE.",
      "Run /setup-password-space (vault_onboard) for the single guided path.",
      "Advanced escape hatch only: `password-space setup` in Terminal.",
    ];
  } else if (/passphrase/i.test(message) && /8 character/i.test(message)) {
    payload.code = "passphrase_too_short";
    payload.howToFix = "Choose a passphrase with at least 8 characters, then try again.";
    payload.what_to_do = ["Use 8 or more characters for your vault passphrase."];
  } else if (/Wrong passphrase/i.test(message)) {
    payload.code = "wrong_passphrase";
    payload.howToFix =
      "That passphrase did not unlock the vault. Retry vault_unlock carefully — there is no recovery without the correct passphrase.";
  } else if (/locked/i.test(message)) {
    payload.howToFix = "Run vault_unlock and enter your passphrase in the approval form.";
  } else if (/not set up|not initialized/i.test(message)) {
    payload.howToFix = "Run /setup-password-space, then approve vault_init with your passphrase in the form.";
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
