# Password Space — Engineering Audit

**Date:** 2026-11-10 · **Revised:** 2026-11-17 for the plain JSON store · **Repo:** `vishnutvm/password-space`  
**Scope:** vault, CLI, MCP, plugin, tests, build  
**Method:** Source review of `packages/*`, `plugins/password-space`, `scripts/`, hooks, skills — not README-only.

> **Status.** This audit was first written against the encrypted SQLite vault (`vault.db`, scrypt + AES-256-GCM, unlock sessions). Since 2026-11-13 the product path is a **plain JSON store** (`secrets.json`, mode `0600`) with no passphrase, unlock, or encryption. Findings below are kept for history and marked where the pivot made them obsolete. Leftover crypto/session code is listed in [LEGACY_CODE.md](./LEGACY_CODE.md).

## Inventory

| Area | Location | Role |
| --- | --- | --- |
| Store core | `packages/vault` | Plain JSON store (`store.ts`), inject files, redact helpers. Legacy `crypto.ts` / `session.ts` / `unlock-guard.ts` remain but are off the product path |
| CLI | `packages/cli` | Human Terminal setup / set / remove / list / audit |
| MCP server | `packages/mcp-server` | Agent tools + onboarding contract |
| Plugin | `plugins/password-space` | Marketplace MCP + CLI bundle, skill, hooks, `/setup-password-space` |
| Build | `scripts/bundle-mcp.mjs` | esbuild → `plugins/password-space/dist/{index.js,cli.js}` |
| Tests | vault + mcp vitest | Store, paths, MCP leak contracts, onboarding (crypto/session tests still run against the legacy modules) |

## Architecture (verified 2026-11-17)

```text
Human: Terminal setup / set → ~/.password-space/secrets.json (plain JSON, 0600, atomic write)
Audit: ~/.password-space/audit.jsonl (append-only, no values)
Agent path: inject_secret → inject/<token>.env (dir 0700, file 0600, 60 s TTL, deleted at expiry and on server exit) + handle; resolve_secret off unless PASSWORD_SPACE_ENABLE_RESOLVE=1
Lock / unlock / change-passphrase: soft-compat no-ops (MCP + CLI)
```

Onboarding contract is Terminal-first: `vault_onboard` → single `primary_action` → plugin-bundled `dist/cli.js setup` then `set` (hidden value prompt). No passphrase anywhere on the product path.

## Findings (severity-ordered)

### High

| ID | Finding | Evidence | Status |
| --- | --- | --- | --- |
| H1 | **Inject TTL is metadata-only** — expired `inject/*.env` files keep plaintext until manually deleted | `packages/vault/src/inject.ts` writes `expiresAt` but never enforced/deleted | **Fixed** — `clearExpiredInjectFiles` runs on inject and on soft-compat unlock/lock |
| H2 | **No unlock attempt throttling** — offline brute force of passphrase | `VaultStore.unlock` had no backoff | **Obsolete** — no passphrase exists. `unlock-guard.ts` is now unused |
| H3 | **Unlocked session = full vault key on disk** | `session.ts` stored `fileKey` beside wrapped vault key | **Obsolete** — no sessions are written. Superseded by a larger, accepted risk: values are plain at rest (see SEC-1 below) |
| SEC-1 | **Secrets are plaintext at rest** | `store.ts` persists `secrets.json` as JSON | **Accepted by design** — `0600` + atomic write only. Documented in [SECURITY.md](../SECURITY.md) |

### Medium

| ID | Finding | Evidence | Status |
| --- | --- | --- | --- |
| M1 | **No MCP `vault_delete_secret`** | MCP tool set in `packages/mcp-server/src/index.ts` | **Fixed** |
| M2 | **No change-passphrase path** | Store only wrapped once at init | **Obsolete** — `vault_change_passphrase` returns `ok: false, code: "passphrase_not_used"`; CLI `change-passphrase` prints a notice |
| M3 | **`resolve_secret` plaintext in tool results** | Intentional last resort with `confirm_redaction` | Retained; Skill + docs prefer inject |
| M4 | **CLI `--value` on argv** | Visible in process listings / shell history | Documented; prefer hidden prompt / stdin. (`--passphrase` no longer applies) |
| M5 | **Audit log readable without unlock** | `listAudit` reads `audit.jsonl` | Moot — there is no unlock; log holds no values |

### Low / UX

| ID | Finding | Status |
| --- | --- | --- |
| L1 | MCP Apps Vault Manager | **Shipped** as status-only `vault_manager` + `ui://` resource; not an add/remove path |
| L2 | Competing skill wording across cache vs repo | Repo skill/command aligned Install → Setup → Use, Terminal-only |
| L3 | `listAudit` actor strings mixed (`human` / `mcp-agent`) | Acceptable for MVP |
| L4 | Soft-compat passphrase / unlock tools still registered | Open — see [LEGACY_CODE.md](./LEGACY_CODE.md) |

## Trust boundary — `inject_secret` (summary)

See [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) for the full diagram. Chat may see handle + path; plaintext lives in `secrets.json`, the inject file, and process memory. Clients that `cat` either file into chat defeat the design — Skill/hooks mitigate, do not guarantee.

## Test / build gaps

- No e2e against a live Cursor host (practical limit) — covered by unit/integration contracts.
- No dedicated lint config per package (`lint --if-present` no-ops).
- Plugin dist must be rebuilt after MCP or CLI changes (`pnpm build:plugin`).
- Crypto/session tests still exercise legacy modules that the product no longer calls.

## Non-goals honored

- Did not touch `~/.password-space` in tests (temp dirs only).
- Legacy `vault.db` is never deleted or auto-migrated.
- Did not force-push history rewrite of public `main`.
