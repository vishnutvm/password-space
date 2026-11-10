# Password Space — Engineering Report

**Date:** 2026-11-10 · Branch: `feat/vault-manager-apps` · Author identity: `vishnutvm`

## Verified

| Item | Evidence |
| --- | --- |
| Source audit of vault / CLI / MCP / plugin | [AUDIT.md](./AUDIT.md) |
| Security lifecycle + `inject_secret` trust boundary | [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) |
| Inject TTL cleanup | `clearExpiredInjectFiles` + tests |
| Unlock throttling | `unlock-guard.ts` + wired into unlock / change-passphrase |
| Change passphrase | vault store + MCP + CLI |
| `vault_delete_secret` | MCP tool + tests |
| MCP Apps Vault Manager | `vault_manager` + `ui://password-space/vault-manager.html`; `@modelcontextprotocol/ext-apps@1.7.5`; Cursor Apps supported (2.6+) |
| Progressive enhancement | Tool JSON always returned; UI is host-optional |
| Passphrase never via elicitation | Onboarding + App form + approval args / env / CLI only |
| Onboarding Install→Setup→Use | `docs/onboarding.md`, skill, `/setup-password-space` |
| Unit / integration / security leak tests | vault 21 + mcp 18 green |
| `pnpm -r build`, `build:plugin`, typecheck (tsc) | Green |
| Git fingerprint scrub | Remote + local `cursor/*` branches deleted (merged into main); new work on `feat/vault-manager-apps` |
| No touch of `~/.password-space` in tests | Temp dirs only |

## Deferred

| Item | Reason |
| --- | --- |
| Full e2e in live Cursor chat iframe | Requires host interactive session; App HTML + tool contracts covered in unit tests |
| Argon2id / crypto rewrite | No evidence current scrypt+AES-GCM is broken; preserve working crypto |
| Hardware-backed keys / OS keychain | Out of MVP scope |
| Per-secret MCP ACLs | Out of MVP scope |
| History rewrite of public `main` agent-y merge subjects | Already public; left intact per mandate |
| Package-level ESLint config | `lint --if-present` no-ops; no regressions introduced |

## Needs external audit

- Session file design (fileKey colocated with wrapped vault key)
- Inject file residual risk (same-user disk access)
- Marketplace threat model when MCP is unlocked
- Independent review before positioning as OS-keychain replacement

## Branch / PR hygiene

- **Deleted remote:** `cursor/onboarding-ux-redesign`, `cursor/plugin-schema-fix-2161`, `cursor/premium-onboarding`, `cursor/vault-home-placeholder-663d`, `cursor/vault-mcp-setup-ux-7fec`, `cursor/zero-friction-onboard`, `cursor/zero-friction-v1-c180`
- **Deleted local:** same set + `cursor/remove-plugin-variables-a11d`
- **Working branch:** `feat/vault-manager-apps` (not `cursor/`)
