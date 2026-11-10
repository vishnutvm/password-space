# Zero-Friction Onboarding v1 (UI / chat first)

**Product journey:** Install → One-time Setup → Start Using  
**Notion brief:** https://app.notion.com/p/402d48599a998156adbffc0fa2993444  
**Audience:** External Cursor users who must not edit `mcp.json`, learn MCP jargon, or be pushed into Terminal.

## Shipped in this slice

| Piece | Behavior |
| --- | --- |
| **`vault_onboard` / `vault_status`** | Prerequisite check (Node ≥ 20), `setup_state`, single `primary_action`, `host_limitation`, `recommended_path` |
| **Default passphrase channel** | **`vault_manager`** App first; then approval-form `vault_init` / `vault_unlock`; optional MCP Environment |
| **Optional env** | `PASSWORD_SPACE_PASSPHRASE` avoids empty-form pain when set under MCP Environment |
| **Skill + `/setup-password-space`** | Forbids "reply ready → vault_init {}" loop; follows UI-first `primary_action`; CLI only via `advanced_escape_hatch` |
| **Errors** | `passphrase_missing` includes `host_limitation`, `recommended_path: "vault_manager"` |
| **Docs** | [EXTERNAL_USER_INSTALL.md](./EXTERNAL_USER_INSTALL.md) is the single external page |

## Design: Welcome without Terminal

SDK **`@modelcontextprotocol/sdk` ^1.32** supports:

- **`elicitation/create`** via `server.elicitInput` (form + URL modes) — for **non-sensitive** input only
- **MCP Apps** UI — requires `@modelcontextprotocol/ext-apps`, `ui://` HTML resources, and host support (Cursor 2.6+)

**Decision:** Do **not** put the master passphrase in elicitation. Prefer **Vault Manager** + approval-form / MCP Environment for newcomers. Terminal CLI is power-user only.

### Passphrase UX (current)

1. **Primary:** `vault_manager` (App UI when Cursor renders MCP Apps)
2. **Fallback:** MCP approval form — `vault_init` / `vault_unlock` with a visible passphrase field
3. **Optional:** MCP Environment `PASSWORD_SPACE_PASSPHRASE` → `vault_init {}` / `vault_unlock {}`
4. **Power users only:** Terminal `password-space setup` / `unlock` (`advanced_escape_hatch`)

## MCP Apps — Vault Manager

Pinned **`@modelcontextprotocol/ext-apps@^1.7.5`** (SDK 1.x line).

| Piece | Behavior |
| --- | --- |
| Tool | `vault_manager` via `registerAppTool` + `ui://password-space/vault-manager.html` |
| Binding | `_meta.ui.resourceUri` on tool registration **and** tool result |
| UI | List / add / update / remove credentials, lock / unlock, change passphrase |
| Passphrase | App form → `callServerTool` args (**not** elicitation) |
| Progressive enhancement | Same tool returns structured JSON + `apps_fallback` (approval form / env) when Apps UI is unavailable |

Install→Setup→Use is **not** blocked on Apps — approval form / Environment remain available. Terminal is not the newcomer path.

## Agent contract

- Follow **`primary_action` only**
- When `recommended_path` is `vault_manager`, call **`vault_manager` first**
- Never tell the user to reply **"ready"** then call `vault_init` without a passphrase channel
- Never call elicitation for passphrase or secret values
- Never instruct users to edit `mcp.json`
- Never lead with Terminal / `pnpm password-space setup` unless the user asks
