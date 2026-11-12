---
description: Set up Password Space — Terminal-first for create, unlock, and add
---

Setup for a **non-technical** user. **Never** ask for passphrase or tokens in chat. **Never** ask them to edit `mcp.json`. **Default path is Terminal** with the **plugin-bundled CLI** (no repo clone).

## Start

1. Call **`vault_onboard`**.
2. Read **`primary_action`** aloud in plain language — that is the **only** next step.
3. If `recommended_path` / `primary_action.id` is **`cli_setup`**, **`cli_unlock`**, or **`cli_set`**: show **`copy_paste_command`** and wait for them to finish in Terminal. Then call **`vault_status`** / **`list_secrets`**.
4. **Do not** ask them to reply "ready" and then call `vault_init` with empty `{}`.
5. **Do not** tell them to `git clone` — the CLI is at `${CURSOR_PLUGIN_ROOT}/dist/cli.js` after plugin install + Reload.

## If Node is too old (`primary_action.id` = `fix_node`)

Tell them to install **Node.js 20+** from https://nodejs.org, reload Cursor, then run this command again.

## If vault does not exist (`cli_setup` / `vault_init_env`)

- **`cli_setup` (default):** show Terminal `copy_paste_command` (typically `node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup`, or an absolute path when MCP resolves it).
- **`vault_init_env`:** call **`vault_init`** once (passphrase already in MCP Environment).
- Alternatives (only if listed): MCP Environment. Vault Manager is optional status only.

## If vault exists but locked (`cli_unlock` / `vault_unlock_env`)

- **`cli_unlock`:** show unlock `copy_paste_command`.
- **`vault_unlock_env`:** call **`vault_unlock`**.
- **Do not** call `vault_init` again.

## If vault ready (`cli_set`)

Show Terminal **`copy_paste_command`** for set (prompts for name, then hidden value). After they finish, confirm with **`list_secrets`** / **`vault_status`**. Prefer **`inject_secret`** for agent use.

## If `passphrase_missing` / empty `{}`

Stop the loop. Show `copy_paste_command` or MCP Environment path from the error payload. Do **not** retry `vault_init`. Do **not** push Vault Manager forms as the default.

## Rules

- One primary action per turn until `vault_status` shows unlocked.
- Summarize errors using **`howToFix` / `recovery` / `host_limitation`** — never dump JSON.
- Confirm success without secret values.
- Passphrase and secret values never via elicitation — Terminal (hidden), optional MCP Environment, or a visible approval-form field only as last resort.
- Do **not** mention Plugins → Configure for vault home (defaults to `~/.password-space`).
