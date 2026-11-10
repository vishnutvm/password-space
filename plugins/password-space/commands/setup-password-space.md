---
description: Set up Password Space — CLI-first when Cursor has no passphrase field
---

Setup for a **non-technical** user. **Never** ask for passphrase or tokens in chat. **Never** ask them to edit `mcp.json`.

## Start

1. Call **`vault_onboard`**.
2. Read **`primary_action`** aloud in plain language — that is the **only** next step.
3. If `recommended_path` / `primary_action.id` is **`cli_setup`** or **`cli_unlock`**: show **`copy_paste_command`** and wait for them to finish in Terminal. Then call **`vault_status`**.
4. **Do not** ask them to reply "ready" and then call `vault_init` with empty `{}`.

## If Node is too old (`primary_action.id` = `fix_node`)

Tell them to install **Node.js 20+** from https://nodejs.org, reload Cursor, then run this command again.

## If vault does not exist (`cli_setup` / `vault_init_env`)

- **`cli_setup` (default):** show Terminal `copy_paste_command` (e.g. `pnpm password-space setup`).
- **`vault_init_env`:** call **`vault_init`** once (passphrase already in MCP Environment).
- Alternatives (only if listed): MCP Environment, `vault_manager` App, or approval form **when a passphrase field is visible**.

## If vault exists but locked (`cli_unlock` / `vault_unlock_env`)

- **`cli_unlock`:** show unlock `copy_paste_command`.
- **`vault_unlock_env`:** call **`vault_unlock`**.
- **Do not** call `vault_init` again.

## If vault ready

Prefer **`vault_manager`** if Apps UI may render; else **`vault_set_secret`** — name and value in approval form only.

## If `passphrase_missing` / empty `{}`

Stop the loop. Show `copy_paste_command` or MCP Environment path from the error payload. Do **not** retry `vault_init`.

## Rules

- One primary action per turn until `vault_status` shows unlocked.
- Summarize errors using **`howToFix` / `recovery` / `host_limitation`** — never dump JSON.
- Confirm success without secret values.
- Passphrase never via elicitation — only CLI, MCP Environment, Vault Manager App, or a visible approval-form field.
