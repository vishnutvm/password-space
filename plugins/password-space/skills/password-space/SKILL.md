---
name: password-space
description: Install · One-time Setup · Start Using. Follow vault_onboard primary_action — default is plugin-bundled Terminal CLI for create/unlock/add; never ask users to edit mcp.json or clone the repo.
---

# Password Space

Encrypted vault on the user's Mac. **One obvious next step** — follow `primary_action` only.

## Newcomer path (default = plugin Terminal CLI)

1. User runs **`/setup-password-space`** (or asks to set up Password Space).
2. Call **`vault_onboard`**.
3. Follow **`primary_action.do_this` exactly**.
4. When `recommended_path` is **`cli_setup`** / **`cli_unlock`** / **`cli_set`** (usual case):
   - Show **`copy_paste_command`** (Terminal).
   - Typical form: `node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup|unlock|set` (or absolute path when MCP resolves the bundled CLI).
   - Tell the user to run it and enter passphrase / name / value at the prompts (passphrase and values are hidden).
   - **Do not** call `vault_init` / `vault_set_secret` until they finish Terminal steps (then `vault_status` / `list_secrets`).
5. **No `git clone`.** The CLI ships inside the marketplace plugin. Clone is optional for contributors only.
6. Passphrase and secret **name + value** go in **Terminal** — **never** in chat, **never** via elicitation, **never** as the default MCP App form path.

### Never do this (causes empty `{}` / `passphrase_missing` loop)

- Ask the user to reply **"ready"** then call **`vault_init`** / **`vault_unlock`** without a passphrase channel
- Approve **`vault_init`** / **`vault_unlock`** with empty **`{}`** when Cursor shows no passphrase field
- Retry `vault_init` after `passphrase_missing` — switch to Terminal or MCP Environment instead
- Lead with Vault Manager / approval-form fields for create, unlock, or add
- Tell newcomers to clone the repo or run `pnpm install` for day-1 setup

### One-click alternative (no Terminal passphrase)

**Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE` (8+ chars), then call `vault_init` / `vault_unlock` with `{}`.

### Vault Manager App (optional status)

Call **`vault_manager`** only for optional status when Apps render. Prefer Terminal for create / unlock / add. If only JSON returns (`apps_fallback`), follow its Terminal `copy_paste_command`.

## After vault exists

- **Terminal set** (`copy_paste_command` / `…/dist/cli.js set`) — primary way to add name + value
- **`list_secrets`** / **`vault_status`** / **`inject_secret`** / **`vault_lock`** — MCP after unlock
- **`vault_manager`** — optional status UI only
- **`vault_delete_secret`** / **`vault_change_passphrase`** when needed

## Never

- Passphrase or secret values in chat
- Ask the user to edit **`mcp.json`** or explain MCP
- Call **`vault_init`** again when `setup_state` is `needs_unlock` / vault already exists
- Mention **Plugins → Configure** for vault home (removed — default is `~/.password-space`)
- Dump Vault Manager App HTML/JS / MCP resource bodies into chat

Vault home defaults to **`~/.password-space`**. Optional override: a real absolute `PASSWORD_SPACE_HOME` in the process / MCP Environment (never an unresolved `${PASSWORD_SPACE_HOME}`).

Safe line: *"Next step: open Terminal and paste this command. Type your passphrase there (hidden). I won't ask for it in chat. No clone needed."*
