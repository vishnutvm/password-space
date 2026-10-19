# Password Space hooks

Hooks (or equivalent message filters) are the **enforcement** layer: even if an agent tries to paste a secret into chat, strip or block it.

## What ships here

| File | Purpose |
| --- | --- |
| `redact.mjs` | Standalone redaction utility — stdin/stdout or args |
| `cursor-hook.example.json` | Example Cursor hooks config shape (verify against your Cursor version) |

Cursor’s hooks format evolves; treat the JSON example as a **template**, not a guaranteed schema. The redaction logic in `redact.mjs` is the portable piece.

## `redact.mjs`

Reads known secret values from:

1. `--secrets-file <path>` — one secret per line, or
2. Inject env files under `$PASSWORD_SPACE_HOME/inject/*.env` (parses `KEY='value'` lines), or
3. `--secret <value>` repeated flags (for tests; avoid in production shell history)

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

See `cursor-hook.example.json` for a sketch of how that might be declared.

## Limitations (honest)

- Only redacts **values already known** to the hook (inject files / secrets file). Brand-new typed secrets are not in that set until stored/injected.
- Agents can still *use* secrets in subprocesses; the hook protects the **conversation plane**.
- Always combine with the Skill rules and prefer `inject_secret`.
