# Architecture

Password Space is a local monorepo with three runtime packages plus Skill/Hook integration assets.

## Data flow

1. **`password-space init`** — generate vault key; wrap with scrypt(passphrase); store salt + wrapped key + empty secrets table in `vault.db`.
2. **`password-space unlock`** — derive master key; unwrap vault key; write TTL session file (`0600`).
3. **CLI / MCP** — open DB; load session; decrypt secrets in process memory only as needed.
4. **Agent path** — `inject_secret` writes `inject/<token>.env`; tool JSON returns handle + path, never the value.
5. **Lock** — delete session; zero in-memory keys on process exit.

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
