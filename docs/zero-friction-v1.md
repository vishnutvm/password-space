# Zero-Friction Onboarding v1

**Product journey:** Install → One-time Setup → Start Using  
**Notion brief:** https://app.notion.com/p/402d48599a998156adbffc0fa2993444  
**Audience:** External Cursor users who must not edit `mcp.json` or learn MCP/CLI.

## Shipped in this slice

| Piece | Behavior |
| --- | --- |
| **`vault_onboard` / `vault_status`** | Prerequisite check (Node ≥ 20), `setup_state`, single `primary_action`, recovery copy for interrupted / existing vault |
| **Passphrase channel** | Tool approval args, optional `PASSWORD_SPACE_PASSPHRASE`, or advanced CLI — **never** elicitation |
| **Skill + `/setup-password-space`** | One newcomer path; CLI only as `advanced_escape_hatch` |
| **Errors** | Clear `howToFix` for missing Node, empty `{}` approval, already-initialized vault |
| **Docs** | [EXTERNAL_USER_INSTALL.md](./EXTERNAL_USER_INSTALL.md) is the single external page |

## Design: Welcome without MCP Apps (v1)

SDK **`@modelcontextprotocol/sdk` ^1.32** supports:

- **`elicitation/create`** via `server.elicitInput` (form + URL modes) — for **non-sensitive** input only
- **MCP Apps** UI — **not** in the core SDK; requires `@modelcontextprotocol/ext-apps`, `ui://` HTML resources, and host support

**Decision for v1:** Ship a rich structured `vault_onboard` payload (`human_summary`, `primary_action`, `recovery`, `checklist`) that agents narrate in plain language. **Do not** put the master passphrase in elicitation (MCP spec forbids sensitive elicitation).

### Passphrase UX (locked)

1. Primary: Cursor **tool approval form** on `vault_init` / `vault_unlock` / `vault_set_secret`
2. Optional: MCP Environment `PASSWORD_SPACE_PASSPHRASE`
3. Advanced: CLI `password-space setup`

## MCP Apps — Vault Manager (shipped)

Pinned **`@modelcontextprotocol/ext-apps@^1.7.5`** (SDK 1.x line) and Cursor host support for MCP Apps (2.6+).

| Piece | Behavior |
| --- | --- |
| Tool | `vault_manager` via `registerAppTool` + `ui://password-space/vault-manager.html` |
| UI | List / add / update / remove credentials, lock / unlock, change passphrase |
| Passphrase | App form → `callServerTool` args (**not** elicitation) |
| Progressive enhancement | Same tool returns structured JSON when Apps UI is unavailable |

Install→Setup→Use is **not** blocked on Apps — slash + `vault_onboard` remains the newcomer path; Vault Manager is the premium daily-use surface.

## Acceptance mapping

| Criterion | v1 coverage |
| --- | --- |
| Install without prior knowledge | Marketplace + `/setup-password-space` |
| Detect prerequisites | `prerequisites` / `fix_node` primary action |
| Idempotent / recoverable init | `vault_already_exists` → unlock; `setup_incomplete` recovery |
| Passphrase clear + secure | Form / env / CLI; elicitation explicitly avoided |
| No manual MCP JSON | Skill + docs forbid `mcp.json` edits |
| First secret + inject | Unchanged tools after unlock |
| Restart safe | Session TTL + unlock path (vault ciphertext persists) |
| Failure → recovery | `recovery` / `howToFix` on tools + errors |
| No secrets in chat/logs | Existing redact contracts |

## Agent contract

- Follow **`primary_action` only** — do not present competing CLI vs slash options
- Never call elicitation for passphrase or secret values
- Never instruct users to edit `mcp.json`
