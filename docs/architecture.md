# Architecture

Password Space is a local monorepo with three runtime packages plus Skill/Hook integration assets.

## Data flow

1. **`vault_init` (MCP) or `password-space init` (CLI)** — generate vault key; wrap with scrypt(passphrase); store salt + wrapped key + empty secrets table in `vault.db`.
2. **`vault_unlock` / `password-space unlock`** — derive master key; unwrap vault key; write TTL session file (`0600`).
3. **MCP (bundled plugin) / CLI** — open DB; load session; decrypt secrets in process memory only as needed.
4. **Store** — `vault_set_secret` (MCP) or CLI `set` encrypts values at rest (metadata-only tool results).
5. **Agent path** — `inject_secret` writes `inject/<token>.env`; tool JSON returns handle + path, never the value.
6. **Lock** — `vault_lock` / CLI `lock` deletes session; zero in-memory keys on process exit.

Marketplace installs ship a self-contained MCP bundle (`plugins/password-space/dist/index.js`) so day-1 init/unlock/set does not require cloning the monorepo.

## Key hierarchy

```text
passphrase
  └─ scrypt(salt) → master key
       └─ unwrap → vault key
            └─ AES-256-GCM → per-secret ciphertext
```

## Files on disk (`$PASSWORD_SPACE_HOME`, default `~/.password-space`)

| Path | Contents |
| --- | --- |
| `vault.db` | SQLite: meta, encrypted secrets, audit (no plaintext values) |
| `session` | Temporary unlock session (sensitive while present) |
| `inject/*.env` | Short-lived env files for agent consumption |

## Why not return secrets in MCP by default

MCP tool results are often mirrored into chat UIs and logs. `inject_secret` keeps the conversation plane on **refs** (`ps://NAME`) while the runtime plane reads a file. `resolve_secret` exists for constrained clients and requires explicit `confirm_redaction`.
