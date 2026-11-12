# Zero-Friction Onboarding v1 (Terminal-first)

**Product journey:** Install → One-time Setup → Start Using  
**Notion brief:** https://app.notion.com/p/402d48599a998156adbffc0fa2993444  
**Audience:** External Cursor users who must not edit `mcp.json`, learn MCP jargon, or **clone the repo**. Passphrase and secret **name + value** are entered in **Terminal** via the **plugin-bundled CLI**.

## Shipped in this slice

| Piece | Behavior |
| --- | --- |
| **`vault_onboard` / `vault_status`** | Prerequisite check (Node ≥ 20), `setup_state`, single `primary_action`, `host_limitation`, `recommended_path` |
| **Default passphrase / secret channel** | **Terminal** `node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup\|unlock\|set` (hidden prompts) |
| **Plugin bundle** | `dist/index.js` (MCP) + `dist/cli.js` (Terminal CLI) — both from `pnpm build` / `scripts/bundle-mcp.mjs` |
| **Optional env** | `PASSWORD_SPACE_PASSPHRASE` avoids empty-form pain when set under MCP Environment |
| **Skill + `/setup-password-space`** | Forbids "reply ready → vault_init {}" loop; follows Terminal-first `primary_action`; no clone-first |
| **Errors** | `passphrase_missing` includes `host_limitation`, `recommended_path: "cli_setup"`, `copy_paste_command` |
| **Configure UI** | Removed — no `variables` in plugin.json; vault home defaults to `~/.password-space` |
| **Docs** | [EXTERNAL_USER_INSTALL.md](./EXTERNAL_USER_INSTALL.md) is the single external page |

## Design: Terminal for sensitive input

SDK **`@modelcontextprotocol/sdk` ^1.32** supports:

- **`elicitation/create`** via `server.elicitInput` (form + URL modes) — for **non-sensitive** input only
- **MCP Apps** UI — optional status; not the primary create/unlock/add path

**Decision:** Do **not** put the master passphrase or secret values in elicitation or as the default App form path. Prefer **Terminal** (TTY raw-mode hidden input). Optional MCP Environment for passphrase-only.

### Passphrase / secret UX (current)

1. **Primary:** Plugin Terminal CLI `setup` / `unlock` / `set` (no clone)
2. **Optional:** MCP Environment `PASSWORD_SPACE_PASSPHRASE` → `vault_init {}` / `vault_unlock {}`
3. **Optional status:** `vault_manager` when MCP Apps render (not for primary add)
4. **Contributors only:** clone + `pnpm password-space …`

## MCP Apps — Vault Manager (optional)

Pinned **`@modelcontextprotocol/ext-apps@^1.7.5`** (SDK 1.x line).

| Piece | Behavior |
| --- | --- |
| Tool | `vault_manager` via `registerAppTool` + `ui://password-space/vault-manager.html` |
| Role | Optional status / list when Apps UI appears |
| Progressive enhancement | Same tool returns structured JSON + `apps_fallback` pointing at Terminal |

## Agent contract

- Follow **`primary_action` only**
- When `recommended_path` is `cli_setup` / `cli_unlock` / `cli_set`, show **`copy_paste_command`** and wait
- Never tell the user to reply **"ready"** then call `vault_init` without a passphrase channel
- Never call elicitation for passphrase or secret values
- Never instruct users to edit `mcp.json` or clone for day-1 setup
- Never mention Plugins → Configure for vault home
