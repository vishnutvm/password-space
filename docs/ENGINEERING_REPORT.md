# Password Space — Engineering Report

**Date:** 2026-11-10 · **Revised:** 2026-11-17 for the plain JSON store · Author identity: `vishnutvm`

> **Status.** The original report covered the encrypted vault on `feat/vault-manager-apps`. PR #13 (merged 2026-11-17) replaced it with a plain JSON store: `~/.password-space/secrets.json`, mode `0600`, no passphrase, no unlock, no encryption. Rows below reflect the current state; rows that only applied to the encrypted vault are marked **Retired**.

## Verified

| Item | Evidence |
| --- | --- |
| Source audit of vault / CLI / MCP / plugin | [AUDIT.md](./AUDIT.md) |
| Security model + `inject_secret` trust boundary | [SECURITY_AUDIT.md](./SECURITY_AUDIT.md), [SECURITY.md](../SECURITY.md) |
| Plain JSON store | `packages/vault/src/store.ts` — atomic write via temp file + rename, `chmod 0600` |
| Inject TTL cleanup | `clearExpiredInjectFiles` + tests |
| `vault_delete_secret` | MCP tool + tests |
| Legacy `vault.db` detection | `hasLegacyEncryptedVault`; surfaced by `vault_onboard` / CLI `status`; never deleted or migrated |
| MCP Apps Vault Manager | `vault_manager` + `ui://password-space/vault-manager.html`; status-only, not an add path |
| Progressive enhancement | Tool JSON always returned; UI is host-optional |
| Onboarding Install → Setup → Use | Terminal-only via plugin-bundled `dist/cli.js`; `docs/onboarding.md`, skill, `/setup-password-space` |
| Unit / integration / security leak tests | vault 23 + mcp-server 24 + html script 4, green 2026-11-17 |
| `pnpm -r build`, `build:plugin`, typecheck (tsc) | Green |
| No touch of `~/.password-space` in tests | Temp dirs only |
| Unlock throttling | **Retired** — `unlock-guard.ts` is no longer called |
| Change passphrase | **Retired** — MCP returns `code: "passphrase_not_used"`; CLI prints a notice |
| Passphrase never via elicitation | **Retired** — there is no passphrase. Secret values are still never collected via elicitation or App forms |

## Deferred

| Item | Reason |
| --- | --- |
| Full e2e in live Cursor chat iframe | Requires host interactive session; App HTML + tool contracts covered in unit tests |
| At-rest encryption / OS keychain | Product decision: keep secrets out of chat, not off disk. Revisit only with an explicit product call (see CONTRIBUTING.md) |
| Removing legacy crypto/session code and soft-compat tools | Listed in [LEGACY_CODE.md](./LEGACY_CODE.md); kept for compatibility for now |
| Per-secret MCP ACLs | Out of MVP scope |
| Package-level ESLint config | `lint --if-present` no-ops |

## Needs external review

- Inject file residual risk (same-user disk access)
- Marketplace threat model: the MCP server can read every value in `secrets.json` at any time
- Positioning: this is **not** a password-manager or OS-keychain replacement

## Branch / PR hygiene (2026-11-10, historical)

- **Deleted remote:** `cursor/onboarding-ux-redesign`, `cursor/plugin-schema-fix-2161`, `cursor/premium-onboarding`, `cursor/vault-home-placeholder-663d`, `cursor/vault-mcp-setup-ux-7fec`, `cursor/zero-friction-onboard`, `cursor/zero-friction-v1-c180`
- **Deleted local:** same set + `cursor/remove-plugin-variables-a11d`
