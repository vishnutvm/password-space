# Password Space hooks

Hooks (or equivalent message filters) are the **enforcement** layer: even if an agent tries to paste a secret into chat, strip or block it.

## What ships here

| File | Purpose |
| --- | --- |
| `redact.mjs` | Standalone redaction utility — stdin/stdout, **opt-in** defaults |
| `cursor-hook.example.json` | Example Cursor hooks config shape (verify against your Cursor version) |

There is **one** redaction implementation: [`plugins/password-space/scripts/redact.mjs`](../plugins/password-space/scripts/redact.mjs). The marketplace plugin wires it as its `beforeSubmitPrompt` hook (see `plugins/password-space/hooks/hooks.json`), where it defaults to `--from-inject --fail-on-leak`. `hooks/redact.mjs` here is a two-line wrapper that calls the same code with those defaults turned **off**, so it only redacts or blocks what you ask it to.

| Entry | Defaults | Use |
| --- | --- | --- |
| `plugins/password-space/scripts/redact.mjs` | `--from-inject --fail-on-leak` | Cursor hook (plugin install) |
| `hooks/redact.mjs` | `--no-from-inject --no-fail-on-leak` | Ad-hoc filtering, other clients, tests |

Both accept the same flags; later flags override earlier ones.

Claude Code cannot rewrite a prompt, so the Claude Code plugin uses a separate guard, `plugins/password-space/scripts/claude-prompt-guard.mjs`, that **blocks** a prompt containing any stored value (from `secrets.json` and inject files). See [docs/claude-code.md](../docs/claude-code.md).

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
