---
name: password-space
description: Install · One-time Setup · Start Using. Follow vault_onboard primary_action — default is Terminal CLI setup when Cursor cannot collect a passphrase; never ask users to edit mcp.json.
---

# Password Space

Encrypted vault on the user's Mac. **One obvious next step** — follow `primary_action` only.

## Newcomer path (default)

1. User runs **`/setup-password-space`** (or asks to set up Password Space).
2. Call **`vault_onboard`**.
3. Follow **`primary_action.do_this` exactly**.
4. When `recommended_path` is **`cli_setup`** (usual case without MCP Environment):
   - Show **`copy_paste_command`** (Terminal).
   - Tell the user to run it and enter a passphrase at the hidden prompts.
   - **Do not** call `vault_init` afterward until they finish CLI setup (then `vault_status`).
5. Passphrase goes in **Terminal CLI**, **MCP Environment**, or **Vault Manager App** — **never** in chat, **never** via elicitation.

### Never do this (causes empty `{}` / `passphrase_missing` loop)

- Ask the user to reply **"ready"** then call **`vault_init`** / **`vault_unlock`** without a passphrase channel
- Approve **`vault_init`** / **`vault_unlock`** with empty **`{}`** when Cursor shows no passphrase field
- Retry `vault_init` after `passphrase_missing` — switch to CLI or MCP Environment instead

### One-click alternative (no Terminal)

**Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE` (8+ chars), then call `vault_init` / `vault_unlock` with `{}`.

### Vault Manager App

Call **`vault_manager`** only as an alternative. If an App UI appears, use it. If only JSON returns (`apps_fallback`), the host lacks MCP Apps — use CLI setup.

## After vault exists

- **`vault_manager`** — interactive UI when Apps render; else tools / CLI
- **`vault_set_secret`** — approval form only (or App)
- **`vault_delete_secret`** / **`vault_change_passphrase`** when needed
- **`inject_secret`** — preferred for agents
- **`vault_lock`** when done

## Never

- Passphrase or secret values in chat
- Ask the user to edit **`mcp.json`** or explain MCP
- Call **`vault_init`** again when `setup_state` is `needs_unlock` / vault already exists
- Lead with MCP approval-form `vault_init` when `primary_action.id` is `cli_setup`

Safe line: *"Next step: open Terminal and paste this command to create your vault. I won't ask for your passphrase in chat."*
