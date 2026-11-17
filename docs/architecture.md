# Architecture

Password Space is a local monorepo with three runtime packages plus Skill/Hook integration assets.

## Data flow

1. **`password-space setup` (CLI)** — create `secrets.json` under `$PASSWORD_SPACE_HOME` (mode `0600`) and pick where values go: the OS keychain when a test write works, else the plain-file fallback. No passphrase.
2. **Terminal `set` / `remove`** — human path to add or delete named secrets (hidden value prompts).
3. **MCP (bundled plugin)** — list metadata, report storage and the exact `run` command; `inject_secret` by name.
4. **Agent path** — `cli.js run -s NAME -- <command>` puts values into the child process env and redacts them from its output. `inject_secret` (fallback) writes `inject/<token>.env`; tool JSON returns handle + path, never the value.
5. **Prompt hooks** — `scripts/prompt-guard.mjs` (bundled `dist/guard.js`) blocks Cursor / Claude Code prompts that contain any stored value, matching keychain values by keyed fingerprint.
6. **Vault Manager** — optional status-only MCP App; not used for add/remove.
7. **Lock / unlock** — removed; there is no passphrase.

Marketplace installs ship a self-contained MCP + CLI bundle (`plugins/password-space/dist/`) so day-1 setup/set does not require cloning the monorepo.

## Files on disk (`$PASSWORD_SPACE_HOME`, default `~/.password-space`)

| Path | Contents |
| --- | --- |
| `secrets.json` | Names, tags, notes, backend, value fingerprints (mode `0600`). Values too, only with the file fallback |
| OS keychain | Values (service `password-space`, account `<storeId>:<secretId>`) and the fingerprint key (`<storeId>:guard-key`) |
| `audit.jsonl` | Optional append-only audit (no values) |
| `inject/*.env` | Short-lived env files for agent consumption |
| `vault.db` | Legacy encrypted SQLite (left untouched if present) |

## Why not return secrets in MCP by default

MCP tool results are often mirrored into chat UIs and logs. `inject_secret` keeps the conversation plane on **refs** (`ps://NAME`) while the runtime plane reads a file. `resolve_secret` exists for constrained clients and requires explicit `confirm_redaction`.
