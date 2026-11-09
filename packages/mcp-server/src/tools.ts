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
    super(
      "Your vault passphrase is required for this step. Enter it in the MCP approval form (passphrase field), or set PASSWORD_SPACE_PASSPHRASE in Cursor Settings → MCP → password-space → Environment. Do not type the passphrase in chat.",
    );
    this.name = "PassphraseRequiredError";
  }
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
  title: string;
  done: boolean;
  tool?: string;
  user_action?: string;
};

export function buildOnboardingSteps(
  initialized: boolean,
  unlocked: boolean,
  session: boolean,
): OnboardingStep[] {
  const envPassphrase = isPassphraseConfiguredInEnv();
  const passphraseHint = envPassphrase
    ? "Passphrase can come from PASSWORD_SPACE_PASSPHRASE (already set) or the approval form."
    : "In the MCP approval dialog, fill in the passphrase field — do not approve with empty {}.";

  return [
    {
      id: "check",
      title: "Check vault status",
      done: true,
      tool: "vault_status",
    },
    {
      id: "init",
      title: "Create your vault (first time only)",
      done: initialized,
      tool: "vault_init",
      user_action: initialized
        ? undefined
        : `Choose a passphrase (8+ characters). ${passphraseHint}`,
    },
    {
      id: "unlock",
      title: "Unlock the vault for this session",
      done: unlocked && session,
      tool: "vault_unlock",
      user_action:
        initialized && !(unlocked && session)
          ? `Use the same passphrase. ${passphraseHint}`
          : undefined,
    },
    {
      id: "store",
      title: "Store a credential",
      done: false,
      tool: "vault_set_secret",
      user_action: unlocked
        ? "Provide name + value in the approval form (never paste the value into chat)."
        : "Complete unlock first.",
    },
    {
      id: "use",
      title: "Use a credential via the agent",
      done: false,
      tool: "inject_secret",
      user_action: "Agent reads a short-lived env file — the secret value stays out of chat.",
    },
  ];
}

export function vaultOnboardTool(store: VaultStore, dataDir: string): ToolJsonResult {
  const initialized = store.isInitialized();
  const unlocked = store.isUnlocked;
  const session = hasValidSession(sessionPath(dataDir));
  const steps = buildOnboardingSteps(initialized, unlocked, session);
  const nextIncomplete = steps.find((s) => !s.done && s.id !== "check" && s.id !== "use" && s.id !== "store");
  const ready = initialized && unlocked;

  return jsonResult({
    ok: true,
    data_dir: dataDir,
    initialized,
    unlocked,
    session,
    passphrase_env_configured: isPassphraseConfiguredInEnv(),
    checklist: steps,
    human_summary: !initialized
      ? "Your Password Space vault is not set up yet."
      : !unlocked
        ? "Vault exists but is locked."
        : "Vault is ready — you can store and inject secrets.",
    next_tool: ready
      ? "vault_set_secret"
      : (nextIncomplete?.tool ?? "vault_status"),
    next_steps: steps
      .filter((s) => !s.done)
      .map((s) => (s.user_action ? `${s.title}: ${s.user_action}` : s.title)),
    never_paste_in_chat: ["passphrase", "secret values"],
  });
}

export function vaultStatusTool(store: VaultStore, dataDir: string): ToolJsonResult {
  const initialized = store.isInitialized();
  const unlocked = store.isUnlocked;
  const session = hasValidSession(sessionPath(dataDir));
  const steps = buildOnboardingSteps(initialized, unlocked, session);
  const passphraseEnv = isPassphraseConfiguredInEnv();

  const next = !initialized
    ? "Run vault_init with your passphrase in the MCP approval form (or PASSWORD_SPACE_PASSPHRASE). Do not approve empty {}."
    : !unlocked
      ? "Run vault_unlock with the same passphrase in the approval form (or PASSWORD_SPACE_PASSPHRASE)."
      : "Vault ready. Use vault_set_secret, then inject_secret when you need a credential.";

  return jsonResult({
    ok: true,
    data_dir: dataDir,
    db_path: vaultDbPath(dataDir),
    initialized,
    unlocked,
    session,
    secret_count: unlocked ? store.listSecrets().length : null,
    passphrase_env_configured: passphraseEnv,
    next,
    next_steps: steps.filter((s) => !s.done).map((s) => ({
      step: s.title,
      tool: s.tool,
      action: s.user_action,
    })),
    tip: !passphraseEnv && (!initialized || !unlocked)
      ? "Set PASSWORD_SPACE_PASSPHRASE in Cursor → Settings → MCP → password-space → Environment to skip typing the passphrase on each tool call."
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
