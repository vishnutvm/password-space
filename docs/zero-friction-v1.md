# Zero-Friction Onboarding v1 (Terminal-first)

**Product journey:** Install → One-time Setup → Start Using  
**Notion brief:** https://app.notion.com/p/402d48599a998156adbffc0fa2993444  
**Audience:** External Cursor users who must not edit `mcp.json`, learn MCP jargon, or **clone the repo**. Secret **name + value** are entered in **Terminal** via the **plugin-bundled CLI**. There is **no passphrase and no unlock** — the store is a plain JSON file (`~/.password-space/secrets.json`, mode `0600`).

## Shipped in this slice

| Piece | Behavior |
| --- | --- |
| **`vault_onboard` / `vault_status`** | Prerequisite check (Node ≥ 20), `setup_state`, single `primary_action`, `host_limitation`, `recommended_path` |
| **Default secret channel** | **Terminal** `node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup\|set\|remove` (hidden value prompt) |
| **Plugin bundle** | `dist/index.js` (MCP) + `dist/cli.js` (Terminal CLI) — both from `pnpm build` / `scripts/bundle-mcp.mjs` |
| **Skill + `/setup-password-space`** | Forbids "reply ready → vault_init {}" loop; follows Terminal-first `primary_action`; no clone-first |
| **Legacy vault** | `vault_onboard` reports `legacy_encrypted_vault` when an old `vault.db` exists; user re-adds secrets with `set`. Nothing is migrated or deleted |
| **Configure UI** | Removed — no `variables` in plugin.json; store home defaults to `~/.password-space` |
| **Docs** | [EXTERNAL_USER_INSTALL.md](./EXTERNAL_USER_INSTALL.md) is the single external page |

## Design: Terminal for sensitive input

SDK **`@modelcontextprotocol/sdk` ^1.32** supports:

- **`elicitation/create`** via `server.elicitInput` (form + URL modes) — for **non-sensitive** input only
- **MCP Apps** UI — optional status; not the add/remove path

**Decision:** Do **not** put secret values in elicitation or App forms. Use **Terminal** (TTY raw-mode hidden input).

### Secret UX (current)

1. **Primary:** Plugin Terminal CLI interactive menu / `setup` / `set` / `remove` (no clone)
2. **Do not** guide App forms for add/remove — `vault_manager` is status-only
3. **Contributors only:** clone + `pnpm password-space …`

`unlock`, `lock`, and `change-passphrase` still exist in the CLI and as MCP tools for compatibility. They are no-ops (or return a deprecation error) and are never part of a `primary_action`.

## MCP Apps — Vault Manager (status-only; not a setup path)

Pinned **`@modelcontextprotocol/ext-apps@^1.7.5`** (SDK 1.x line).

| Piece | Behavior |
| --- | --- |
| Tool | `vault_manager` via `registerAppTool` + `ui://password-space/vault-manager.html` |
| Role | Optional status / list when Apps UI appears |
| Progressive enhancement | Same tool returns structured JSON + `apps_fallback` pointing at Terminal |

## Agent contract

- Follow **`primary_action` only**
- When `recommended_path` is `cli_setup` / `cli_set`, show **`copy_paste_command`** and wait
- Never tell the user to reply **"ready"** then call `vault_init`
- Never ask for a passphrase or call `vault_unlock` before `inject_secret`
- Never call elicitation for secret values
- Never instruct users to edit `mcp.json` or clone for day-1 setup
- Never mention Plugins → Configure for the store home
