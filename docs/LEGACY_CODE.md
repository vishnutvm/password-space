# Leftover encrypted-vault code

**As of:** 2026-11-17 (`main` after PR #13). The product path is the plain JSON store (`secrets.json`). The code below is from the encrypted vault and unlock-session design. **None of it has been deleted** — this list is the starting point for a cleanup decision.

"Dead" means nothing on the product path calls it. "Soft-compat" means it is still reachable (registered tool, CLI command, exported API) but does nothing useful.

## Dead: no production callers

| Location | What | Only used by |
| --- | --- | --- |
| `packages/vault/src/crypto.ts` (whole file) | scrypt KDF, AES-256-GCM `encrypt`/`decrypt`, `packBlob`/`unpackBlob`, `randomKey`/`randomSalt`, `safeEqual`, constants | `crypto.test.ts` |
| `packages/vault/src/crypto.test.ts` | Tests for the above | — |
| `packages/vault/src/unlock-guard.ts` (whole file) | `beforeUnlockAttempt`, `recordUnlockFailure`, `recordUnlockSuccess` (brute-force throttle) | Nothing |
| `packages/vault/src/session.ts` — all exports except `clearSession` | `writeSession`, `readSession`, `hasValidSession`, `formatSessionExpiry`, `parseSessionTtlInput`, `DEFAULT_TTL_MS`, `SESSION_TTL_1_DAY_MS`, `SESSION_TTL_1_WEEK_MS`, `SessionInfo` | `store.test.ts` session cases |
| `packages/vault/src/index.ts` — `changeVaultPassphrase` | Calls `store.changePassphrase`, which always throws | Nothing (MCP tool no longer calls it) |
| `packages/vault/src/store.ts` — `unlockWithKey`, `changePassphrase` | No-op / always throws | Nothing |
| `packages/vault/src/types.ts` — `VaultError` codes `LOCKED`, `WRONG_PASSPHRASE` | Error codes | `LOCKED` only thrown by dead `readSession` |
| `packages/mcp-server/src/tools.ts` — `resolvePassphrase` | Reads `passphrase` arg / `PASSWORD_SPACE_PASSPHRASE` | Nothing |
| `packages/mcp-server/src/tools.ts` — `PrimaryAction` ids `cli_unlock`, `vault_unlock`, `vault_init_env`, `vault_unlock_env` and `recommended_path: "cli_unlock"` | Type union members | Never produced |
| `packages/mcp-server/src/tools.ts` — `_unlocked` params on onboarding helpers | Unused parameters | — |

## Soft-compat: reachable but no-op

| Location | Behavior today |
| --- | --- |
| MCP `vault_unlock` (`index.ts`, `vaultUnlockTool`) | Returns `unlocked: true, deprecated: true`. Side effects: clears expired inject files and any leftover `session` file |
| MCP `vault_lock` (`vaultLockTool`) | Returns `locked: false, deprecated: true`. Same cleanup side effects |
| MCP `vault_change_passphrase` (`vaultChangePassphraseTool`) | Returns `ok: false, code: "passphrase_not_used"` |
| MCP `vault_init` `passphrase` arg, `passphraseSchema` / `optionalPassphraseShape` | Accepted and ignored |
| MCP `PassphraseRequiredError` (`code: "passphrase_missing"`) | Still handled in `errorResult`; nothing throws it except dead `resolvePassphrase` |
| MCP status fields `unlocked`, `lock_unlock_needed: false`, `passphrase_env_configured` | Always `true` / `false` / reads an env var nothing uses |
| `vault-manager-ui.ts` `unlocked` / `lock_unlock_needed` | Displays the always-true fields |
| CLI `unlock`, `lock`, `change-passphrase` | Print "not needed" notices |
| `packages/vault/src/index.ts` — `unlockVaultToSession`, `lockVaultSession` | Used by the soft-compat MCP tools above for cleanup only |
| `packages/vault/src/store.ts` — `unlock`, `lock`, `isUnlocked`, `init(_passphrase)`, `dbPath` alias | No-ops / aliases kept so call sites compile |
| `packages/vault/src/paths.ts` — `sessionPath`, `storeFilePath` alias | Used only to clear the legacy `session` file |

## Still needed (do not remove with the above)

| Location | Why |
| --- | --- |
| `vaultDbPath`, `hasLegacyEncryptedVault` | Detect an old `vault.db` so onboarding can tell the user to re-add secrets |
| `clearSession` + `sessionPath` | Remove a leftover `session` file (it holds a wrapped vault key from the old design) |
| `clearExpiredInjectFiles` | Inject TTL enforcement — not legacy |

## Suggested cleanup order (when decided)

1. Delete `crypto.ts`, `crypto.test.ts`, `unlock-guard.ts`, and the session read/write half of `session.ts` with its tests.
2. Drop `vault_change_passphrase`, then `vault_unlock` / `vault_lock` after a release that warns callers. Keep the inject cleanup by calling `clearExpiredInjectFiles` directly.
3. Remove the passphrase schemas, `resolvePassphrase`, `PassphraseRequiredError`, dead `PrimaryAction` ids, and the `unlocked` / `passphrase_env_configured` status fields (coordinate with the Vault Manager UI).
4. Rebuild `plugins/password-space/dist` (`pnpm build`) so the bundle drops the code too.
