---
description: Set up Password Space — one clear next step, no passphrase in chat
---

Setup for a **non-technical** user. **Never** ask for passphrase or tokens in chat. **Never** ask them to edit `mcp.json`.

## Start

1. Call **`vault_onboard`**.
2. Read **`primary_action`** aloud in plain language — that is the **only** next step.
3. Do **not** offer CLI and in-chat setup as competing choices.
4. Ignore `advanced_escape_hatch` unless the user asks for Terminal.

## If Node is too old (`primary_action.id` = `fix_node`)

Tell them to install **Node.js 20+** from https://nodejs.org, reload Cursor, then run this command again.

## If vault does not exist (`primary_action.id` = `vault_init` or `vault_init_env`)

Call **`vault_init`**. Insist they enter the passphrase in the **approval form** — **never** approve empty `{}`.

## If vault exists but locked (`primary_action.id` = `vault_unlock` / `vault_unlock_env`)

Call **`vault_unlock`** — **do not** call `vault_init` again.

## If vault ready

**`vault_set_secret`** — name and value in approval form only.

## Rules

- One primary action per turn until `vault_status` shows unlocked.
- Summarize errors using **`howToFix` / `recovery`** — never dump JSON.
- Confirm success without secret values.
- Passphrase never via elicitation — only tool args, MCP Environment, or advanced CLI.
