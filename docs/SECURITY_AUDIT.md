# Password Space — Security Audit

**Date:** 2026-11-10 · Complements [AUDIT.md](./AUDIT.md) and root [SECURITY.md](../SECURITY.md).

## Assets

| Asset | Sensitivity |
| --- | --- |
| Unlock passphrase | Critical — sole recovery factor |
| Vault key (in memory / session) | Critical while unlocked |
| Secret plaintext | Critical |
| Secret metadata (names, tags, notes) | Confidential |
| Inject env files | Critical until deleted |
| Audit events | Low (no values) |

## Crypto review (evidence-backed)

| Control | Implementation | Assessment |
| --- | --- | --- |
| KDF | Node `crypto.scrypt`, N=2¹⁵, r=8, p=1, 32-byte salt, maxmem 64MiB | Adequate for local MVP; Argon2id would be a future upgrade, not a rewrite without need |
| AEAD | AES-256-GCM, 12-byte IV, auth tag | Correct Node AEAD usage |
| Key hierarchy | Random vault key wrapped by passphrase-derived master | Sound |
| Session | Vault key re-wrapped with random `fileKey` stored **in the same file** | **Local trust only** — equivalent to unlocked password-manager session; `0600` + TTL |
| Zeroization | `Buffer.fill(0)` on master/session keys in several paths | Best-effort in JS; not a hard guarantee against GC copies |

**Lost passphrase = unrecoverable.** No recovery kit (by design).

## Lifecycle

```text
init → unlock (session) → set/list/get/inject → lock (clear session)
         │
         ├─ wrong passphrase → (rate-limited) fail
         └─ change passphrase → re-wrap vault key under new salt/KDF
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
│ inject/<tok>.env │  plaintext KEY='value'  mode 0600  TTL metadata
└────────┬─────────┘
         │ same OS user / malware can read while present
         ▼
┌──────────────────┐
│ Optional hook    │  redacts *known* values from prompts — not complete
└──────────────────┘
```

### What inject protects

- Keeps secret **out of the default MCP tool JSON** returned to the model/chat.
- Defense-in-depth: refuse to return if serialized payload contains the value.

### What inject does **not** protect

- Any tool/runtime that reads `env_file` and pastes contents into chat.
- Disk forensics while the file exists (or after insecure delete on some FS).
- Process memory of the MCP server while decrypting.
- Cross-user isolation (single-user model).

### Mitigations shipped / reinforced

1. Prefer inject over `resolve_secret`.
2. Auto-delete **expired** inject files on unlock/inject.
3. Skill + command: never print inject file contents.
4. `redact_in_transcript: true` flag for cooperating clients.
5. Default TTL 5 minutes (metadata + cleanup).

## MCP tool matrix

| Tool | Plaintext? | Notes |
| --- | --- | --- |
| `vault_onboard` / `vault_status` / `vault_manager` | No | Status + UI metadata |
| `vault_init` / `vault_unlock` / `vault_change_passphrase` | Passphrase in **args** only | Never elicitation; never echo |
| `vault_set_secret` | Value in args; not in result | Leak check on serialize |
| `list_secrets` / `get_secret_metadata` | No | |
| `vault_delete_secret` | No | |
| `inject_secret` | File only | See boundary above |
| `resolve_secret` | **Yes** in result | Requires `confirm_redaction` |
| `vault_lock` | No | Clears session |

## Passphrase channels (allowed)

1. MCP tool approval form arguments  
2. `PASSWORD_SPACE_PASSPHRASE` in MCP Environment  
3. CLI hidden prompt / env  
4. MCP Apps Vault Manager form → `callServerTool` with passphrase args  

**Forbidden:** MCP elicitation for passphrase or secret values (spec + product rule).

## Residual risks (accept / external audit)

- Session file theft while unlocked  
- No hardware-backed keys / OS keychain integration  
- No per-secret ACL for MCP callers  
- Hook redaction is known-value only  
- JS memory zeroization limits  
- Marketplace plugin runs as local Node with full vault access when unlocked  

**Recommendation:** Independent crypto/session review before marketing as a replacement for OS keychain or enterprise secret managers.
