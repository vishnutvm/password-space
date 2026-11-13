---
description: Set up Password Space — Terminal-only interactive CLI for setup, add, remove (no unlock)
---

Setup for a **non-technical** user. **Never** ask for tokens in chat. **Never** ask them to edit `mcp.json`. **Sole human path is Terminal** with the **plugin-bundled CLI** (no repo clone). Lock/unlock are **not** needed.

## Start

1. Call **`vault_onboard`**.
2. Read **`primary_action`** aloud in plain language — that is the **only** next step.
3. If `recommended_path` / `primary_action.id` is **`cli_setup`** or **`cli_set`**: show **`copy_paste_command`** and wait for them to finish in Terminal. Then call **`vault_status`** / **`list_secrets`**.
4. **Do not** tell them to `git clone` — the CLI is at `${CURSOR_PLUGIN_ROOT}/dist/cli.js` after plugin install + Reload.
5. **Do not** call **`vault_manager`** or guide them to App forms for add / remove.
6. **Do not** require unlock or a passphrase.

## If Node is too old (`primary_action.id` = `fix_node`)

Tell them to install **Node.js 20+** from https://nodejs.org, reload Cursor, then run this command again.

## If store does not exist (`cli_setup`)

- Show Terminal `copy_paste_command` (typically `node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup`, or an absolute path when MCP resolves it).
- No passphrase. Creates `~/.password-space/secrets.json` (plain text, mode 0600).
- Then show **set** so they can name a secret.

## If store ready (`cli_set`)

Show Terminal **`copy_paste_command`** for set (or bare `cli.js` for the interactive menu). After they finish, confirm with **`list_secrets`** / **`vault_status`**. Prefer **`inject_secret`** for agent use by name.

## Legacy encrypted vault

If onboard reports `legacy_encrypted_vault`, say the old `vault.db` is left untouched — re-add secrets with Terminal `set`. Do not wipe or auto-migrate.

## Rules

- One primary action per turn until `vault_status` shows the store ready.
- Summarize errors using **`howToFix` / `recovery`** — never dump JSON.
- Confirm success without secret values.
- Secret values only via Terminal (hidden) — never elicitation, never chat, never App forms.
- Do **not** mention Plugins → Configure for vault home (defaults to `~/.password-space`).
- Lock / unlock / passphrase are not part of the product path.
