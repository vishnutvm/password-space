---
description: Set up Password Space — Terminal-only interactive CLI for create, unlock, add, remove, lock
---

Setup for a **non-technical** user. **Never** ask for passphrase or tokens in chat. **Never** ask them to edit `mcp.json`. **Sole human path is Terminal** with the **plugin-bundled CLI** (no repo clone).

## Start

1. Call **`vault_onboard`**.
2. Read **`primary_action`** aloud in plain language — that is the **only** next step.
3. If `recommended_path` / `primary_action.id` is **`cli_setup`** or **`cli_unlock`**: show **`copy_paste_command`** and wait for them to finish in Terminal. Then call **`vault_status`**.
4. If `primary_action.id` is **`ready`**: say the vault is ready and ask which **named secret** to use (e.g. GITHUB_TOKEN). Prefer **`list_secrets`** / **`inject_secret`**. Do **not** paste long `node …/dist/cli.js` paths.
5. **Do not** ask them to reply "ready" and then call `vault_init` with empty `{}`.
6. **Do not** tell them to `git clone` — the CLI is at `${CURSOR_PLUGIN_ROOT}/dist/cli.js` after plugin install + Reload.
7. **Do not** call **`vault_manager`** or guide them to App forms for create / unlock / add.

## If Node is too old (`primary_action.id` = `fix_node`)

Tell them to install **Node.js 20+** from https://nodejs.org, reload Cursor, then run this command again.

## If vault does not exist (`cli_setup` / `vault_init_env`)

- **`cli_setup` (default):** show Terminal `copy_paste_command` (typically `node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup`, or an absolute path when MCP resolves it).
- At the prompts they set a passphrase and choose unlock duration: **1 day**, **1 week**, or **until lock**.
- **`vault_init_env`:** call **`vault_init`** once (passphrase already in MCP Environment).
- Alternative (only if listed): MCP Environment. Never App forms.

## If vault exists but locked (`cli_unlock` / `vault_unlock_env`)

- **`cli_unlock`:** show unlock `copy_paste_command` — they pick session duration at the prompt.
- **`vault_unlock_env`:** call **`vault_unlock`**.
- **Do not** call `vault_init` again.

## If vault ready (`ready`)

Keep it short: **"Vault ready. Which secret should I use (e.g. GITHUB_TOKEN)?"** Prefer **`inject_secret`** / **`list_secrets`**.

Show Terminal **`copy_paste_command`** **only** if they ask to **add** or **remove** a secret (from `primary_action.alternatives` `cli_set` / `cli_remove`). Never re-dump CLI paths on every turn.

## If `passphrase_missing` / empty `{}`

Stop the loop. Show `copy_paste_command` or MCP Environment path from the error payload. Do **not** retry `vault_init`. Do **not** push App forms.

## Rules

- One primary action per turn until `vault_status` shows unlocked — then switch to named-secret / inject guidance.
- Show full Terminal `copy_paste_command` only for setup, unlock, or explicit add/remove — not when already ready.
- Summarize errors using **`howToFix` / `recovery` / `host_limitation`** — never dump JSON.
- Confirm success without secret values.
- Passphrase and secret values only via Terminal (hidden) or optional MCP Environment — never elicitation, never chat, never App create/add forms.
- Do **not** mention Plugins → Configure for vault home (defaults to `~/.password-space`).
- Session lives at `~/.password-space/session` (0600) until TTL ends or they run Terminal `lock`.
