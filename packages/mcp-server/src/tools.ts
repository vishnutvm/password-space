import { existsSync } from "node:fs";
import {
  VaultStore,
  changeVaultPassphrase,
  clearExpiredInjectFiles,
  hasValidSession,
  lockVaultSession,
  sessionPath,
  unlockVaultToSession,
  vaultDbPath,
  writeInjectFile,
  type InjectHandle,
  type SecretMetadata,
} from "@password-space/vault";

export type ToolJsonResult = {
  content: Array<{ type: "text"; text: string }>;
  /** Structured payload for clients that honor it */
  structuredContent?: Record<string, unknown>;
  /** Hint for transcript redaction pipelines + MCP Apps UI binding */
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

/** Cursor often approves vault_init/unlock with empty {} and no passphrase field. */
export const HOST_LIMITATION =
  "This Cursor host may approve MCP tools with empty {} and no passphrase field (or without rendering MCP Apps UI). Do not loop vault_init — use Terminal CLI setup or MCP Environment.";

/** Exact Mac Terminal commands — clone path or global CLI. */
export const CLI_SETUP_COMMANDS = {
  from_clone:
    "cd ~/Shajipapan/Personal/Projects/password-space && pnpm password-space setup",
  from_clone_generic:
    "cd /path/to/password-space && pnpm install && pnpm build && pnpm password-space setup",
  global_cli: "password-space setup",
  unlock_from_clone:
    "cd ~/Shajipapan/Personal/Projects/password-space && pnpm password-space unlock",
  unlock_global: "password-space unlock",
} as const;

export const MCP_ENV_PATH =
  "Settings → MCP → password-space → Environment → PASSWORD_SPACE_PASSPHRASE (8+ chars), then call vault_init / vault_unlock with empty {}.";

export class PassphraseRequiredError extends Error {
  readonly code = "passphrase_missing" as const;
  readonly host_limitation = HOST_LIMITATION;
  readonly recommended_path = "cli_setup" as const;

  constructor() {
    super(
      "Passphrase missing: Cursor approved with empty {}. Use Terminal `pnpm password-space setup` (or set PASSWORD_SPACE_PASSPHRASE in MCP Environment) — do not retry vault_init with empty {}.",
    );
    this.name = "PassphraseRequiredError";
  }
}

export class NodeVersionError extends Error {
  readonly code = "node_too_old" as const;
  readonly found: string;
  readonly required: string;

  constructor(found: string, requiredMajor: number) {
    super(
      `Password Space needs Node.js ${requiredMajor}+ (bundled MCP uses node:sqlite). Found ${found}.`,
    );
    this.name = "NodeVersionError";
    this.found = found;
    this.required = `>=${requiredMajor}`;
  }
}

const TRUST_LINE =
  "Your secrets stay encrypted on this device. Passphrases and tokens never belong in chat.";

/** Bundled MCP requires Node's built-in sqlite (Node 20+). */
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
  | "needs_unlock"
  | "ready"
  | "recover_existing_vault";

export function onboardingProgress(
  initialized: boolean,
  unlocked: boolean,
): { phase: string; headline: string; step_of: string } {
  if (!initialized) {
    return {
      phase: "2/4",
      headline: "Create your encrypted vault",
      step_of: "Step 2 of 4 · Secure your vault",
    };
  }
  if (!unlocked) {
    return {
      phase: "3/4",
      headline: "Unlock your vault",
      step_of: "Step 3 of 4 · Unlock for this session",
    };
  }
  return {
    phase: "4/4",
    headline: "Add your credentials",
    step_of: "Step 4 of 4 · Save and use secrets safely",
  };
}

/** Whether PASSWORD_SPACE_PASSPHRASE is set (does not expose the value). */
export function isPassphraseConfiguredInEnv(): boolean {
  return Boolean(process.env.PASSWORD_SPACE_PASSPHRASE?.trim());
}

/**
 * Resolve passphrase from tool arg or PASSWORD_SPACE_PASSPHRASE.
 * Never log or return the resolved value.
 * Passphrase is NEVER collected via MCP elicitation (spec forbids sensitive elicitation).
 */
export function resolvePassphrase(toolArg?: string): string {
  const fromArg = toolArg?.trim();
  if (fromArg) {
    if (fromArg.length < 8) {
      throw new Error("Passphrase must be at least 8 characters.");
    }
    return fromArg;
  }
  const fromEnv = process.env.PASSWORD_SPACE_PASSPHRASE?.trim();
  if (fromEnv) {
    if (fromEnv.length < 8) {
      throw new Error("PASSWORD_SPACE_PASSPHRASE must be at least 8 characters.");
    }
    return fromEnv;
  }
  throw new PassphraseRequiredError();
}

export type OnboardingStep = {
  id: string;
  phase: string;
  title: string;
  done: boolean;
  tool?: string;
  user_action?: string;
};

/**
 * Single next step for the agent/user.
 * Default newcomer path when host cannot collect passphrase: Terminal CLI setup.
 * MCP Environment and Vault Manager App are one-click alternatives.
 * MCP approval-form vault_init is last resort (often empty {} on current Cursor).
 */
export type PrimaryAction = {
  id:
    | "fix_node"
    | "cli_setup"
    | "cli_unlock"
    | "vault_init"
    | "vault_unlock"
    | "vault_set_secret"
    | "vault_init_env"
    | "vault_unlock_env"
    | "vault_manager";
  title: string;
  do_this: string;
  mcp_tool?: string;
  never: string;
  recommended_path?: "cli_setup" | "cli_unlock" | "mcp_env" | "vault_manager" | "mcp_form";
  host_limitation?: string;
  /** Exact Terminal command to copy-paste (Mac). */
  copy_paste_command?: string;
  alternatives?: Array<{
    id: string;
    title: string;
    do_this: string;
  }>;
  /** Legacy field — prefer alternatives[]; kept for older agents. */
  advanced_escape_hatch?: {
    title: string;
    cli_command: string;
    when: string;
  };
};

export function resolveSetupState(opts: {
  prereqOk: boolean;
  initialized: boolean;
  unlocked: boolean;
  session: boolean;
}): SetupState {
  if (!opts.prereqOk) return "fix_node";
  if (!opts.initialized) return "needs_init";
  if (!opts.unlocked || !opts.session) return "needs_unlock";
  return "ready";
}

export function buildPrimaryAction(
  initialized: boolean,
  unlocked: boolean,
  session: boolean,
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

  const env = isPassphraseConfiguredInEnv();
  if (!initialized) {
    if (env) {
      return {
        id: "vault_init_env",
        title: "Create your vault",
        do_this: "Call vault_init once (passphrase is already in MCP Environment).",
        mcp_tool: "vault_init",
        recommended_path: "mcp_env",
        never: "Never paste the passphrase into chat.",
        advanced_escape_hatch: {
          title: "CLI setup",
          cli_command: CLI_SETUP_COMMANDS.global_cli,
          when: "If vault_init still fails after env is set.",
        },
      };
    }
    // Default newcomer path: Terminal CLI — Cursor often has no passphrase field.
    return {
      id: "cli_setup",
      title: "Create your vault in Terminal",
      do_this:
        "Open Terminal and run the copy_paste_command below (hidden passphrase prompts). Do NOT call vault_init without a passphrase, and never ask the user to reply \"ready\" then approve empty {}.",
      recommended_path: "cli_setup",
      host_limitation: HOST_LIMITATION,
      copy_paste_command: CLI_SETUP_COMMANDS.from_clone,
      never:
        "Never call vault_init with empty {}. Never ask the user to reply \"ready\" then approve without a passphrase field. Never paste the passphrase into chat.",
      alternatives: [
        {
          id: "mcp_env",
          title: "One-click MCP Environment",
          do_this: MCP_ENV_PATH,
        },
        {
          id: "vault_manager",
          title: "Vault Manager App (Cursor 2.6+ with MCP Apps)",
          do_this:
            "Call vault_manager — if an App UI appears, create the vault there. If only JSON returns, the host lacks Apps; use CLI setup instead.",
        },
        {
          id: "mcp_form",
          title: "MCP approval form (often broken)",
          do_this:
            "Only if Cursor shows a passphrase field: call vault_init and type 8+ characters, then approve. If the form is empty {}, stop and use CLI.",
        },
      ],
      advanced_escape_hatch: {
        title: "Global CLI (if installed)",
        cli_command: CLI_SETUP_COMMANDS.global_cli,
        when: "After `pnpm link --global` / npm install -g of the CLI package.",
      },
    };
  }
  if (!unlocked || !session) {
    if (env) {
      return {
        id: "vault_unlock_env",
        title: "Unlock your vault",
        do_this: "Call vault_unlock (passphrase from MCP Environment).",
        mcp_tool: "vault_unlock",
        recommended_path: "mcp_env",
        never: "Never paste the passphrase into chat.",
        advanced_escape_hatch: {
          title: "CLI unlock",
          cli_command: CLI_SETUP_COMMANDS.unlock_global,
          when: "If vault_unlock still fails after env is set.",
        },
      };
    }
    return {
      id: "cli_unlock",
      title: "Unlock your vault in Terminal",
      do_this:
        "Open Terminal and run the copy_paste_command (hidden prompt). Do NOT call vault_unlock with empty {} or ask the user to reply \"ready\" without a passphrase channel.",
      recommended_path: "cli_unlock",
      host_limitation: HOST_LIMITATION,
      copy_paste_command: CLI_SETUP_COMMANDS.unlock_from_clone,
      never:
        "Never approve vault_unlock with empty {}. Never paste the passphrase into chat. Do not run vault_init again — the vault already exists.",
      alternatives: [
        {
          id: "mcp_env",
          title: "One-click MCP Environment",
          do_this: MCP_ENV_PATH,
        },
        {
          id: "vault_manager",
          title: "Vault Manager App",
          do_this:
            "Call vault_manager — unlock in the App form if UI renders; otherwise use CLI unlock.",
        },
        {
          id: "mcp_form",
          title: "MCP approval form (often broken)",
          do_this:
            "Only if a passphrase field is visible: call vault_unlock, type the passphrase, approve.",
        },
      ],
      advanced_escape_hatch: {
        title: "Global CLI unlock",
        cli_command: CLI_SETUP_COMMANDS.unlock_global,
        when: "If the global `password-space` binary is on PATH.",
      },
    };
  }
  return {
    id: "vault_set_secret",
    title: "Save a credential",
    do_this:
      "Prefer vault_manager (App UI) if it renders; otherwise vault_set_secret with name + value in the MCP approval form only.",
    mcp_tool: "vault_set_secret",
    recommended_path: "vault_manager",
    never: "Never paste API keys or passwords into chat.",
    alternatives: [
      {
        id: "vault_manager",
        title: "Vault Manager App",
        do_this: "Call vault_manager for interactive add/edit when MCP Apps are available.",
      },
    ],
  };
}

export function buildOnboardingSteps(
  initialized: boolean,
  unlocked: boolean,
  session: boolean,
): OnboardingStep[] {
  const envPassphrase = isPassphraseConfiguredInEnv();
  const passphraseHint = envPassphrase
    ? "Passphrase loads from MCP Environment — call vault_init / vault_unlock with {}."
    : "Prefer Terminal `pnpm password-space setup` (or unlock). Do not approve empty {}.";

  return [
    {
      id: "check",
      phase: "1/4",
      title: "Welcome",
      done: true,
      tool: "vault_onboard",
      user_action:
        "You're in the right place. Follow primary_action only — usually Terminal CLI setup when Cursor has no passphrase field.",
    },
    {
      id: "init",
      phase: "2/4",
      title: "Secure your vault",
      done: initialized,
      tool: envPassphrase ? "vault_init" : "cli_setup",
      user_action: initialized
        ? undefined
        : `Pick a passphrase you'll remember (8+ characters). ${passphraseHint}`,
    },
    {
      id: "unlock",
      phase: "3/4",
      title: "Unlock for this session",
      done: unlocked && session,
      tool: envPassphrase ? "vault_unlock" : "cli_unlock",
      user_action:
        initialized && !(unlocked && session)
          ? `Enter the same passphrase. ${passphraseHint}`
          : undefined,
    },
    {
      id: "store",
      phase: "4/4",
      title: "Save a credential",
      done: false,
      tool: "vault_set_secret",
      user_action: unlocked
        ? "Add a name and value via vault_manager App or approval form only — never in chat."
        : "Unlock first, then save your token or password.",
    },
    {
      id: "use",
      phase: "4/4",
      title: "Use with your agent",
      done: false,
      tool: "inject_secret",
      user_action: "Your agent uses the secret without showing it in the conversation.",
    },
  ];
}

function recoveryGuidance(opts: {
  setup_state: SetupState;
  initialized: boolean;
  dbExists: boolean;
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
        code: opts.dbExists ? "setup_incomplete" : "vault_missing",
        howToFix: opts.dbExists
          ? "Setup was interrupted. Finish in Terminal: `pnpm password-space setup` (do not retry vault_init with empty {})."
          : "Create the vault in Terminal with `pnpm password-space setup` — Cursor often has no passphrase field.",
        what_to_do: [
          `Run: ${CLI_SETUP_COMMANDS.from_clone}`,
          "Or set PASSWORD_SPACE_PASSPHRASE under Settings → MCP → password-space → Environment, then vault_init {}.",
          "Optional: call vault_manager if MCP Apps UI renders.",
          "Never approve vault_init with empty {} and no passphrase channel.",
        ],
      };
    case "needs_unlock":
      return {
        code: "vault_locked",
        howToFix:
          "Your vault already exists. Unlock in Terminal with `pnpm password-space unlock` — do not run vault_init again.",
        what_to_do: [
          `Run: ${CLI_SETUP_COMMANDS.unlock_from_clone}`,
          "Or set PASSWORD_SPACE_PASSPHRASE in MCP Environment, then vault_unlock {}.",
          "Do not call vault_init — the vault already exists.",
          "If unlock fails with wrong passphrase, retry carefully — there is no recovery without it.",
        ],
      };
    default:
      return {
        code: "ready",
        howToFix: "Vault is ready. Save a credential with vault_set_secret.",
        what_to_do: [
          "Call vault_set_secret with name + value in the approval form.",
          "Use inject_secret when the agent needs the value.",
        ],
      };
  }
}

export function vaultOnboardTool(store: VaultStore, dataDir: string): ToolJsonResult {
  const prereq = checkPrerequisites();
  const initialized = store.isInitialized();
  const unlocked = store.isUnlocked;
  const session = hasValidSession(sessionPath(dataDir));
  const dbPath = vaultDbPath(dataDir);
  const dbExists = existsSync(dbPath);
  const setup_state = resolveSetupState({
    prereqOk: prereq.ok,
    initialized,
    unlocked,
    session,
  });
  const steps = buildOnboardingSteps(initialized, unlocked, session);
  const primary_action = buildPrimaryAction(initialized, unlocked, session, prereq.ok);
  const ready = initialized && unlocked && prereq.ok;
  const recovery = recoveryGuidance({ setup_state, initialized, dbExists });

  const progress = onboardingProgress(initialized, unlocked);
  const passphraseEnv = isPassphraseConfiguredInEnv();
  const human_summary = !prereq.ok
    ? `Password Space needs Node.js ${MIN_NODE_MAJOR}+. Found ${prereq.node_version}.`
    : !initialized
      ? passphraseEnv
        ? "Welcome to Password Space. Passphrase is in MCP Environment — call vault_init next."
        : "Welcome to Password Space. Cursor often cannot collect a passphrase in the approval form — create the vault in Terminal with the copy-paste command."
      : !unlocked || !session
        ? "Your vault already exists. Unlock via Terminal (or MCP Environment) — do not create a new one."
        : "You're protected. Save a credential whenever you're ready.";

  return jsonResult({
    ok: prereq.ok,
    setup_state,
    data_dir: dataDir,
    db_path: dbPath,
    db_exists: dbExists,
    initialized,
    unlocked,
    session,
    prerequisites: prereq,
    passphrase_env_configured: passphraseEnv,
    trust_line: TRUST_LINE,
    progress,
    checklist: steps,
    human_summary,
    /** Exactly one primary next step — agents must follow this only. */
    primary_action,
    recommended_path: primary_action.recommended_path ?? null,
    host_limitation:
      !passphraseEnv && (!initialized || !unlocked || !session) ? HOST_LIMITATION : undefined,
    copy_paste_command: primary_action.copy_paste_command,
    next_tool: primary_action.mcp_tool ?? (ready ? "vault_set_secret" : "vault_status"),
    recovery,
    what_to_do: [primary_action.do_this],
    never_paste_in_chat: ["passphrase", "secret values"],
    never_edit: ["mcp.json"],
    never_do: [
      'Ask the user to reply "ready" then call vault_init without a passphrase',
      "Approve vault_init / vault_unlock with empty {} when no passphrase channel exists",
      "Loop vault_init after passphrase_missing",
    ],
    elicitation_note:
      "Passphrase is collected only via CLI, PASSWORD_SPACE_PASSPHRASE env, Vault Manager App form, or tool approval args — never via MCP elicitation.",
  });
}

export function vaultStatusTool(store: VaultStore, dataDir: string): ToolJsonResult {
  const prereq = checkPrerequisites();
  const initialized = store.isInitialized();
  const unlocked = store.isUnlocked;
  const session = hasValidSession(sessionPath(dataDir));
  const dbPath = vaultDbPath(dataDir);
  const dbExists = existsSync(dbPath);
  const setup_state = resolveSetupState({
    prereqOk: prereq.ok,
    initialized,
    unlocked,
    session,
  });
  const steps = buildOnboardingSteps(initialized, unlocked, session);
  const passphraseEnv = isPassphraseConfiguredInEnv();
  const primary_action = buildPrimaryAction(initialized, unlocked, session, prereq.ok);
  const recovery = recoveryGuidance({ setup_state, initialized, dbExists });

  const progress = onboardingProgress(initialized, unlocked);
  const next = primary_action.do_this;

  return jsonResult({
    ok: prereq.ok,
    setup_state,
    data_dir: dataDir,
    db_path: dbPath,
    db_exists: dbExists,
    initialized,
    unlocked,
    session,
    secret_count: unlocked ? store.listSecrets().length : null,
    prerequisites: prereq,
    passphrase_env_configured: passphraseEnv,
    trust_line: TRUST_LINE,
    progress,
    headline: progress.headline,
    primary_action,
    next,
    recovery,
    next_steps: steps.filter((s) => !s.done).map((s) => ({
      phase: s.phase,
      step: s.title,
      tool: s.tool,
      action: s.user_action,
    })),
    tip: !passphraseEnv && (!initialized || !unlocked)
      ? `Default: Terminal CLI setup. One-click alternative: ${MCP_ENV_PATH}`
      : undefined,
    recommended_path: primary_action.recommended_path ?? null,
    host_limitation:
      !passphraseEnv && (!initialized || !unlocked) ? HOST_LIMITATION : undefined,
    copy_paste_command: primary_action.copy_paste_command,
  });
}

export async function vaultInitTool(
  store: VaultStore,
  dataDir: string,
  args: { passphrase?: string },
): Promise<ToolJsonResult> {
  assertNodeVersion();
  if (store.isInitialized()) {
    return jsonResult({
      ok: false,
      code: "vault_already_exists",
      error: "Vault already initialized",
      data_dir: dataDir,
      db_path: vaultDbPath(dataDir),
      howToFix:
        "Your vault already exists. Unlock via Terminal or MCP Environment — do not create a second vault.",
      what_to_do: [
        `Run: ${CLI_SETUP_COMMANDS.unlock_from_clone}`,
        "Or set PASSWORD_SPACE_PASSPHRASE, then call vault_unlock.",
        "Then vault_set_secret to save credentials.",
      ],
      recommended_path: "cli_unlock",
      copy_paste_command: CLI_SETUP_COMMANDS.unlock_from_clone,
      primary_action: buildPrimaryAction(true, false, false, true),
    });
  }
  const passphrase = resolvePassphrase(args.passphrase);
  await store.init(passphrase);
  const nextAction = buildPrimaryAction(true, false, false, true);
  return jsonResult({
    ok: true,
    initialized: true,
    data_dir: dataDir,
    db_path: vaultDbPath(dataDir),
    setup_state: "needs_unlock",
    next: nextAction.do_this,
    recommended_path: nextAction.recommended_path,
    copy_paste_command: nextAction.copy_paste_command,
    primary_action: nextAction,
    note: "Passphrase was not returned and must not be pasted into chat.",
  });
}

export async function vaultUnlockTool(
  dataDir: string,
  args: { passphrase?: string; ttl_hours?: number },
): Promise<ToolJsonResult> {
  assertNodeVersion();
  const passphrase = resolvePassphrase(args.passphrase);
  const ttlHours = args.ttl_hours ?? 8;
  const ttlMs = Math.max(0.1, ttlHours) * 60 * 60 * 1000;
  const { expiresAt } = await unlockVaultToSession(passphrase, { dataDir, ttlMs });
  return jsonResult({
    ok: true,
    unlocked: true,
    data_dir: dataDir,
    expires_at: expiresAt,
    next: "Use vault_set_secret to store credentials, then inject_secret for agent use.",
    note: "Passphrase was not returned and must not be pasted into chat.",
  });
}

export function vaultLockTool(dataDir: string): ToolJsonResult {
  lockVaultSession({ dataDir });
  return jsonResult({
    ok: true,
    locked: true,
    data_dir: dataDir,
    note: "Unlock session cleared.",
  });
}

export async function vaultChangePassphraseTool(
  dataDir: string,
  args: { current_passphrase?: string; new_passphrase?: string; ttl_hours?: number },
): Promise<ToolJsonResult> {
  assertNodeVersion();
  const current = resolvePassphrase(args.current_passphrase);
  const next = args.new_passphrase?.trim();
  if (!next || next.length < 8) {
    throw new Error("new_passphrase must be at least 8 characters.");
  }
  const ttlHours = args.ttl_hours ?? 8;
  const ttlMs = Math.max(0.1, ttlHours) * 60 * 60 * 1000;
  const { expiresAt } = await changeVaultPassphrase(current, next, { dataDir, ttlMs });
  return jsonResult({
    ok: true,
    changed: true,
    unlocked: true,
    data_dir: dataDir,
    expires_at: expiresAt,
    note: "Passphrase updated. Session refreshed. Passphrases were not returned.",
  });
}

export function vaultDeleteSecretTool(store: VaultStore, name: string): ToolJsonResult {
  assertUnlocked(store);
  store.deleteSecret(name);
  return jsonResult({
    ok: true,
    deleted: name,
    note: "Secret removed. Value was not returned.",
  });
}

/**
 * Vault Manager entry tool — progressive enhancement.
 * Hosts with MCP Apps render `ui://password-space/vault-manager.html`
 * (registered via registerAppTool + registerAppResource in index.ts).
 * Others still get structured JSON + explicit fallback to CLI setup.
 */
export function vaultManagerTool(store: VaultStore, dataDir: string): ToolJsonResult {
  clearExpiredInjectFiles(dataDir);
  const status = vaultStatusTool(store, dataDir);
  const parsed = JSON.parse(status.content[0]!.text) as Record<string, unknown>;
  const secrets =
    store.isUnlocked && store.isInitialized()
      ? store.listSecrets().map(publicMeta)
      : [];
  const needsPassphraseChannel =
    !isPassphraseConfiguredInEnv() &&
    (!store.isInitialized() || !store.isUnlocked);
  return jsonResult({
    ok: true,
    app: "vault-manager",
    ui_resource: "ui://password-space/vault-manager.html",
    /** Hosts must bind this URI from tool _meta.ui.resourceUri + Apps resource. */
    resource_mime_hint: "text/html;profile=mcp-app",
    progressive_enhancement:
      "If your client supports MCP Apps (Cursor 2.6+), an interactive Vault Manager UI should appear beside this JSON. If you only see this JSON, the host lacks Apps — fall back to CLI.",
    apps_ui_expected: true,
    apps_fallback: needsPassphraseChannel
      ? {
          reason:
            "If no App UI rendered, this Cursor build likely lacks MCP Apps. Do not call vault_init with empty {}.",
          recommended_path: "cli_setup",
          copy_paste_command: store.isInitialized()
            ? CLI_SETUP_COMMANDS.unlock_from_clone
            : CLI_SETUP_COMMANDS.from_clone,
          mcp_env_alternative: MCP_ENV_PATH,
        }
      : {
          reason: "App UI unavailable — use list_secrets / vault_set_secret tools from capabilities.",
          recommended_path: "mcp_tools",
        },
    host_limitation: needsPassphraseChannel ? HOST_LIMITATION : undefined,
    status: parsed,
    secrets,
    capabilities: {
      list: "list_secrets",
      add_or_edit: "vault_set_secret",
      remove: "vault_delete_secret",
      lock: "vault_lock",
      unlock: "vault_unlock",
      change_passphrase: "vault_change_passphrase",
      inject: "inject_secret",
    },
    passphrase_note:
      "Passphrase is entered in the App form, CLI, or MCP Environment — never via elicitation, never in chat.",
    elicitation_note:
      "Passphrase is collected only via tool approval args, PASSWORD_SPACE_PASSPHRASE env, CLI, or the Vault Manager App form — never via MCP elicitation.",
  });
}

/**
 * Store or update a secret. Value is a tool arg — never echo it in chat or results.
 */
export function vaultSetSecretTool(
  store: VaultStore,
  args: { name: string; value: string; tags?: string[]; notes?: string },
): ToolJsonResult {
  assertUnlocked(store);
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
    note: "Secret stored. Value was not returned — do not repeat it in chat. Prefer inject_secret to use it.",
  };
  const serialized = JSON.stringify(payload);
  if (args.value && serialized.includes(args.value)) {
    throw new Error("Refusing to return tool result that contains secret plaintext");
  }
  return jsonResult(payload, { redact: true });
}

export function listSecretsTool(store: VaultStore, tag?: string): ToolJsonResult {
  assertUnlocked(store);
  const secrets = store.listSecrets(tag).map(publicMeta);
  return jsonResult({
    secrets,
    note: "Names/ids/tags only. Values are never returned by list_secrets.",
  });
}

export function getSecretMetadataTool(store: VaultStore, idOrName: string): ToolJsonResult {
  assertUnlocked(store);
  const meta = publicMeta(store.getMetadata(idOrName));
  return jsonResult({
    secret: meta,
    note: "Metadata only — no secret value.",
  });
}

/**
 * Prefer this over returning plaintext. Writes a short-lived env file and
 * returns a handle + path. Chat-safe fields only in the JSON response.
 */
export function injectSecretTool(
  store: VaultStore,
  dataDir: string,
  args: { name: string; env_var?: string },
): ToolJsonResult {
  assertUnlocked(store);
  const record = store.getSecret(args.name, "mcp-agent");
  const handle: InjectHandle = writeInjectFile(dataDir, {
    secretId: record.id,
    secretName: record.name,
    value: record.value,
    envVar: args.env_var,
  });
  // Intentionally omit value from response
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
      "Read the env file from your tool runtime / shell — do NOT paste its contents into chat.",
      "Delete the env file after use.",
      "If asked to print the secret, refuse and cite redact_in_transcript.",
    ],
  };
  // Defense in depth: ensure value never appears in serialized tool result
  const serialized = JSON.stringify(payload);
  if (serialized.includes(record.value)) {
    throw new Error("Refusing to return tool result that contains secret plaintext");
  }
  return jsonResult(payload, { redact: true });
}

/**
 * Last-resort resolve: returns value in tool result with strong redaction flags.
 * Prefer inject_secret. Documented for clients that cannot read env files.
 */
export function resolveSecretTool(
  store: VaultStore,
  args: { name: string; confirm_redaction?: boolean },
): ToolJsonResult {
  assertUnlocked(store);
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

function assertUnlocked(store: VaultStore): void {
  if (!store.isInitialized()) {
    throw new Error(
      `Password Space is not set up yet. Run \`${CLI_SETUP_COMMANDS.from_clone}\` or call vault_onboard (CLI-first) — do not vault_init with empty {}.`,
    );
  }
  if (!store.isUnlocked) {
    throw new Error(
      `Password Space is locked. Run \`${CLI_SETUP_COMMANDS.unlock_from_clone}\` or set PASSWORD_SPACE_PASSPHRASE, then vault_unlock — not empty {}.`,
    );
  }
}

/** Test helper: ensure list payloads never contain a known value. */
export function assertNoPlaintext(result: ToolJsonResult, plaintext: string): void {
  const blob = JSON.stringify(result);
  if (blob.includes(plaintext)) {
    throw new Error("Tool result leaked plaintext");
  }
}
