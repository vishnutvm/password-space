import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VaultStore,
  clearExpiredInjectFiles,
  hasLegacyEncryptedVault,
  secretsStorePath,
  vaultDbPath,
  writeInjectFile,
  type InjectHandle,
  type SecretMetadata,
} from "@password-space/vault";

export type ToolJsonResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  _meta?: {
    redact_in_transcript?: boolean;
    ui?: { resourceUri: string };
  };
};

function jsonResult(
  payload: Record<string, unknown>,
  opts?: { redact?: boolean },
): ToolJsonResult {
  const text = JSON.stringify(payload, null, 2);
  return {
    content: [{ type: "text", text }],
    structuredContent: payload,
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

export class NodeVersionError extends Error {
  readonly code = "node_too_old" as const;
  readonly found: string;
  readonly required: string;

  constructor(found: string, requiredMajor: number) {
    super(
      `Password Space needs Node.js ${requiredMajor}+. Found ${found}.`,
    );
    this.name = "NodeVersionError";
    this.found = found;
    this.required = `>=${requiredMajor}`;
  }
}

const TRUST_LINE =
  "Secret values live in this device's OS keychain (or a local 0600 file when there is no keychain). Name them in Terminal; never paste values into chat.";

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
            "Values are in plain text in secrets.json and this machine has an OS keychain. Suggest the user run migrate_command in Terminal.",
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
      : `Install Node.js ${MIN_NODE_MAJOR} or newer from https://nodejs.org, then reload Cursor (MCP runs on the host Node).`,
  };
}

export function assertNodeVersion(nodeVersion: string = process.version): void {
  const check = checkPrerequisites(nodeVersion);
  if (!check.node_ok) {
    throw new NodeVersionError(check.node_version, MIN_NODE_MAJOR);
  }
}

export type SetupState =
  | "fix_node"
  | "needs_init"
  | "ready"
  | "recover_existing_vault";

export function onboardingProgress(
  initialized: boolean,
  _unlocked = true,
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
    | "cli_setup"
    | "cli_set"
    | "vault_manager";
  title: string;
  do_this: string;
  mcp_tool?: string;
  never: string;
  recommended_path?:
    | "cli_setup"
    | "cli_set"
    | "vault_manager";
  copy_paste_command?: string;
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
  unlocked?: boolean;
  session?: boolean;
}): SetupState {
  if (!opts.prereqOk) return "fix_node";
  if (!opts.initialized) return "needs_init";
  return "ready";
}

export function buildPrimaryAction(
  initialized: boolean,
  _unlocked = true,
  _session = true,
  prereqOk = true,
): PrimaryAction {
  if (!prereqOk) {
    return {
      id: "fix_node",
      title: "Upgrade Node.js",
      do_this: `Install Node.js ${MIN_NODE_MAJOR}+, then reload Cursor so the Password Space MCP can start.`,
      never: "Do not edit mcp.json. Do not paste secrets into chat.",
    };
  }

  if (!initialized) {
    return {
      id: "cli_setup",
      title: "Create your local store in Terminal",
      do_this:
        "Open Terminal and run the copy_paste_command below (no passphrase). Then run set to name a secret at the hidden prompt. Never paste values in chat.",
      recommended_path: "cli_setup",
      copy_paste_command: bundledCliCommand("setup"),
      never:
        "Never paste secret values into chat. Never ask the user to edit mcp.json. Do not use App forms for add/remove.",
      alternatives: [
        {
          id: "list_secrets",
          title: "Check status via MCP",
          do_this: "After Terminal setup + set, call vault_status or list_secrets.",
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
    id: "cli_set",
    title: "Add a named secret in Terminal",
    do_this:
      "Open Terminal and run the copy_paste_command (or bare cli.js for the interactive menu). Type the secret name, then the value at the hidden prompt. Ask the agent to use it by name via inject_secret.",
    recommended_path: "cli_set",
    copy_paste_command: bundledCliCommand("set"),
    never: "Never paste API keys or passwords into chat.",
    alternatives: [
      {
        id: "list_secrets",
        title: "List via MCP",
        do_this: "After Terminal add, call list_secrets or vault_status (no values).",
      },
      {
        id: "cli_menu",
        title: "Interactive Terminal menu",
        do_this: `Run ${bundledCliCommand("")} (no subcommand) for setup / add / remove / list / status.`,
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
  _unlocked = true,
  _session = true,
): OnboardingStep[] {
  return [
    {
      id: "check",
      phase: "1/2",
      title: "Welcome",
      done: true,
      tool: "vault_onboard",
      user_action:
        "You're in the right place. Follow primary_action — Terminal for setup/add/remove (plugin-bundled CLI; no clone).",
    },
    {
      id: "init",
      phase: "1/2",
      title: "Ensure local store",
      done: initialized,
      tool: "cli_setup",
      user_action: initialized
        ? undefined
        : `Run Terminal \`${CLI_SETUP_COMMANDS.plugin_setup}\` — creates ~/.password-space (values go to the OS keychain). No passphrase.`,
    },
    {
      id: "store",
      phase: "2/2",
      title: "Name a secret",
      done: false,
      tool: "cli_set",
      user_action: `In Terminal run \`${CLI_SETUP_COMMANDS.plugin_set}\` — type name, then hidden value. Never in chat.`,
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
        howToFix: `Install Node.js ${MIN_NODE_MAJOR}+ from https://nodejs.org, then reload Cursor.`,
        what_to_do: [
          `Confirm \`node -v\` shows v${MIN_NODE_MAJOR} or newer.`,
          "Reload the Cursor window so MCP restarts on the new Node.",
          "Run /setup-password-space again.",
        ],
      };
    case "needs_init":
      return {
        code: opts.legacyEncrypted ? "legacy_encrypted_vault" : "store_missing",
        howToFix: opts.legacyEncrypted
          ? `Legacy encrypted vault.db detected (left untouched). Create the new store with \`${CLI_SETUP_COMMANDS.plugin_setup}\`, then re-add secrets with set.`
          : `Create the local store in Terminal with \`${CLI_SETUP_COMMANDS.plugin_setup}\` — no passphrase, no unlock.`,
        what_to_do: [
          `Run: ${bundledCliCommand("setup")}`,
          `Then: ${bundledCliCommand("set")}`,
          "Do not use App forms for add — Terminal CLI only.",
          ...(opts.legacyEncrypted
            ? ["Old vault.db is not auto-migrated — re-add secrets by name in Terminal."]
            : []),
        ],
      };
    default:
      return {
        code: "ready",
        howToFix: `Store is ready. Add a credential in Terminal with \`${CLI_SETUP_COMMANDS.plugin_set}\`.`,
        what_to_do: [
          `Run: ${bundledCliCommand("set")}`,
          "Then list_secrets via MCP, and `run -s NAME -- <command>` to use a secret (no values in chat).",
        ],
      };
  }
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
  const primary_action = buildPrimaryAction(initialized, true, true, prereq.ok);
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
        ? "Welcome. A legacy encrypted vault.db was found (untouched). Create the new store in Terminal, then re-add secrets."
        : "Welcome to Password Space. Next: open Terminal and run setup, then set — no passphrase or unlock."
      : "Store ready. Add named secrets in Terminal; agents use them by name via the CLI run command.";

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
    copy_paste_command: primary_action.copy_paste_command,
    next_tool: ready ? "list_secrets" : "vault_status",
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
      "Secret values are collected in Terminal (hidden prompts) only — never via MCP elicitation, never in chat. Lock/unlock not needed.",
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
  const primary_action = buildPrimaryAction(initialized, true, true, prereq.ok);
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
      ? `Default: plugin Terminal CLI (${bundledCliCommand("setup")} then set). Lock/unlock not needed.`
      : `Add secrets in Terminal: ${bundledCliCommand("set")}`,
    recommended_path: primary_action.recommended_path ?? null,
    copy_paste_command: primary_action.copy_paste_command,
  });
}

export function vaultDeleteSecretTool(store: VaultStore, name: string): ToolJsonResult {
  assertReady(store);
  store.deleteSecret(name);
  return jsonResult({
    ok: true,
    deleted: name,
    note: "Secret removed. Value was not returned.",
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
      "Status-only. Do not guide users to App forms for add. Human UX is the plugin Terminal CLI.",
    apps_ui_expected: false,
    agent_contract:
      "Do not call vault_manager for setup. Show Terminal copy_paste_command instead. Use list_secrets / inject_secret. Never paste App HTML/JS into chat.",
    apps_fallback: {
      reason:
        "Human credential UX is Terminal-only. Run copy_paste_command (or bare cli.js for the menu). Do not use App forms.",
      recommended_path: store.isInitialized() ? "cli_set" : "cli_setup",
      next_tool: store.isInitialized() ? "cli_set" : "cli_setup",
      copy_paste_command: store.isInitialized()
        ? bundledCliCommand("set")
        : bundledCliCommand("setup"),
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
      add_or_edit: "Terminal set / interactive menu only",
      remove: "Terminal remove (or vault_delete_secret)",
      lock: "Not needed",
      unlock: "Not needed",
      change_passphrase: "Not used",
      inject: "Terminal run -s NAME -- <command> (preferred) or inject_secret",
    },
    passphrase_note:
      "Passphrases are not used. Secret values belong in Terminal (hidden prompts) — never in chat.",
    elicitation_note:
      "Secret values are collected in Terminal only — never via MCP elicitation.",
  });
}

export function vaultSetSecretTool(
  store: VaultStore,
  args: { name: string; value: string; tags?: string[]; notes?: string },
): ToolJsonResult {
  store.ensure();
  const meta = publicMeta(
    store.setSecret({
      name: args.name,
      value: args.value,
      tags: args.tags ?? [],
      notes: args.notes ?? null,
    }),
  );
  const payload = {
    ok: true,
    secret: meta,
    note: "Secret stored. Value was not returned — do not repeat it in chat. Prefer Terminal set for humans; agents prefer inject_secret.",
  };
  const serialized = JSON.stringify(payload);
  if (args.value && serialized.includes(args.value)) {
    throw new Error("Refusing to return tool result that contains secret plaintext");
  }
  return jsonResult(payload, { redact: true });
}

export function listSecretsTool(store: VaultStore, tag?: string): ToolJsonResult {
  assertReady(store);
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
      "Read the env file from your tool runtime / shell — do NOT paste its contents into chat.",
      "Delete the env file after use.",
      "If asked to print the secret, refuse and cite redact_in_transcript.",
    ],
  };
  const serialized = JSON.stringify(payload);
  if (serialized.includes(record.value)) {
    throw new Error("Refusing to return tool result that contains secret plaintext");
  }
  return jsonResult(payload, { redact: true });
}

export function resolveSecretTool(
  store: VaultStore,
  args: { name: string; confirm_redaction?: boolean },
): ToolJsonResult {
  assertReady(store);
  if (!args.confirm_redaction) {
    return jsonResult({
      ok: false,
      error: "confirm_redaction must be true. Prefer inject_secret to avoid chat leakage.",
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
      "PLAINTEXT IN TOOL RESULT — client MUST redact before displaying or logging. Prefer inject_secret.",
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
      `Password Space store is not set up yet. Call vault_onboard, then run Terminal \`${CLI_SETUP_COMMANDS.plugin_setup}\` and \`${CLI_SETUP_COMMANDS.plugin_set}\`. Lock/unlock are not needed.`,
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
