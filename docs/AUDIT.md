# Password Space — Engineering Audit

**Date:** 2026-11-10 · **Repo:** `vishnutvm/password-space` · **Scope:** vault, CLI, MCP, plugin, tests, build  
**Method:** Source review of `packages/*`, `plugins/password-space`, `scripts/`, hooks, skills — not README-only.

## Inventory

| Area | Location | Role |
| --- | --- | --- |
| Vault core | `packages/vault` | AES-256-GCM + scrypt, SQLite store, session, inject, redact |
| CLI | `packages/cli` | Human setup / CRUD / audit |
| MCP server | `packages/mcp-server` | Agent tools + onboarding contract |
| Plugin | `plugins/password-space` | Marketplace MCP bundle, skill, hooks, `/setup-password-space` |
| Build | `scripts/bundle-mcp.mjs` | esbuild → `plugins/password-space/dist/index.js` |
| Tests | vault + mcp vitest | Crypto, store, paths, MCP leak contracts, onboarding |

## Architecture (verified)

```text
passphrase → scrypt(salt) → master key → unwrap vault key → AES-GCM secrets
Unlock session: vault key wrapped under random fileKey in `$HOME/session` (0600, TTL)
Agent path: inject_secret → inject/<token>.env (0600) + handle; resolve_secret last resort
```

Onboarding contract is MCP-first: `vault_onboard` → single `primary_action` → approval-form passphrase (never elicitation). CLI is `advanced_escape_hatch` only.

## Findings (severity-ordered)

### High

| ID | Finding | Evidence | Status |
| --- | --- | --- | --- |
| H1 | **Inject TTL is metadata-only** — expired `inject/*.env` files keep plaintext until manually deleted | `packages/vault/src/inject.ts` writes `expiresAt` but never enforces/deletes | **Fixed** — `clearExpiredInjectFiles` on inject + unlock paths |
| H2 | **No unlock attempt throttling** — local offline brute-force of passphrase is unconstrained | `VaultStore.unlock` / `vaultUnlockTool` have no backoff | **Fixed** — attempt file + exponential delay under data dir |
| H3 | **Unlocked session = full vault key on disk** | `session.ts` stores `fileKey` beside wrapped vault key; same OS user can unwrap | Documented (threat model); lock-when-idle guidance; not a crypto rewrite |

### Medium

| ID | Finding | Evidence | Status |
| --- | --- | --- | --- |
| M1 | **No MCP `vault_delete_secret`** — agents/UI could not remove credentials without CLI | MCP tool set in `packages/mcp-server/src/index.ts` | **Fixed** |
| M2 | **No change-passphrase path** — stolen passphrase leaves vault permanently owned | Store only wraps once at init | **Fixed** — `changePassphrase` + MCP/CLI |
| M3 | **`resolve_secret` plaintext in tool results** | Intentional last resort with `confirm_redaction` | Retained; Skill + docs prefer inject |
| M4 | **CLI `--passphrase` / `--value` on argv** | Visible in process listings / shell history | Documented; prefer hidden prompt / env / stdin |
| M5 | **Audit log readable without unlock** | `listAudit` skips `requireKey()` | Low risk (no plaintext); left as local forensics aid |

### Low / UX

| ID | Finding | Status |
| --- | --- | --- |
| L1 | MCP Apps Vault Manager deferred in `docs/zero-friction-v1.md` | **Shipped** — `vault_manager` + `ui://` resource; progressive enhancement |
| L2 | Competing skill wording across cache vs repo | Repo skill/command aligned Install→Setup→Use |
| L3 | `listAudit` actor strings mixed (`human` / `mcp-agent`) | Acceptable for MVP |

## Trust boundary — `inject_secret` (summary)

See [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) for the full diagram. Chat may see handle + path; plaintext lives only in the inject file and process memory. Clients that `cat` the file into chat defeat the design — Skill/hooks mitigate, do not guarantee.

## Test / build gaps (pre-fix)

- No e2e against a live Cursor host (practical limit) — covered by unit/integration contracts.
- No dedicated lint config per package (`lint --if-present` no-ops).
- Plugin dist must be rebuilt after MCP changes (`pnpm build:plugin`).

## Non-goals honored

- Did not rewrite working crypto without evidence of failure.
- Did not touch `~/.password-space` in tests (temp dirs only).
- Did not force-push history rewrite of public `main`.
