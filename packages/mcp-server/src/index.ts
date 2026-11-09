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
  PassphraseRequiredError,
  getSecretMetadataTool,
  injectSecretTool,
  listSecretsTool,
  resolveSecretTool,
  vaultInitTool,
  vaultLockTool,
  vaultOnboardTool,
  vaultSetSecretTool,
  vaultStatusTool,
  vaultUnlockTool,
} from "./tools.js";

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
    title: "Password Space setup guide",
    description:
      "Start here if setup feels stuck. Returns a plain-English checklist (no secrets). Safe when vault_init failed because the passphrase field was empty.",
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
      "See whether your vault is created and unlocked, plus what to do next. Safe anytime — never returns passwords or secret values.",
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
    title: "Create Password Space vault",
    description:
      "First-time setup: creates an encrypted vault on this computer. You must enter a passphrase (8+ chars) in the approval form — approving with empty {} will fail. Does not unlock; call vault_unlock next.",
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
    title: "Unlock Password Space",
    description:
      "Unlocks the vault for several hours so the agent can store and use credentials. Enter the same passphrase in the approval form (or set PASSWORD_SPACE_PASSPHRASE in MCP Environment).",
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

  if (err instanceof PassphraseRequiredError) {
    payload.code = err.code;
    payload.what_happened =
      "Cursor approved the tool without a passphrase (empty approval is not enough).";
    payload.what_to_do = [
      "Open the tool again and type your passphrase in the passphrase field before approving.",
      "Or add PASSWORD_SPACE_PASSPHRASE in Cursor → Settings → MCP → password-space → Environment.",
      "Call vault_onboard for a full checklist — never paste the passphrase into chat.",
    ];
  } else if (/passphrase/i.test(message) && /8 character/i.test(message)) {
    payload.code = "passphrase_too_short";
    payload.what_to_do = ["Use at least 8 characters for your vault passphrase."];
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
