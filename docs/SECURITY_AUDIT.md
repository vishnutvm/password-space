# Password Space — Security Audit

**Date:** 2026-11-10 · **Revised:** 2026-11-17 for the plain JSON store · Complements [AUDIT.md](./AUDIT.md) and root [SECURITY.md](../SECURITY.md).

> **What changed.** The 2026-11-10 audit reviewed an encrypted vault (scrypt KDF, AES-256-GCM, wrapped vault key, unlock sessions). That design is gone from the product path. Secrets now live as **plain JSON** in `secrets.json` (mode `0600`). There is no passphrase, no unlock session, and no encryption at rest. The crypto review has been replaced with the at-rest review below.

## Assets

| Asset | Sensitivity |
| --- | --- |
| `secrets.json` (plain values + metadata) | Critical — anyone who can read it has every secret |
| Secret plaintext in process memory | Critical while handled |
| Inject env files | Critical until deleted |
| Secret metadata (names, tags, notes) | Confidential |
| Audit events (`audit.jsonl`) | Low (no values) |

## At-rest review (evidence-backed)

| Control | Implementation | Assessment |
| --- | --- | --- |
| Storage | `$PASSWORD_SPACE_HOME/secrets.json`, JSON, `packages/vault/src/store.ts` | **Plaintext at rest** — accepted by product decision |
| File mode | Written with `mode: 0o600`, then `chmodSync(0o600)` (best-effort) | Single-user protection only; no defense against the same OS user, backups, or disk images |
| Write safety | Temp file `secrets.json.<pid>.tmp` + `rename` | Atomic replace on POSIX; no partial-write corruption |
| Encryption / KDF | None | Use a dedicated password manager if ciphertext at rest is required |
| Recovery | Plain file — back it up like any other sensitive file | No passphrase to lose |
| Legacy `vault.db` | Detected, never read, deleted, or migrated | Old ciphertext stays wherever the user left it |

## Lifecycle

```text
setup (create secrets.json) → set / list / inject / remove
                                   │
                                   └─ unlock / lock / change-passphrase → soft-compat no-ops
```

## Trust boundary: `inject_secret`

```text
┌──────────────────┐  tool JSON (chat-visible plane)
│ Agent / Cursor   │◄──── handle, env_file path, env_var, expires_at
│ transcript       │      NO secret value (asserted in tool result)
└────────┬─────────┘
         │ runtime may read file
         ▼
┌──────────────────┐
│ inject/<tok>.env │  plaintext KEY='value'  mode 0600  TTL 5 min
└────────┬─────────┘
         │ same OS user / malware can read while present
         ▼
┌──────────────────┐
│ Optional hook    │  redacts *known* values from prompts — not complete
└──────────────────┘
```

`secrets.json` itself sits next to the inject directory and is readable by the same principals, so inject files add no new exposure class — they only add more copies of a value for a short time.

### What inject protects

- Keeps the secret **out of the default MCP tool JSON** returned to the model/chat.
- Defense-in-depth: refuse to return if the serialized payload contains the value.

### What inject does **not** protect

- Any tool/runtime that reads `env_file` (or `secrets.json`) and pastes contents into chat.
- Disk forensics of `secrets.json` or inject files.
- Process memory of the MCP server.
- Cross-user isolation (single-user model).

### Mitigations shipped

1. Prefer inject over `resolve_secret`.
2. Auto-delete **expired** inject files on inject and on soft-compat unlock/lock.
3. Skill + command: never print inject file contents.
4. `redact_in_transcript: true` flag for cooperating clients.
5. Default TTL 5 minutes.
6. `beforeSubmitPrompt` hook (`plugins/password-space/scripts/redact.mjs`) blocks outbound prompts that contain a known inject value.

## MCP tool matrix

| Tool | Plaintext? | Notes |
| --- | --- | --- |
| `vault_onboard` / `vault_status` / `vault_manager` | No | Status + UI metadata |
| `vault_init` | No | Ensures `secrets.json` exists. `passphrase` arg accepted and ignored |
| `vault_unlock` / `vault_lock` | No | No-ops. Clear leftover legacy `session` file and expired inject files |
| `vault_change_passphrase` | No | Returns `ok: false, code: "passphrase_not_used"` |
| `store_secret` (alias `vault_set_secret`) | Value in args; not in result | Leak check on serialize; value scrubbed from errors; rejects a value inside name/notes/tags; existing name needs `overwrite: true`; audit actor `mcp-agent` |
| `list_secrets` / `get_secret_metadata` | No | |
| `remove_secret` (alias `vault_delete_secret`) | No | Unknown name changes nothing; audit actor `mcp-agent` |
| `inject_secret` | File only | See boundary above |
| `resolve_secret` | **Yes** in result | Requires `confirm_redaction` |

## Secret value channels (allowed)

1. Terminal CLI hidden prompt (`dist/cli.js set`) — **primary**
2. stdin pipe to `set` (non-TTY)
3. `--value` flag (discouraged: shell history)
4. MCP `store_secret` args (agent path: the user hands the agent a key once; value never echoed, but the user's chat message still holds it)

**Forbidden:** MCP elicitation or Vault Manager App forms for secret values; pasting values into chat.

## Residual risks (accepted)

- Plaintext `secrets.json` readable by the same OS user, backups, sync tools, and malware
- No hardware-backed keys / OS keychain integration
- No per-secret ACL for MCP callers — any MCP caller can inject any secret by name
- Hook redaction is known-value only (inject files), not the whole store
- JS memory zeroization limits
- Marketplace plugin runs as local Node with full read access to `secrets.json`

**Recommendation:** Do not position Password Space as a replacement for an OS keychain or password manager. Its job is keeping secrets out of chat transcripts.
