# Security Policy

## Threat model (MVP summary)

Password Space is a **local-only** encrypted credential vault. There is no cloud sync server in this MVP.

| Principal | May see plaintext? |
| --- | --- |
| Human owner after unlock | Yes (CLI `get`) |
| Agent process via MCP `inject_secret` / confirmed `resolve_secret` | Ephemerally, for requested secrets |
| Chat / transcript store | **No** (product requirement) |
| Disk dump while locked | No (AES-256-GCM ciphertext + scrypt-wrapped vault key) |
| Disk dump while unlocked session file exists | **Yes** — session is equivalent to an unlocked password manager |
| Attacker who knows the unlock passphrase | Yes |

### Crypto (MVP)

- **KDF:** scrypt (N=2¹⁵, r=8, p=1) via Node.js `crypto.scrypt`
- **AEAD:** AES-256-GCM via Node.js `crypto`
- **At rest:** random vault key wrapped by passphrase-derived key; each secret encrypted under the vault key
- **Unlock session:** vault key wrapped and stored under `~/.password-space/session` with mode `0600` and TTL (default 8h)

We do **not** invent cryptographic primitives. Lost unlock passphrase = **data unrecoverable** (no recovery kit in MVP).

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
                                         │ metadata / handles only in chat
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
- `resolve_secret` can put plaintext in MCP tool results — prefer `inject_secret`; enable transcript redaction
- Hook only redacts **known** values (inject files / secrets list)
- No multi-user authz, remote attestation, or hardware-backed keys in MVP
- Not a substitute for OS keychain / enterprise secret managers when those are required

## Reporting vulnerabilities

Please open a [GitHub security advisory](https://github.com/vishnutvm/password-space/security/advisories/new) (preferred) or email the maintainer via the address on the GitHub profile. Do not file public issues with working exploit details for crypto/session bugs until a fix is available.
