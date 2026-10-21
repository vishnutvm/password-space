# Security Policy

## Threat model (MVP summary)

Password Space is a **local-only** encrypted credential vault. There is no cloud sync server in this MVP.

| Principal | May see plaintext? |
| --- | --- |
| Human owner after unlock | Yes (CLI `get`) |
| Agent process via MCP `inject_secret` / confirmed `resolve_secret` | Ephemerally, for requested secrets |
| Chat / transcript store | **Goal: no** — design + Skill + optional hook reduce exposure; not an absolute guarantee across every client, log, or screenshot |
| Disk dump while locked | No (AES-256-GCM ciphertext + scrypt-wrapped vault key) |
| Disk dump while unlocked session file exists | **Yes** — session is equivalent to an unlocked password manager |
| Same OS user with access to the account | May read session / inject files / process memory while unlocked — `0600` is not a multi-user authz model |
| Attacker who knows the unlock passphrase | Yes |

### Crypto (MVP)

| Topic | Detail |
| --- | --- |
| KDF | scrypt via Node.js `crypto.scrypt` — N=2¹⁵, r=8, p=1; random 32-byte salt per vault |
| AEAD | AES-256-GCM; random 12-byte IV per encryption; auth tag verified on decrypt |
| At rest | Random 32-byte vault key wrapped by passphrase-derived key; each secret encrypted under the vault key |
| Unlock session | Vault key wrapped and stored under `$PASSWORD_SPACE_HOME/session` with mode `0600` and TTL (default 8h) |
| Inject files | Short-lived env files under `inject/` with mode `0600` (default TTL metadata 5 minutes) |

We do **not** invent cryptographic primitives. Lost unlock passphrase = **data unrecoverable** (no recovery kit in MVP).

### Plaintext boundaries

Decrypted values can exist in:

- CLI/`get` and MCP `resolve_secret` tool results
- Process memory while a secret is handled
- Inject `*.env` files until deleted
- An unlocked session file on disk

Minimize lifetime: prefer `inject_secret`, delete inject files after use, run `password-space lock` when idle.

### MCP access

| Tool | Can obtain plaintext? |
| --- | --- |
| `list_secrets` / `get_secret_metadata` | No |
| `inject_secret` | Writes plaintext to a local env file; tool JSON omits the value |
| `resolve_secret` | Yes, only with `confirm_redaction: true` |

There is **no per-secret ACL** in MVP: any caller that can talk to the unlocked MCP server can request any secret by name.

### Redaction

The hook redacts **known** values (primarily from inject files / explicit lists). It does not cover every execution path, brand-new typed secrets, screenshots, or external log pipelines.

### Trust boundaries

```text
┌─────────────┐     unlock      ┌──────────────────┐
│ Human + CLI │ ──────────────► │ Local vault.db   │
└─────────────┘                 │ (ciphertext)     │
                                └────────┬─────────┘
                                         │ session
                                ┌────────▼─────────┐
                                │ MCP server       │──► inject env file
                                └────────┬─────────┘
                                         │ metadata / handles in chat (goal)
                                ┌────────▼─────────┐
                                │ Agent + Skill    │
                                └────────┬─────────┘
                                         │
                                ┌────────▼─────────┐
                                │ Hook redaction   │
                                └──────────────────┘
```

### Non-goals / known risks

- Unlocked session file theft = secret compromise (lock when idle)
- Encryption at rest does not protect an unlocked machine
- `resolve_secret` can put plaintext in MCP tool results — prefer `inject_secret`
- Hook only redacts **known** values
- No multi-user authz, remote attestation, hardware-backed keys, or backup/recovery kit in MVP
- Not a substitute for OS keychain / enterprise secret managers when those are required

## Reporting vulnerabilities

Please open a [GitHub security advisory](https://github.com/vishnutvm/password-space/security/advisories/new) (preferred) or email the maintainer via the address on the GitHub profile. Do not file public issues with working exploit details for crypto/session bugs until a fix is available.
