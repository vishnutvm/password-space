# Security Policy

## Threat model (MVP summary)

Password Space is a **local-only** plain-text named secret store. There is no cloud sync server in this MVP.

| Principal | May see plaintext? |
| --- | --- |
| Human owner (CLI `get`) | Yes |
| Agent process via MCP `inject_secret` / confirmed `resolve_secret` | Ephemerally, for requested secrets |
| Chat / transcript store | **Goal: no** — design + Skill + optional hook reduce exposure; not an absolute guarantee |
| Disk dump of `secrets.json` | **Yes** — values are plain at rest (mode `0600`) |
| Same OS user with access to the account | May read store / inject files / process memory — `0600` is not a multi-user authz model |

### Storage (MVP)

| Topic | Detail |
| --- | --- |
| At rest | `$PASSWORD_SPACE_HOME/secrets.json` (default `~/.password-space`), mode `0600`, plain values |
| Inject files | Short-lived env files under `inject/` with mode `0600` (default TTL metadata 5 minutes) |
| Lock / unlock | **Not used** for the product path — soft-compat tools may no-op |

This product prioritizes **keeping secrets out of chat** over at-rest encryption. If you need ciphertext at rest, use a dedicated password manager.

### Plaintext boundaries

Values can exist in:

- `secrets.json` on disk
- CLI/`get` and MCP `resolve_secret` tool results
- Process memory while a secret is handled
- Inject `*.env` files until deleted

Minimize lifetime: prefer `inject_secret`, delete inject files after use.

### MCP access

| Tool | Can obtain plaintext? |
| --- | --- |
| `list_secrets` / `get_secret_metadata` | No |
| `inject_secret` | Writes plaintext to a local env file; tool JSON omits the value |
| `resolve_secret` | Yes, only with `confirm_redaction: true` |

There is **no per-secret ACL** in MVP: any caller that can talk to the MCP server can request any secret by name.

### Redaction

The hook redacts **known** values (primarily from inject files / explicit lists). It does not cover every execution path, brand-new typed secrets, screenshots, or external log pipelines.

### Trust boundaries

```text
┌─────────────┐     set/remove     ┌──────────────────┐
│ Human + CLI │ ─────────────────► │ secrets.json     │
└─────────────┘                    │ (plain, 0600)    │
                                   └────────┬─────────┘
┌─────────────┐     inject_secret           │
│ Agent + MCP │ ◄───────────────────────────┘
└─────────────┘     → inject/*.env (short-lived)
```

### Legacy encrypted vault

Older releases stored ciphertext in `vault.db`. That file is **never wiped or auto-migrated**. Users re-add secrets via Terminal `set` into `secrets.json`.

### Reporting

Please report security issues privately to the repository owner. Do not open public issues that include real secrets or exploit details that would harm other users.
