# Architecture

Password Space is a local monorepo with three runtime packages plus Skill/Hook integration assets.

## Data flow

1. **`password-space setup` (CLI) or soft-compat `vault_init` (MCP)** — ensure `secrets.json` exists under `$PASSWORD_SPACE_HOME` (mode `0600`). No passphrase.
2. **Terminal `set` / `remove`** — human path to add or delete named secrets (hidden value prompts).
3. **MCP (bundled plugin)** — open the plain store; list metadata; `inject_secret` by name.
4. **Agent path** — `inject_secret` writes `inject/<token>.env`; tool JSON returns handle + path, never the value.
5. **Vault Manager** — optional status-only MCP App; not used for add/remove.
6. **Lock / unlock** — soft-compat no-ops; not part of the product path.

Marketplace installs ship a self-contained MCP + CLI bundle (`plugins/password-space/dist/`) so day-1 setup/set does not require cloning the monorepo.

## Files on disk (`$PASSWORD_SPACE_HOME`, default `~/.password-space`)

| Path | Contents |
| --- | --- |
| `secrets.json` | Plain named secrets + metadata (mode `0600`) |
| `audit.jsonl` | Optional append-only audit (no values) |
| `inject/*.env` | Short-lived env files for agent consumption |
| `vault.db` | Legacy encrypted SQLite (left untouched if present) |

## Why not return secrets in MCP by default

MCP tool results are often mirrored into chat UIs and logs. `inject_secret` keeps the conversation plane on **refs** (`ps://NAME`) while the runtime plane reads a file. `resolve_secret` exists for constrained clients and requires explicit `confirm_redaction`.
