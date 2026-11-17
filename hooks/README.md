# Password Space hooks

Hooks (or equivalent message filters) are the **enforcement** layer: even if an agent tries to paste a secret into chat, strip or block it.

## What ships here

| File | Purpose |
| --- | --- |
| `redact.mjs` | Standalone redaction utility — stdin/stdout, **opt-in** defaults |
| `cursor-hook.example.json` | Example Cursor hooks config shape (verify against your Cursor version) |

**The plugin's prompt hook is [`plugins/password-space/scripts/prompt-guard.mjs`](../plugins/password-space/scripts/prompt-guard.mjs)**, wired as Cursor's `beforeSubmitPrompt` and Claude Code's `UserPromptSubmit`. It blocks a prompt containing **any stored value** (OS keychain values by keyed fingerprint, file-backend values, and live inject files). Try it by hand: `echo "text" | node plugins/password-space/scripts/prompt-guard.mjs` exits `2` on a match.

**The plugin's tool hook is [`plugins/password-space/scripts/shell-guard.mjs`](../plugins/password-space/scripts/shell-guard.mjs)**, wired as Claude Code's `PreToolUse` (`Bash`, `Read`, `Grep`) and Cursor's `beforeShellExecution` and `beforeReadFile`. It blocks `password-space get`, direct keychain lookups (`security find-generic-password`, `secret-tool lookup`, `CredRead`), and reads of `secrets.json` or `inject/*.env` (sourcing an inject file is allowed). It is a guard rail, not a sandbox: see [SECURITY.md](../SECURITY.md#what-an-agent-with-shell-access-can-still-do).

`redact.mjs` below is a separate stdin → stdout utility for values you list explicitly or that are in inject files. [`plugins/password-space/scripts/redact.mjs`](../plugins/password-space/scripts/redact.mjs) defaults to `--from-inject --fail-on-leak`; `hooks/redact.mjs` here wraps the same code with those defaults turned **off**.

| Entry | Defaults | Use |
| --- | --- | --- |
| `plugins/password-space/scripts/redact.mjs` | `--from-inject --fail-on-leak` | Filtering with inject values (no longer the plugin hook) |
| `hooks/redact.mjs` | `--no-from-inject --no-fail-on-leak` | Ad-hoc filtering, other clients, tests |

Both accept the same flags; later flags override earlier ones.

See [docs/claude-code.md](../docs/claude-code.md) for the Claude Code side.

Cursor’s hooks format evolves; treat the JSON example as a **template**, not a guaranteed schema.

## `redact.mjs`

Reads known secret values from:

1. `--secrets-file <path>` — one secret per line, and/or
2. Inject env files under `$PASSWORD_SPACE_HOME/inject/*.env` (parses `KEY='value'` lines) with `--from-inject`, and/or
3. `--secret <value>` repeated flags (for tests; avoid in production shell history)

It does **not** read `secrets.json`. Only values that have been injected recently (or that you list explicitly) are known to the hook.

```bash
# Redact stdin
echo "token=ghp_abc" | node hooks/redact.mjs --secret 'ghp_abc'

# Redact using current inject files
export PASSWORD_SPACE_HOME=~/.password-space
node hooks/redact.mjs --from-inject < message.txt
```

Exit codes:

- `0` — wrote redacted text
- `2` — input still contained a known secret after redaction (should not happen)
- `3` — `--fail-on-leak` and a secret was present in the **input** (block send)

## Suggested Cursor wiring

If your Cursor build supports a `beforeSubmitPrompt` (or similar) hook that can transform or reject the outbound message, call:

```bash
node /absolute/path/to/password-space/hooks/redact.mjs --from-inject --fail-on-leak
```

- Transform mode (default): replace values with `[REDACTED]`
- `--fail-on-leak`: exit `3` if any known secret appears, so the client can **block** the send

If you installed the marketplace plugin you already have this hook; no manual wiring is needed. See `cursor-hook.example.json` for a sketch of local wiring.

## Limitations (honest)

- Only redacts **values already known** to the hook (inject files / secrets file). Secrets stored in `secrets.json` but never injected are not in that set.
- Agents can still *use* secrets in subprocesses; the hook protects the **conversation plane**.
- Always combine with the Skill rules and prefer `inject_secret`.
