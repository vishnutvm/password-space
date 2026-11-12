import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

/** Bundled CLI path inside the marketplace plugin package (next to MCP `dist/index.js`). */
export const BUNDLED_CLI_RELATIVE = "dist/cli.js";

/**
 * Portable Terminal form after marketplace install + Reload.
 * Cursor expands CURSOR_PLUGIN_ROOT for MCP; agents should prefer the absolute
 * path from `bundledCliCommand()` when the MCP process can resolve `cli.js`.
 */
export const BUNDLED_CLI_NODE =
  `node "\${CURSOR_PLUGIN_ROOT}/${BUNDLED_CLI_RELATIVE}"` as const;

/**
 * Exact Terminal commands — primary create / unlock / add path.
 * No repo clone required: CLI ships in the plugin at `dist/cli.js`.
 */
export const CLI_SETUP_COMMANDS = {
  /** Preferred after plugin install (no clone). */
  plugin_setup: `${BUNDLED_CLI_NODE} setup`,
  plugin_unlock: `${BUNDLED_CLI_NODE} unlock`,
  plugin_set: `${BUNDLED_CLI_NODE} set`,
  /** Optional: contributors developing from a clone. */
  from_clone_optional:
    "cd /path/to/password-space && pnpm install && pnpm build && pnpm password-space setup",
  unlock_from_clone_optional:
    "cd /path/to/password-space && pnpm password-space unlock",
  set_from_clone_optional:
    "cd /path/to/password-space && pnpm password-space set",
  global_cli: "password-space setup",
  unlock_global: "password-space unlock",
  set_global: "password-space set",
} as const;

/**
 * Absolute path to bundled `cli.js` when the MCP server is the marketplace
 * bundle (`…/plugins/password-space/dist/index.js`) or CURSOR_PLUGIN_ROOT is set.
 */
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
  // Double-quote for Terminal paste; escape embedded quotes/backslashes only.
  return `"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Terminal command for setup | unlock | set using the plugin-bundled CLI.
 * Prefers an absolute path (paste-ready in Terminal); falls back to
 * `node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" …`.
 */
export function bundledCliCommand(
  subcommand: "setup" | "unlock" | "set" | string = "",
): string {
  const abs = resolveBundledCliPath();
  const base = abs ? `node ${shellQuote(abs)}` : BUNDLED_CLI_NODE;
  const sub = subcommand.trim();
  return sub ? `${base} ${sub}` : base;
}

export const MCP_ENV_PATH =
  "Settings → MCP → password-space → Environment → PASSWORD_SPACE_PASSPHRASE (8+ chars), then call vault_init / vault_unlock with empty {}.";

export class PassphraseRequiredError extends Error {
  readonly code = "passphrase_missing" as const;
  readonly host_limitation = HOST_LIMITATION;
  readonly recommended_path = "cli_setup" as const;

  constructor() {
    super(
      `Passphrase missing: Cursor approved with empty {}. Use Terminal \`${CLI_SETUP_COMMANDS.plugin_setup}\` (or set PASSWORD_SPACE_PASSPHRASE in MCP Environment) — do not retry vault_init with empty {}.`,
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
 * Default path: interactive Terminal CLI for create / unlock / add / remove / lock.
 * Optional: MCP Environment passphrase for scripts. Do not guide users to App forms.
 */
export type PrimaryAction = {
  id:
    | "fix_node"
    | "cli_setup"
    | "cli_unlock"
    | "cli_set"
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
  recommended_path?:
    | "cli_setup"
    | "cli_unlock"
    | "cli_set"
    | "mcp_env"
    | "vault_manager"
    | "mcp_form";
  host_limitation?: string;
  /** Exact Terminal command to copy-paste (Mac). */
  copy_paste_command?: string;
  alternatives?: Array<{
    id: string;
    title: string;
    do_this: string;
  }>;
  /** Secondary path (e.g. global CLI binary). */
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
          title: "Plugin Terminal CLI",
          cli_command: bundledCliCommand("setup"),
          when: "If vault_init still fails after env is set.",
        },
      };
    }
    // Default path: Terminal CLI — Cursor often has no passphrase field.
    return {
      id: "cli_setup",
      title: "Create your vault in Terminal",
      do_this:
        "Open Terminal and run the copy_paste_command below (hidden passphrase prompts). No repo clone needed — the CLI is bundled in the plugin. Do NOT call vault_init without a passphrase, and never ask the user to reply \"ready\" then approve empty {}.",
      recommended_path: "cli_setup",
      host_limitation: HOST_LIMITATION,
      copy_paste_command: bundledCliCommand("setup"),
      never:
        "Never call vault_init with empty {}. Never ask the user to reply \"ready\" then approve without a passphrase field. Never paste the passphrase into chat. Never collect passphrase or secret values in App forms or MCP approval forms when Terminal is available.",
      alternatives: [
        {
          id: "mcp_env",
          title: "One-click MCP Environment",
          do_this: MCP_ENV_PATH,
        },
      ],
      advanced_escape_hatch: {
        title: "Contributor clone (optional)",
        cli_command: CLI_SETUP_COMMANDS.from_clone_optional,
        when: "Only if developing Password Space from a git clone — not required for external users.",
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
          title: "Plugin Terminal unlock",
          cli_command: bundledCliCommand("unlock"),
          when: "If vault_unlock still fails after env is set.",
        },
      };
    }
    return {
      id: "cli_unlock",
      title: "Unlock your vault in Terminal",
      do_this:
        "Open Terminal and run the copy_paste_command (hidden prompt + session duration: 1 day / 1 week / until lock). No clone needed. Do NOT call vault_unlock with empty {} or ask the user to reply \"ready\" without a passphrase channel.",
      recommended_path: "cli_unlock",
      host_limitation: HOST_LIMITATION,
      copy_paste_command: bundledCliCommand("unlock"),
      never:
        "Never approve vault_unlock with empty {}. Never paste the passphrase into chat. Do not run vault_init again — the vault already exists.",
      alternatives: [
        {
          id: "mcp_env",
          title: "One-click MCP Environment",
          do_this: MCP_ENV_PATH,
        },
      ],
      advanced_escape_hatch: {
        title: "Contributor clone unlock (optional)",
        cli_command: CLI_SETUP_COMMANDS.unlock_from_clone_optional,
        when: "Only when developing from a git clone.",
      },
    };
  }
  return {
    id: "cli_set",
    title: "Add a credential in Terminal",
    do_this:
      "Open Terminal and run the copy_paste_command (or bare cli.js for the interactive menu). Type the secret name, then the value at the hidden prompt. Never paste name/value in chat.",
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
        do_this: `Run ${bundledCliCommand("")} (no subcommand) for setup / unlock / add / remove / lock / status.`,
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
  unlocked: boolean,
  session: boolean,
): OnboardingStep[] {
  const envPassphrase = isPassphraseConfiguredInEnv();
  const passphraseHint = envPassphrase
    ? "Passphrase loads from MCP Environment — call vault_init / vault_unlock with {}."
    : `Prefer Terminal \`${CLI_SETUP_COMMANDS.plugin_setup}\` (or unlock). Do not approve empty {}.`;

  return [
    {
      id: "check",
      phase: "1/4",
      title: "Welcome",
      done: true,
      tool: "vault_onboard",
      user_action:
        "You're in the right place. Follow primary_action only — Terminal for create, unlock, and add (plugin-bundled CLI; no clone).",
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
      tool: "cli_set",
      user_action: unlocked
        ? `In Terminal run \`${CLI_SETUP_COMMANDS.plugin_set}\` — type name, then hidden value. Never in chat.`
        : "Unlock first, then save your token or password in Terminal.",
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
          ? `Setup was interrupted. Finish in Terminal: \`${CLI_SETUP_COMMANDS.plugin_setup}\` (do not retry vault_init with empty {}).`
          : `Create the vault in Terminal with \`${CLI_SETUP_COMMANDS.plugin_setup}\` — no clone; Cursor often has no passphrase field.`,
        what_to_do: [
          `Run: ${bundledCliCommand("setup")}`,
          "Or set PASSWORD_SPACE_PASSPHRASE under Settings → MCP → password-space → Environment, then vault_init {}.",
          "Never approve vault_init with empty {} and no passphrase channel.",
          "Do not use App forms for create/add — Terminal CLI only.",
        ],
      };
    case "needs_unlock":
      return {
        code: "vault_locked",
        howToFix: `Your vault already exists. Unlock in Terminal with \`${CLI_SETUP_COMMANDS.plugin_unlock}\` — do not run vault_init again.`,
        what_to_do: [
          `Run: ${bundledCliCommand("unlock")}`,
          "Or set PASSWORD_SPACE_PASSPHRASE in MCP Environment, then vault_unlock {}.",
          "Do not call vault_init — the vault already exists.",
          "If unlock fails with wrong passphrase, retry carefully — there is no recovery without it.",
        ],
      };
    default:
      return {
        code: "ready",
        howToFix: `Vault is ready. Add a credential in Terminal with \`${CLI_SETUP_COMMANDS.plugin_set}\`.`,
        what_to_do: [
          `Run: ${bundledCliCommand("set")}`,
          "Then list_secrets / inject_secret via MCP (no values in chat).",
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
        : "Welcome to Password Space. Next: open Terminal and run the setup command (hidden passphrase prompts)."
      : !unlocked || !session
        ? "Your vault already exists. Unlock in Terminal — do not create a new one."
        : "You're protected. Add a credential in Terminal whenever you're ready.";

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
      "Passphrase and secret values are collected in Terminal (hidden prompts), or optionally via PASSWORD_SPACE_PASSPHRASE env / tool approval args — never via MCP elicitation, never in chat.",
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
      ? `Default: plugin Terminal CLI (${bundledCliCommand("setup")} / unlock). Optional: ${MCP_ENV_PATH}`
      : !passphraseEnv && initialized && unlocked
        ? `Add secrets in Terminal: ${bundledCliCommand("set")}`
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
      howToFix: `Your vault already exists. Unlock in Terminal with \`${CLI_SETUP_COMMANDS.plugin_unlock}\` (or MCP Environment) — do not create a second vault.`,
      what_to_do: [
        `Run: ${bundledCliCommand("unlock")}`,
        "Or set PASSWORD_SPACE_PASSPHRASE, then call vault_unlock.",
        `Then add credentials with \`${CLI_SETUP_COMMANDS.plugin_set}\`.`,
      ],
      recommended_path: "cli_unlock",
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
  args: { passphrase?: string; ttl_hours?: number; until_lock?: boolean },
): Promise<ToolJsonResult> {
  assertNodeVersion();
  const passphrase = resolvePassphrase(args.passphrase);
  const ttlMs =
    args.until_lock === true
      ? null
      : Math.max(0.1, args.ttl_hours ?? 8) * 60 * 60 * 1000;
  const { expiresAt, untilLock } = await unlockVaultToSession(passphrase, {
    dataDir,
    ttlMs,
  });
  return jsonResult({
    ok: true,
    unlocked: true,
    data_dir: dataDir,
    expires_at: expiresAt,
    until_lock: untilLock,
    session_path: sessionPath(dataDir),
    next: "Prefer Terminal for add/remove. Agents: list_secrets / inject_secret. Lock via Terminal lock or vault_lock.",
    note: "Passphrase was not returned and must not be pasted into chat. Session lives under ~/.password-space/session (0600).",
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
  const ttlMs =
    args.ttl_hours === undefined
      ? undefined
      : Math.max(0.1, args.ttl_hours) * 60 * 60 * 1000;
  const { expiresAt, untilLock } = await changeVaultPassphrase(current, next, {
    dataDir,
    ttlMs,
  });
  return jsonResult({
    ok: true,
    changed: true,
    unlocked: true,
    data_dir: dataDir,
    expires_at: expiresAt,
    until_lock: untilLock,
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
 * Vault Manager — status-only JSON (+ optional Apps UI). Not a human setup path.
 * Agents must steer create / unlock / add / remove / lock to the Terminal CLI.
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
  const cliCommand = store.isInitialized()
    ? bundledCliCommand("unlock")
    : bundledCliCommand("setup");
  return jsonResult({
    ok: true,
    app: "vault-manager",
    mode: "status_only",
    ui_resource: "ui://password-space/vault-manager.html",
    resource_mime_hint: "text/html;profile=mcp-app",
    progressive_enhancement:
      "Status-only. Do not guide users to App forms for create/unlock/add. Human UX is the plugin Terminal CLI.",
    apps_ui_expected: false,
    agent_contract:
      "Do not call vault_manager for setup. Show Terminal copy_paste_command instead. Use list_secrets / inject_secret / vault_lock after unlock. Never paste App HTML/JS into chat.",
    apps_fallback: {
      reason:
        "Human setup/credential UX is Terminal-only. Run copy_paste_command (or bare cli.js for the menu). Do not use App forms.",
      recommended_path: needsPassphraseChannel
        ? store.isInitialized()
          ? "cli_unlock"
          : "cli_setup"
        : "cli_set",
      next_tool: needsPassphraseChannel
        ? store.isInitialized()
          ? "cli_unlock"
          : "cli_setup"
        : "cli_set",
      copy_paste_command: needsPassphraseChannel ? cliCommand : bundledCliCommand("set"),
      mcp_env_alternative: MCP_ENV_PATH,
      never: [
        "Guide users to Vault Manager / App forms for create, unlock, or add",
        "Paste vault-manager.html / minified JS into chat",
        "FetchMcpResource ui://password-space/vault-manager.html into the transcript",
        "Call vault_init with empty {}",
      ],
    },
    host_limitation: needsPassphraseChannel ? HOST_LIMITATION : undefined,
    status: parsed,
    secrets,
    capabilities: {
      list: "list_secrets (MCP) or Terminal list",
      add_or_edit: "Terminal set / interactive menu only",
      remove: "Terminal remove (or vault_delete_secret after unlock)",
      lock: "Terminal lock / vault_lock",
      unlock: "Terminal unlock (choose 1d / 1w / until-lock)",
      change_passphrase: "Terminal change-passphrase",
      inject: "inject_secret",
    },
    passphrase_note:
      "Passphrase and secret values belong in Terminal (hidden prompts), or optional PASSWORD_SPACE_PASSPHRASE env — never via elicitation, never in chat.",
    elicitation_note:
      "Passphrase is collected in Terminal or via tool approval args / PASSWORD_SPACE_PASSPHRASE env — never via MCP elicitation.",
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
      `Password Space is not set up yet. Call vault_onboard, then run Terminal \`${CLI_SETUP_COMMANDS.plugin_setup}\` (or vault_init with PASSWORD_SPACE_PASSPHRASE) — do not vault_init with empty {}.`,
    );
  }
  if (!store.isUnlocked) {
    throw new Error(
      `Password Space is locked. Run Terminal \`${CLI_SETUP_COMMANDS.plugin_unlock}\`, or set PASSWORD_SPACE_PASSPHRASE then vault_unlock — not empty {}.`,
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
