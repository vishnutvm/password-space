---
description: Set up Password Space — Vault Manager / chat UI first (not Terminal)
---

Setup for a **non-technical** user. **Never** ask for passphrase or tokens in chat. **Never** ask them to edit `mcp.json`. **Never** lead with Terminal CLI.

## Start

1. Call **`vault_onboard`**.
2. Read **`primary_action`** aloud in plain language — that is the **only** next step.
3. If `recommended_path` / `primary_action.id` is **`vault_manager`**: call **`vault_manager`** next. Create or unlock in the App UI when it appears.
4. If only JSON returns (`apps_fallback`): follow its `next_tool` / approval-form or MCP Environment path — **not** Terminal.
5. **Do not** ask them to reply "ready" and then call `vault_init` with empty `{}`.

## If Node is too old (`primary_action.id` = `fix_node`)

Tell them to install **Node.js 20+** from https://nodejs.org, reload Cursor, then run this command again.

## If vault does not exist (`vault_manager` / `vault_init_env`)

- **`vault_manager` (default):** call **`vault_manager`** — create vault in App UI if it renders.
- **`vault_init_env`:** call **`vault_init`** once (passphrase already in MCP Environment).
- Alternatives (only if listed): MCP approval form (`vault_init` with a visible passphrase field) or MCP Environment.

## If vault exists but locked (`vault_manager` / `vault_unlock_env`)

- **`vault_manager`:** unlock in App UI; else **`vault_unlock`** with approval-form / env.
- **`vault_unlock_env`:** call **`vault_unlock`**.
- **Do not** call `vault_init` again.

## If vault ready

Prefer **`vault_manager`** if Apps UI may render; else **`vault_set_secret`** — name and value in approval form only.

## If `passphrase_missing` / empty `{}`

Stop the loop. Open **`vault_manager`**, use a visible approval-form field, or set **`PASSWORD_SPACE_PASSPHRASE`**. Do **not** retry `vault_init`. Do **not** push Terminal as the default.

## Rules

- One primary action per turn until `vault_status` shows unlocked.
- Summarize errors using **`howToFix` / `recovery` / `host_limitation`** — never dump JSON.
- Confirm success without secret values.
- Passphrase never via elicitation — only Vault Manager App, MCP Environment, or a visible approval-form field.
- Mention Terminal / CLI **only** if the user asks (`advanced_escape_hatch`).
