import {
  VaultStore,
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
  /** Hint for transcript redaction pipelines */
  _meta?: { redact_in_transcript?: boolean };
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

export class PassphraseRequiredError extends Error {
  readonly code = "passphrase_missing" as const;

  constructor() {
    super("This step needs your vault passphrase in the tool approval form.");
    this.name = "PassphraseRequiredError";
  }
}

const TRUST_LINE =
  "Your secrets stay encrypted on this device. Passphrases and tokens never belong in chat.";

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

export type PrimaryAction = {
  id: "cli_setup" | "vault_unlock" | "vault_set_secret" | "vault_init_env" | "vault_unlock_env";
  title: string;
  do_this: string;
  cli_command?: string;
  mcp_tool?: string;
  never: string;
  or_alternative?: string;
};

export function buildPrimaryAction(
  initialized: boolean,
  unlocked: boolean,
  session: boolean,
): PrimaryAction {
  const env = isPassphraseConfiguredInEnv();
  if (!initialized) {
    if (env) {
      return {
        id: "vault_init_env",
        title: "Create your vault",
        do_this: "Call vault_init once (passphrase is already in MCP Environment).",
        mcp_tool: "vault_init",
        never: "Never paste the passphrase into chat.",
      };
    }
    return {
      id: "cli_setup",
      title: "Create your vault",
      do_this:
        "Run in Terminal: password-space setup — one hidden passphrase prompt, then you're done for this step.",
      cli_command: "password-space setup",
      mcp_tool: "vault_init",
      never: "Never approve vault_init with an empty approval form {}.",
      or_alternative:
        "No Terminal? Call vault_init and type your passphrase in the MCP approval form only.",
    };
  }
  if (!unlocked || !session) {
    if (env) {
      return {
        id: "vault_unlock_env",
        title: "Unlock your vault",
        do_this: "Call vault_unlock (passphrase from MCP Environment).",
        mcp_tool: "vault_unlock",
        never: "Never paste the passphrase into chat.",
      };
    }
    return {
      id: "vault_unlock",
      title: "Unlock your vault",
      do_this:
        "Run in Terminal: password-space setup (or unlock), OR call vault_unlock with passphrase in the approval form.",
      cli_command: "password-space unlock",
      mcp_tool: "vault_unlock",
      never: "Never approve vault_unlock with an empty passphrase field.",
    };
  }
  return {
    id: "vault_set_secret",
    title: "Save a credential",
    do_this: "Call vault_set_secret — enter name and value in the MCP approval form only.",
    mcp_tool: "vault_set_secret",
    never: "Never paste API keys or passwords into chat.",
  };
}

export function buildOnboardingSteps(
  initialized: boolean,
  unlocked: boolean,
  session: boolean,
): OnboardingStep[] {
  const envPassphrase = isPassphraseConfiguredInEnv();
  const passphraseHint = envPassphrase
    ? "Your passphrase can load from MCP Environment, or you can type it in the approval form."
    : "When Cursor asks to approve the tool, enter your passphrase in the form — not an empty approval.";

  return [
    {
      id: "check",
      phase: "1/4",
      title: "Welcome",
      done: true,
      tool: "vault_onboard",
      user_action: "You're in the right place. We'll guide you through four short steps.",
    },
    {
      id: "init",
      phase: "2/4",
      title: "Secure your vault",
      done: initialized,
      tool: "vault_init",
      user_action: initialized
        ? undefined
        : `Pick a passphrase you'll remember (8+ characters). ${passphraseHint}`,
    },
    {
      id: "unlock",
      phase: "3/4",
      title: "Unlock for this session",
      done: unlocked && session,
      tool: "vault_unlock",
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
        ? "Add a name and value in the approval form only — never in chat."
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

export function vaultOnboardTool(store: VaultStore, dataDir: string): ToolJsonResult {
  const initialized = store.isInitialized();
  const unlocked = store.isUnlocked;
  const session = hasValidSession(sessionPath(dataDir));
  const steps = buildOnboardingSteps(initialized, unlocked, session);
  const primary_action = buildPrimaryAction(initialized, unlocked, session);
  const ready = initialized && unlocked;

  const progress = onboardingProgress(initialized, unlocked);
  const human_summary = !initialized
    ? "Welcome to Password Space. Let's create your private vault on this device."
    : !unlocked
      ? "Your vault is ready. Unlock it to store and use credentials."
      : "You're protected. Save a credential whenever you're ready.";

  return jsonResult({
    ok: true,
    data_dir: dataDir,
    initialized,
    unlocked,
    session,
    passphrase_env_configured: isPassphraseConfiguredInEnv(),
    trust_line: TRUST_LINE,
    progress,
    checklist: steps,
    human_summary,
    primary_action,
    next_tool: primary_action.mcp_tool ?? (ready ? "vault_set_secret" : "vault_status"),
    what_to_do: steps
      .filter((s) => !s.done && s.user_action)
      .slice(0, 2)
      .map((s) => `${s.phase} ${s.title}: ${s.user_action}`),
    never_paste_in_chat: ["passphrase", "secret values"],
  });
}

export function vaultStatusTool(store: VaultStore, dataDir: string): ToolJsonResult {
  const initialized = store.isInitialized();
  const unlocked = store.isUnlocked;
  const session = hasValidSession(sessionPath(dataDir));
  const steps = buildOnboardingSteps(initialized, unlocked, session);
  const passphraseEnv = isPassphraseConfiguredInEnv();

  const progress = onboardingProgress(initialized, unlocked);
  const next = !initialized
    ? "Next: vault_init — enter your passphrase in the approval form when prompted."
    : !unlocked
      ? "Next: vault_unlock — same passphrase, approval form only."
      : "You're ready. Use vault_set_secret, then inject_secret when needed.";

  return jsonResult({
    ok: true,
    data_dir: dataDir,
    db_path: vaultDbPath(dataDir),
    initialized,
    unlocked,
    session,
    secret_count: unlocked ? store.listSecrets().length : null,
    passphrase_env_configured: passphraseEnv,
    trust_line: TRUST_LINE,
    progress,
    headline: progress.headline,
    next,
    next_steps: steps.filter((s) => !s.done).map((s) => ({
      phase: s.phase,
      step: s.title,
      tool: s.tool,
      action: s.user_action,
    })),
    tip: !passphraseEnv && (!initialized || !unlocked)
      ? "Optional: add PASSWORD_SPACE_PASSPHRASE under Settings → MCP → password-space → Environment to approve faster."
      : undefined,
  });
}

export async function vaultInitTool(
  store: VaultStore,
  dataDir: string,
  args: { passphrase?: string },
): Promise<ToolJsonResult> {
  if (store.isInitialized()) {
    return jsonResult({
      ok: false,
      error: "Vault already initialized",
      data_dir: dataDir,
      hint: "Call vault_status or vault_unlock.",
    });
  }
  const passphrase = resolvePassphrase(args.passphrase);
  await store.init(passphrase);
  return jsonResult({
    ok: true,
    initialized: true,
    data_dir: dataDir,
    db_path: vaultDbPath(dataDir),
    next: "Call vault_unlock with the same passphrase (or PASSWORD_SPACE_PASSPHRASE), then vault_set_secret.",
    note: "Passphrase was not returned and must not be pasted into chat.",
  });
}

export async function vaultUnlockTool(
  dataDir: string,
  args: { passphrase?: string; ttl_hours?: number },
): Promise<ToolJsonResult> {
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
      "Password Space is not set up yet. Call vault_onboard or vault_init first (passphrase in the MCP form, not in chat).",
    );
  }
  if (!store.isUnlocked) {
    throw new Error(
      "Password Space is locked. Call vault_unlock and enter your passphrase in the MCP approval form (not in chat).",
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
