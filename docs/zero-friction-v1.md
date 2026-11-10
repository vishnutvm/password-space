# Zero-Friction Onboarding v1 (+ passphrase UX fallback)

**Product journey:** Install → One-time Setup → Start Using  
**Notion brief:** https://app.notion.com/p/402d48599a998156adbffc0fa2993444  
**Audience:** External Cursor users who must not edit `mcp.json` or learn MCP jargon.

## Shipped in this slice

| Piece | Behavior |
| --- | --- |
| **`vault_onboard` / `vault_status`** | Prerequisite check (Node ≥ 20), `setup_state`, single `primary_action`, `host_limitation`, `recommended_path`, `copy_paste_command` |
| **Default passphrase channel** | **Terminal CLI** (`pnpm password-space setup` / `password-space setup`) when MCP Environment is unset |
| **Alternatives** | MCP Environment `PASSWORD_SPACE_PASSPHRASE`; Vault Manager App (if host renders Apps); approval form only when a field is visible |
| **Skill + `/setup-password-space`** | Forbids "reply ready → vault_init {}" loop; follows CLI-first `primary_action` |
| **Errors** | `passphrase_missing` includes `host_limitation`, `recommended_path: "cli_setup"`, Mac copy-paste commands |
| **Docs** | [EXTERNAL_USER_INSTALL.md](./EXTERNAL_USER_INSTALL.md) is the single external page |

## Design: Welcome without relying on approval forms

SDK **`@modelcontextprotocol/sdk` ^1.32** supports:

- **`elicitation/create`** via `server.elicitInput` (form + URL modes) — for **non-sensitive** input only
- **MCP Apps** UI — requires `@modelcontextprotocol/ext-apps`, `ui://` HTML resources, and host support (Cursor 2.6+)

**Decision:** Do **not** put the master passphrase in elicitation. Prefer **CLI** for newcomers when the host cannot collect passphrase; keep MCP Environment as one-click; treat approval-form `vault_init` as last resort.

### Passphrase UX (current)

1. **Primary:** Terminal `password-space setup` / `pnpm password-space setup`
2. **One-click:** MCP Environment `PASSWORD_SPACE_PASSPHRASE` → `vault_init {}`
3. **App:** `vault_manager` when MCP Apps UI renders (`apps_fallback` otherwise)
4. **Last resort:** Cursor tool approval form — only if a passphrase field is actually shown

## MCP Apps — Vault Manager

Pinned **`@modelcontextprotocol/ext-apps@^1.7.5`** (SDK 1.x line).

| Piece | Behavior |
| --- | --- |
| Tool | `vault_manager` via `registerAppTool` + `ui://password-space/vault-manager.html` |
| Binding | `_meta.ui.resourceUri` on tool registration **and** tool result |
| UI | List / add / update / remove credentials, lock / unlock, change passphrase |
| Passphrase | App form → `callServerTool` args (**not** elicitation) |
| Progressive enhancement | Same tool returns structured JSON + `apps_fallback` when Apps UI is unavailable |

Install→Setup→Use is **not** blocked on Apps — CLI / Environment remain the reliable newcomer paths.

## Agent contract

- Follow **`primary_action` only**
- When `recommended_path` is `cli_setup` / `cli_unlock`, show `copy_paste_command` — do not call `vault_init` with empty `{}`
- Never tell the user to reply **"ready"** then call `vault_init` without a passphrase channel
- Never call elicitation for passphrase or secret values
- Never instruct users to edit `mcp.json`
