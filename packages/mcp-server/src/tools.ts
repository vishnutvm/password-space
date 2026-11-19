import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VaultStore,
  clearExpiredInjectFiles,
  clearInjectFile,
  envNameFor,
  hasLegacyEncryptedVault,
  scheduleInjectCleanup,
  secretsStorePath,
  vaultDbPath,
  writeInjectFile,
  type InjectHandle,
  type SecretMetadata,
} from "@password-space/vault";

export type ToolJsonResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: {
    redact_in_transcript?: boolean;
    ui?: { resourceUri: string };
  };
};

function jsonResult(
  payload: Record<string, unknown>,
  opts?: { redact?: boolean; isError?: boolean },
): ToolJsonResult {
  const text = JSON.stringify(payload, null, 2);
  return {
    content: [{ type: "text", text }],
    structuredContent: payload,
    ...(opts?.isError ? { isError: true } : {}),
    ...(opts?.redact ? { _meta: { redact_in_transcript: true } } : {}),
  };
}

/** Bundled CLI path inside the marketplace plugin package (next to MCP `dist/index.js`). */
export const BUNDLED_CLI_RELATIVE = "dist/cli.js";

export const BUNDLED_CLI_NODE =
  `node "\${CURSOR_PLUGIN_ROOT}/${BUNDLED_CLI_RELATIVE}"` as const;

/**
 * Exact Terminal commands — primary add / remove / list path.
 * No repo clone required: CLI ships in the plugin at `dist/cli.js`.
 */
export const CLI_SETUP_COMMANDS = {
  plugin_setup: `${BUNDLED_CLI_NODE} setup`,
  plugin_set: `${BUNDLED_CLI_NODE} set`,
  from_clone_optional:
    "cd /path/to/password-space && pnpm install && pnpm build && pnpm password-space setup",
  set_from_clone_optional:
    "cd /path/to/password-space && pnpm password-space set",
  global_cli: "password-space setup",
  set_global: "password-space set",
} as const;

export function resolveBundledCliPath(): string | undefined {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const sibling = join(here, "cli.js");
    if (existsSync(sibling)) return sibling;
  } catch {
    // import.meta.url unavailable in unusual hosts — fall through
  }
  const root = process.env.CURSOR_PLUGIN_ROOT?.trim();
  if (root && !root.includes("${")) {
    const fromEnv = join(root, BUNDLED_CLI_RELATIVE);
    if (existsSync(fromEnv)) return fromEnv;
  }
  return undefined;
}

function shellQuote(path: string): string {
  return `"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function bundledCliCommand(
  subcommand: "setup" | "set" | string = "",
): string {
  const abs = resolveBundledCliPath();
  const base = abs ? `node ${shellQuote(abs)}` : BUNDLED_CLI_NODE;
  const sub = subcommand.trim();
  return sub ? `${base} ${sub}` : base;
}

const TRUST_LINE =
  "Secret values live in this device's OS keychain (or a local 0600 file when there is no keychain). Hand one to your agent once and it saves it with store_secret (or name it yourself in Terminal); after that it is used by name and never shown again.";

/** Where values live, the migrate hint, and how agents should use a secret. */
function storageFields(store: VaultStore): Record<string, unknown> {
  const info = store.storageInfo();
  return {
    storage: info.backend,
    values: info,
    ...(info.migration_available
      ? {
          migrate_command: bundledCliCommand("migrate"),
          migrate_note:
            "Values are in plain text in secrets.json and this machine has an OS keychain. Call setup_vault to move them into the keychain (no Terminal needed).",
        }
      : {}),
    run_command: bundledCliCommand("run -s <SECRET_NAME> -- <command>"),
    run_note:
      "Preferred way for agents to use a secret: run the command through the CLI so the value goes straight into the child process env and is redacted from its output.",
  };
}

export const MIN_NODE_MAJOR = 20;

export type PrerequisiteCheck = {
  ok: boolean;
  node_version: string;
  node_major: number;
  node_ok: boolean;
  required_node: string;
  howToFix?: string;
};

export function checkPrerequisites(
  nodeVersion: string = process.version,
): PrerequisiteCheck {
  const match = /^v(\d+)\./.exec(nodeVersion);
  const nodeMajor = match ? Number(match[1]) : 0;
  const nodeOk = nodeMajor >= MIN_NODE_MAJOR;
  return {
    ok: nodeOk,
    node_version: nodeVersion,
    node_major: nodeMajor,
    node_ok: nodeOk,
    required_node: `>=${MIN_NODE_MAJOR}`,
    howToFix: nodeOk
      ? undefined
      : `Install Node.js ${MIN_NODE_MAJOR} or newer from https://nodejs.org (macOS: the .pkg installer, or \`brew install node\`), then restart Claude Code or reload Cursor (the MCP server runs on that Node).`,
  };
}

export type SetupState =
  | "fix_node"
  | "needs_init"
  | "ready";

export function onboardingProgress(
  initialized: boolean,
): { phase: string; headline: string; step_of: string } {
  if (!initialized) {
    return {
      phase: "1/2",
      headline: "Create your local secret store",
      step_of: "Step 1 of 2 · Ensure the store",
    };
  }
  return {
    phase: "2/2",
    headline: "Add a named secret",
    step_of: "Step 2 of 2 · Name once, use by name",
  };
}

export type OnboardingStep = {
  id: string;
  phase: string;
  title: string;
  done: boolean;
  tool?: string;
  user_action?: string;
};

export type PrimaryAction = {
  id:
    | "fix_node"
    | "setup_vault"
    | "ready";
  title: string;
  do_this: string;
  mcp_tool?: string;
  never: string;
  recommended_path?: "setup_vault" | "ready";
  /** Optional Terminal route for a user who prefers to type values there. Never the default. */
  terminal_fallback?: string;
  alternatives?: Array<{
    id: string;
    title: string;
    do_this: string;
  }>;
  advanced_escape_hatch?: {
    title: string;
    cli_command: string;
    when: string;
  };
};

export function resolveSetupState(opts: {
  prereqOk: boolean;
  initialized: boolean;
}): SetupState {
  if (!opts.prereqOk) return "fix_node";
  if (!opts.initialized) return "needs_init";
  return "ready";
}

export function buildPrimaryAction(
  initialized: boolean,
  prereqOk = true,
): PrimaryAction {
  if (!prereqOk) {
    return {
      id: "fix_node",
      title: "Upgrade Node.js",
      do_this: `Tell the user to install Node.js ${MIN_NODE_MAJOR}+ (https://nodejs.org, or \`brew install node\` on a Mac), then restart Claude Code / reload Cursor so the Password Space MCP can start.`,
      never: "Do not edit mcp.json. Do not paste secrets into chat.",
    };
  }

  if (!initialized) {
    return {
      id: "setup_vault",
      title: "Create the local store (the agent does it)",
      do_this:
        "Call the setup_vault tool now. It creates ~/.password-space and uses the OS keychain when there is one. The user types nothing and runs nothing in Terminal.",
      mcp_tool: "setup_vault",
      recommended_path: "setup_vault",
      terminal_fallback: bundledCliCommand("setup --yes"),
      never:
        "Never ask the user to paste a Terminal command for setup. Never ask the user to edit mcp.json. Never echo secret values.",
      alternatives: [
        {
          id: "list_secrets",
          title: "Check status",
          do_this: "After setup_vault, call vault_status or list_secrets.",
        },
      ],
      advanced_escape_hatch: {
        title: "Contributor clone (optional)",
        cli_command: CLI_SETUP_COMMANDS.from_clone_optional,
        when: "Only if developing Password Space from a git clone — not required for external users.",
      },
    };
  }

  return {
    id: "ready",
    title: "Ready: save, use and remove secrets by name",
    do_this:
      "Setup is done. Tell the user they can now say things like \"save this token as GITHUB_TOKEN: <token>\" or \"remove GITHUB_TOKEN\". Save with store_secret, use with run_command, remove with remove_secret. Check list_secrets before asking for any key.",
    recommended_path: "ready",
    terminal_fallback: bundledCliCommand("set"),
    never: "Never repeat a secret value in chat. Never ask for a key that list_secrets already has.",
    alternatives: [
      {
        id: "store_secret",
        title: "Agent saves a key the user hands over",
        do_this:
          "When the user gives you a credential, call store_secret with a descriptive name, then use it by name with run. Never repeat the value.",
      },
      {
        id: "remove_secret",
        title: "Agent removes a key",
        do_this: "When the user asks to remove or forget a key, call remove_secret with its name.",
      },
      {
        id: "terminal_set",
        title: "Optional: type the value in Terminal instead of chat",
        do_this: `Only if the user does not want the value in the chat history: they can run ${bundledCliCommand("set")} and type it at a hidden prompt.`,
      },
    ],
    advanced_escape_hatch: {
      title: "Contributor clone set (optional)",
      cli_command: CLI_SETUP_COMMANDS.set_from_clone_optional,
      when: "Only when developing from a git clone.",
    },
  };
}

export function buildOnboardingSteps(
  initialized: boolean,
): OnboardingStep[] {
  return [
    {
      id: "check",
      phase: "1/2",
      title: "Welcome",
      done: true,
      tool: "vault_onboard",
      user_action: "You're in the right place. The agent does the setup; nothing to paste in Terminal.",
    },
    {
      id: "init",
      phase: "1/2",
      title: "Create the local store",
      done: initialized,
      tool: "setup_vault",
      user_action: initialized
        ? undefined
        : "The agent calls setup_vault — creates ~/.password-space (values go to the OS keychain). No passphrase.",
    },
    {
      id: "store",
      phase: "2/2",
      title: "Save a secret",
      done: false,
      tool: "store_secret",
      user_action: 'Tell the agent "save this token as GITHUB_TOKEN" and give it the token once.',
    },
    {
      id: "use",
      phase: "2/2",
      title: "Use with your agent",
      done: false,
      tool: "run_command",
      user_action: "Ask the agent to use the secret by name — it runs commands via the CLI `run -s NAME -- <command>`, never pastes the value.",
    },
  ];
}

function recoveryGuidance(opts: {
  setup_state: SetupState;
  initialized: boolean;
  storeExists: boolean;
  legacyEncrypted: boolean;
}): { code: string; howToFix: string; what_to_do: string[] } {
  switch (opts.setup_state) {
    case "fix_node":
      return {
        code: "node_too_old",
        howToFix: `Install Node.js ${MIN_NODE_MAJOR}+ from https://nodejs.org (or \`brew install node\` on a Mac), then restart Claude Code / reload Cursor.`,
        what_to_do: [
          `Confirm \`node -v\` shows v${MIN_NODE_MAJOR} or newer.`,
          "Restart Claude Code (or reload the Cursor window) so the MCP server restarts on the new Node.",
          "Run /password-space:setup-password-space again.",
        ],
      };
    case "needs_init":
      return {
        code: opts.legacyEncrypted ? "legacy_encrypted_vault" : "store_missing",
        howToFix: opts.legacyEncrypted
          ? "Legacy encrypted vault.db detected (left untouched). Call setup_vault to create the new store, then save secrets again with store_secret."
          : "Call setup_vault to create the local store — no passphrase, no unlock, nothing for the user to run.",
        what_to_do: [
          "Call setup_vault.",
          "Then save secrets the user hands over with store_secret.",
          ...(opts.legacyEncrypted
            ? ["Old vault.db is not auto-migrated — re-add secrets by name."]
            : []),
        ],
      };
    default:
      return {
        code: "ready",
        howToFix: "Store is ready. Save a credential with store_secret when the user hands one over.",
        what_to_do: [
          "list_secrets before asking for any key; `run -s NAME -- <command>` to use one (no values in chat).",
          "store_secret to save, remove_secret to delete.",
        ],
      };
  }
}

/**
 * Agent-run setup: creates the store (OS keychain when available) and moves
 * any plain-text values into the keychain. Safe to call again. The user types
 * nothing; no values are read or returned.
 */
export function setupVaultTool(store: VaultStore, dataDir: string): ToolJsonResult {
  const prereq = checkPrerequisites();
  const wasInitialized = store.isInitialized();
  store.ensure();
  let migrated: number | null = null;
  let migrate_error: string | undefined;
  if (store.storageInfo().migration_available) {
    try {
      migrated = store.migrate("keychain").moved;
    } catch (err) {
      migrate_error = err instanceof Error ? err.message : String(err);
    }
  }
  const info = store.storageInfo();
  const count = store.listSecrets().length;
  const where =
    info.backend === "keychain"
      ? `your OS keychain (${info.keychain})`
      : "a private file in ~/.password-space (no OS keychain available on this machine)";
  return jsonResult({
    ok: true,
    action: wasInitialized ? "already_set_up" : "created",
    data_dir: dataDir,
    store_path: secretsStorePath(dataDir),
    secret_count: count,
    ...(migrated !== null ? { moved_to_keychain: migrated } : {}),
    ...(migrate_error ? { migrate_error } : {}),
    prerequisites: prereq,
    ...storageFields(store),
    legacy_encrypted_vault: hasLegacyEncryptedVault(dataDir),
    tell_user:
      `Password Space is ready${wasInitialized ? " (it was already set up)" : ""}. Secret values are kept in ${where}. ` +
      'From now on just tell me things like "save this token as GITHUB_TOKEN", "use GITHUB_TOKEN to list my repos" or "remove GITHUB_TOKEN". Any later session finds saved secrets by name.',
    next: [
      "Tell the user tell_user in plain words. Do not show JSON or file paths unless asked.",
      "When the user hands you a credential, call store_secret. Before asking for one, call list_secrets.",
    ],
  });
}

export function vaultOnboardTool(store: VaultStore, dataDir: string): ToolJsonResult {
  const prereq = checkPrerequisites();
  const initialized = store.isInitialized();
  const storePath = secretsStorePath(dataDir);
  const storeExists = existsSync(storePath);
  const legacyEncrypted = hasLegacyEncryptedVault(dataDir);
  const setup_state = resolveSetupState({
    prereqOk: prereq.ok,
    initialized,
  });
  const steps = buildOnboardingSteps(initialized);
  const primary_action = buildPrimaryAction(initialized, prereq.ok);
  const ready = initialized && prereq.ok;
  const recovery = recoveryGuidance({
    setup_state,
    initialized,
    storeExists,
    legacyEncrypted,
  });

  const progress = onboardingProgress(initialized);
  const human_summary = !prereq.ok
    ? `Password Space needs Node.js ${MIN_NODE_MAJOR}+. Found ${prereq.node_version}.`
    : !initialized
      ? legacyEncrypted
        ? "Welcome. A legacy encrypted vault.db was found (untouched). The agent calls setup_vault to create the new store; then re-add secrets."
        : "Welcome to Password Space. Next: the agent calls setup_vault — nothing to type in Terminal, no passphrase."
      : "Store ready. Hand a key to the agent once (it saves it with store_secret); it is used by name after that.";

  return jsonResult({
    ok: prereq.ok,
    setup_state,
    data_dir: dataDir,
    store_path: storePath,
    db_path: storePath,
    db_exists: storeExists,
    store_exists: storeExists,
    ...storageFields(store),
    lock_unlock_needed: false,
    legacy_encrypted_vault: legacyEncrypted,
    legacy_db_path: legacyEncrypted ? vaultDbPath(dataDir) : null,
    initialized,
    unlocked: initialized,
    session: true,
    prerequisites: prereq,
    trust_line: TRUST_LINE,
    progress,
    checklist: steps,
    human_summary,
    primary_action,
    recommended_path: primary_action.recommended_path ?? null,
    next_tool: ready ? "list_secrets" : prereq.ok ? "setup_vault" : null,
    recovery,
    what_to_do: [primary_action.do_this],
    never_paste_in_chat: ["secret values"],
    never_edit: ["mcp.json"],
    never_do: [
      "Paste secret values into chat",
      "Ask the user to edit mcp.json",
      "Use App forms for add/remove",
      "Require unlock/passphrase for the happy path",
    ],
    elicitation_note:
      "Never ask for values via MCP elicitation. When the user hands over a value, save it once with store_secret and never repeat it. Lock/unlock not needed.",
  });
}

export function vaultStatusTool(store: VaultStore, dataDir: string): ToolJsonResult {
  const prereq = checkPrerequisites();
  const initialized = store.isInitialized();
  const storePath = secretsStorePath(dataDir);
  const storeExists = existsSync(storePath);
  const legacyEncrypted = hasLegacyEncryptedVault(dataDir);
  const setup_state = resolveSetupState({
    prereqOk: prereq.ok,
    initialized,
  });
  const steps = buildOnboardingSteps(initialized);
  const primary_action = buildPrimaryAction(initialized, prereq.ok);
  const recovery = recoveryGuidance({
    setup_state,
    initialized,
    storeExists,
    legacyEncrypted,
  });

  const progress = onboardingProgress(initialized);

  return jsonResult({
    ok: prereq.ok,
    setup_state,
    data_dir: dataDir,
    store_path: storePath,
    db_path: storePath,
    db_exists: storeExists,
    store_exists: storeExists,
    ...storageFields(store),
    lock_unlock_needed: false,
    legacy_encrypted_vault: legacyEncrypted,
    legacy_db_path: legacyEncrypted ? vaultDbPath(dataDir) : null,
    initialized,
    unlocked: initialized,
    session: true,
    secret_count: initialized ? store.listSecrets().length : 0,
    prerequisites: prereq,
    trust_line: TRUST_LINE,
    progress,
    headline: progress.headline,
    primary_action,
    next: primary_action.do_this,
    recovery,
    next_steps: steps.filter((s) => !s.done).map((s) => ({
      phase: s.phase,
      step: s.title,
      tool: s.tool,
      action: s.user_action,
    })),
    tip: !initialized
      ? "Call setup_vault to create the store (nothing for the user to run). Lock/unlock not needed."
      : "Save secrets with store_secret when the user hands one over; check list_secrets first.",
    recommended_path: primary_action.recommended_path ?? null,
  });
}

/**
 * Vault Manager — status-only JSON (+ optional Apps UI). Not a human setup path.
 */
export function vaultManagerTool(store: VaultStore, dataDir: string): ToolJsonResult {
  clearExpiredInjectFiles(dataDir);
  const status = vaultStatusTool(store, dataDir);
  const parsed = JSON.parse(status.content[0]!.text) as Record<string, unknown>;
  const secrets = store.isInitialized()
    ? store.listSecrets().map(publicMeta)
    : [];
  return jsonResult({
    ok: true,
    app: "vault-manager",
    mode: "status_only",
    ui_resource: "ui://password-space/vault-manager.html",
    resource_mime_hint: "text/html;profile=mcp-app",
    progressive_enhancement:
      "Status-only. Do not guide users to App forms for add. Setup is setup_vault; saving is store_secret.",
    apps_ui_expected: false,
    agent_contract:
      "Do not call vault_manager for setup. Call setup_vault instead. Use list_secrets / store_secret / remove_secret. Never paste App HTML/JS into chat.",
    apps_fallback: {
      reason:
        "No App forms. The agent sets up with setup_vault and saves with store_secret; Terminal set is an optional fallback.",
      recommended_path: store.isInitialized() ? "ready" : "setup_vault",
      next_tool: store.isInitialized() ? "store_secret" : "setup_vault",
      terminal_fallback: store.isInitialized()
        ? bundledCliCommand("set")
        : bundledCliCommand("setup --yes"),
      never: [
        "Guide users to Vault Manager / App forms for add",
        "Paste vault-manager.html / minified JS into chat",
        "FetchMcpResource ui://password-space/vault-manager.html into the transcript",
        "Require unlock/passphrase",
      ],
    },
    status: parsed,
    secrets,
    capabilities: {
      list: "list_secrets (MCP) or Terminal list",
      add_or_edit: "Terminal set, or store_secret (MCP) when the user hands the agent a credential",
      remove: "Terminal remove, or remove_secret (MCP)",
      lock: "Not needed",
      unlock: "Not needed",
      change_passphrase: "Not used",
      inject: "Terminal run -s NAME -- <command> (preferred) or inject_secret",
    },
    passphrase_note: "Passphrases are not used.",
    elicitation_note: "Never ask for values via MCP elicitation.",
  });
}

/** Audit-log actor for changes made by an agent over MCP. */
export const AGENT_ACTOR = "mcp-agent";

const SECRET_NAME_MAX = 128;
/** Values shorter than this are too common to look for inside names / notes / tags. */
const MIN_LEAK_CHECK_LENGTH = 4;

export type StoreSecretArgs = {
  name: string;
  value: string;
  overwrite?: boolean;
  tags?: string[];
  notes?: string;
};

/** Replace every occurrence of `value` in `text` so an error can never echo a secret. */
export function scrubValue(text: string, value: string | undefined): string {
  if (!value) return text;
  return text.split(value).join("[REDACTED]");
}

function invalidName(name: string): string | null {
  if (!name) return "Secret name is required.";
  if (name.length > SECRET_NAME_MAX) {
    return `Secret name is too long (max ${SECRET_NAME_MAX} characters).`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return "Secret name cannot contain line breaks or control characters.";
  }
  return null;
}

function useByName(name: string): Record<string, unknown> {
  const envVar = envNameFor(name);
  return {
    env_var: envVar,
    run_command: bundledCliCommand(`run -s ${JSON.stringify(name)} -- <command>`),
    run_note: `The command sees the value as $${envVar}; its output is redacted. Never echo or print the variable.`,
  };
}

/**
 * Agent path to save a credential the user handed over: stores it by name
 * (OS keychain when available) so later sessions use it by name instead of
 * asking again. Never returns the value; refuses to replace an existing
 * name unless `overwrite` is true.
 */
export function storeSecretTool(store: VaultStore, args: StoreSecretArgs): ToolJsonResult {
  const name = (args.name ?? "").trim();
  const value = args.value;
  const nameProblem = invalidName(name);
  if (nameProblem) {
    return jsonResult({ ok: false, code: "invalid_name", error: nameProblem }, { isError: true });
  }
  if (typeof value !== "string" || value.length === 0) {
    return jsonResult(
      { ok: false, code: "invalid_value", error: "Secret value is required." },
      { isError: true },
    );
  }
  if (value.length >= MIN_LEAK_CHECK_LENGTH) {
    const visible = [name, args.notes ?? "", ...(args.tags ?? [])];
    if (visible.some((field) => field.includes(value))) {
      return jsonResult(
        {
          ok: false,
          code: "value_in_metadata",
          error:
            "The secret value appears in the name, notes or tags, which are stored and shown in plain text. Use a descriptive name (e.g. GITHUB_TOKEN) and pass the secret only as value.",
        },
        { isError: true },
      );
    }
  }

  try {
    store.ensure();
    const existing = store.hasSecret(name) ? publicMeta(store.getMetadata(name)) : null;
    if (existing && !args.overwrite) {
      return jsonResult(
        {
          ok: false,
          code: "already_exists",
          error: `A secret named "${existing.name}" already exists. Nothing was changed.`,
          secret: existing,
          how_to_replace:
            "Only if the user wants to replace it (e.g. a rotated key), call store_secret again with overwrite: true. Otherwise pick a different name, or just use the existing one.",
          ...useByName(existing.name),
        },
        { isError: true },
      );
    }

    const meta = publicMeta(
      store.setSecret({
        id: existing?.id,
        // Keep the stored spelling when replacing (names match case-insensitively).
        name: existing?.name ?? name,
        value,
        tags: args.tags ?? existing?.tags ?? [],
        notes: args.notes ?? existing?.notes ?? null,
        actor: AGENT_ACTOR,
      }),
    );
    const payload = {
      ok: true,
      action: existing ? "updated" : "created",
      secret: meta,
      storage: store.storageInfo().backend,
      ...useByName(meta.name),
      next: [
        `Tell the user it is saved as "${meta.name}" (do not repeat the value).`,
        "From now on use it by name with run_command. Do not ask the user for it again.",
      ],
      note: "Value stored and not returned. The copy the user pasted into chat stays in this conversation's history.",
    };
    const serialized = JSON.stringify(payload);
    if (serialized.includes(value)) {
      throw new Error("Refusing to return tool result that contains secret plaintext");
    }
    return jsonResult(payload, { redact: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(scrubValue(message, value));
  }
}

/** Back-compat name for {@link storeSecretTool} (MCP tool `vault_set_secret`). */
export const vaultSetSecretTool = storeSecretTool;

/** Removes a secret by name or id: the keychain entry and its name. Never returns the value. */
export function removeSecretTool(store: VaultStore, name: string): ToolJsonResult {
  assertReady(store);
  const target = (name ?? "").trim();
  if (!target || !store.hasSecret(target)) {
    return jsonResult(
      {
        ok: false,
        code: "not_found",
        error: `No secret named "${target}". Nothing was removed.`,
        available: store.listSecrets().map((m) => m.name),
      },
      { isError: true },
    );
  }
  const meta = store.getMetadata(target);
  store.deleteSecret(meta.id, AGENT_ACTOR);
  return jsonResult({
    ok: true,
    removed: meta.name,
    note: "Secret removed from the vault (and the OS keychain when used). Value was not returned.",
  });
}

/** Back-compat name for {@link removeSecretTool} (MCP tool `vault_delete_secret`). */
export const vaultDeleteSecretTool = removeSecretTool;

export function listSecretsTool(store: VaultStore, tag?: string): ToolJsonResult {
  if (!store.isInitialized()) {
    return jsonResult({
      secrets: [],
      initialized: false,
      next: "No store yet. Call setup_vault (nothing for the user to run), or just store_secret when the user hands you a key — it creates the store.",
      note: "Names/ids/tags only. Values are never returned by list_secrets.",
    });
  }
  const secrets = store.listSecrets(tag).map(publicMeta);
  return jsonResult({
    secrets,
    note: "Names/ids/tags only. Values are never returned by list_secrets.",
  });
}

export function getSecretMetadataTool(store: VaultStore, idOrName: string): ToolJsonResult {
  assertReady(store);
  const meta = publicMeta(store.getMetadata(idOrName));
  return jsonResult({
    secret: meta,
    note: "Metadata only — no secret value.",
  });
}

/** Inject files written by this process, deleted at expiry or on shutdown. */
const liveInjectFiles = new Map<string, () => void>();

/** Delete every inject file this process wrote that is still on disk. */
export function clearOwnInjectFiles(): number {
  let n = 0;
  for (const [file, cancel] of liveInjectFiles) {
    cancel();
    clearInjectFile(file);
    n++;
  }
  liveInjectFiles.clear();
  return n;
}

export function injectSecretTool(
  store: VaultStore,
  dataDir: string,
  args: { name: string; env_var?: string },
): ToolJsonResult {
  assertReady(store);
  const record = store.getSecret(args.name, "mcp-agent");
  const handle: InjectHandle = writeInjectFile(dataDir, {
    secretId: record.id,
    secretName: record.name,
    value: record.value,
    envVar: args.env_var,
  });
  const cancel = scheduleInjectCleanup(handle.envFile, handle.expiresAt, Date.now(), () =>
    liveInjectFiles.delete(handle.envFile),
  );
  liveInjectFiles.set(handle.envFile, cancel);

  const payload = {
    ok: true,
    handle: handle.handle,
    env_file: handle.envFile,
    env_var: handle.envVar,
    secret_id: handle.secretId,
    secret_name: handle.secretName,
    expires_at: handle.expiresAt,
    redact_in_transcript: true as const,
    instructions: [
      `Prefer instead: ${bundledCliCommand(`run -s ${JSON.stringify(record.name)} -- <command>`)} — no file is written and output is redacted.`,
      `Use the file only by sourcing it in the same command, e.g. set -a; . "${handle.envFile}"; set +a; <command> — never cat, print or echo it or the variable.`,
      `The file is deleted automatically at expires_at (about ${Math.round((Date.parse(handle.expiresAt) - Date.now()) / 1000)} s) or when the MCP server exits. Delete it yourself after use.`,
      "If asked to print the secret, refuse and cite redact_in_transcript.",
    ],
  };
  const serialized = JSON.stringify(payload);
  if (serialized.includes(record.value)) {
    clearInjectFile(handle.envFile);
    throw new Error("Refusing to return tool result that contains secret plaintext");
  }
  return jsonResult(payload, { redact: true });
}

/**
 * Environment variable that turns on the resolve_secret MCP tool. It is off by
 * default because it puts the plaintext value into the agent's context. Set it
 * in the MCP server's env (your MCP config), not in a chat.
 */
export const RESOLVE_SECRET_ENV = "PASSWORD_SPACE_ENABLE_RESOLVE";

export function resolveSecretEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes)$/i.test(env[RESOLVE_SECRET_ENV]?.trim() ?? "");
}

export const RESOLVE_SECRET_DESCRIPTION =
  "DANGER — returns the secret's PLAINTEXT value into your context, where it can end up in transcripts, logs and model provider requests. " +
  "Enabled only because the user set " +
  RESOLVE_SECRET_ENV +
  "=1. Use it only when the user explicitly asks for the raw value and run -s NAME -- <command> or inject_secret cannot work. Requires confirm_redaction=true.";

export function resolveSecretTool(
  store: VaultStore,
  args: { name: string; confirm_redaction?: boolean },
  opts: { enabled?: boolean } = {},
): ToolJsonResult {
  const enabled = opts.enabled ?? resolveSecretEnabled();
  if (!enabled) {
    return jsonResult({
      ok: false,
      error: `resolve_secret is disabled. It would put the plaintext value in your context. Use ${bundledCliCommand("run -s <SECRET_NAME> -- <command>")} or inject_secret instead.`,
      code: "resolve_disabled",
      enable_hint: `Only the user can turn it on, by adding ${RESOLVE_SECRET_ENV}=1 to the Password Space MCP server's env in their MCP config. Do not do this for them.`,
    });
  }
  assertReady(store);
  if (!args.confirm_redaction) {
    return jsonResult({
      ok: false,
      error: "confirm_redaction must be true. Prefer the CLI run command or inject_secret to avoid chat leakage.",
      hint: "Call inject_secret instead, or pass confirm_redaction: true if your client redacts tool results.",
    });
  }
  const record = store.getSecret(args.name, "mcp-agent-resolve");
  const payload = {
    ok: true,
    secret_id: record.id,
    secret_name: record.name,
    value: record.value,
    redact_in_transcript: true as const,
    warning:
      "PLAINTEXT IN TOOL RESULT — do not repeat it in chat. The client MUST redact before displaying or logging. Prefer run -s NAME -- <command>.",
  };
  return jsonResult(payload, { redact: true });
}

function publicMeta(m: SecretMetadata): SecretMetadata {
  return {
    id: m.id,
    name: m.name,
    tags: m.tags,
    notes: m.notes,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

function assertReady(store: VaultStore): void {
  if (!store.isInitialized()) {
    throw new Error(
      "Password Space store is not set up yet. Call setup_vault (the user does not need to run anything). Lock/unlock are not needed.",
    );
  }
}

/** Test helper: ensure list payloads never contain a known value. */
export function assertNoPlaintext(result: ToolJsonResult, value: string): void {
  const text = result.content.map((c) => c.text).join("\n");
  if (value && text.includes(value)) {
    throw new Error("Tool result leaked plaintext secret");
  }
}
