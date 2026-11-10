---
description: Set up Password Space — one clear next step, no passphrase in chat
---

Setup for a **non-technical** user. **Never** ask for passphrase or tokens in chat.

## Start

1. Call **`vault_onboard`**.
2. Read **`primary_action`** aloud in plain language — that is the **only** next step.
3. Do **not** offer multiple parallel paths unless `primary_action.or_alternative` exists.

## If vault does not exist yet (`primary_action.id` = `cli_setup`)

**Primary (do this first):** Tell the user to open Terminal and run **`password-space setup`** (from repo: `pnpm password-space setup`).

- One hidden passphrase prompt — no MCP `{}` confusion.
- When they return to chat, call **`vault_status`** to confirm.

**Only if Terminal is impossible:** Call **`vault_init`** and insist they enter passphrase in the **approval form** — **never** approve empty `{}`.

## If vault exists but locked

Follow **`primary_action`** (`password-space unlock` or **`vault_unlock`** with form).

## If vault ready

**`vault_set_secret`** — name and value in approval form only.

## Rules

- One primary action per turn until `vault_status` shows unlocked.
- Summarize errors using **`howToFix`** — never dump JSON.
- Confirm success without secret values.
