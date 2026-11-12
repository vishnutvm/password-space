---
name: password-space
description: Install · One-time Setup · Start Using. Follow vault_onboard primary_action — Terminal-only for create/unlock/add/remove; when ready, ask for a named secret — never dump long CLI paths every turn; never edit mcp.json or clone for day-1.
---

# Password Space

Encrypted vault on the user's Mac. **One obvious next step** — follow `primary_action` only.

## Newcomer path (default = plugin Terminal CLI)

1. User runs **`/setup-password-space`** (or asks to set up Password Space).
2. Call **`vault_onboard`**.
3. Follow **`primary_action.do_this` exactly**.
4. When `recommended_path` / `primary_action.id` is **`cli_setup`** or **`cli_unlock`**:
   - Show **`copy_paste_command`** (Terminal).
   - Typical form: `node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup|unlock` (or absolute path when MCP resolves the bundled CLI).
   - Bare `node "…/dist/cli.js"` opens the **interactive menu**.
   - Tell the user to run it and enter passphrase at the **hidden** prompts.
   - On unlock/setup they choose session duration: **1 day**, **1 week**, or **until lock**.
   - **Do not** call `vault_init` until they finish Terminal steps (then `vault_status`).
5. **No `git clone`.** The CLI ships inside the marketplace plugin. Clone is optional for contributors only.
6. Passphrase and secret **name + value** go in **Terminal only** — **never** in chat, **never** via elicitation, **never** via App forms.

### Never do this (causes empty `{}` / `passphrase_missing` loop)

- Ask the user to reply **"ready"** then call **`vault_init`** / **`vault_unlock`** without a passphrase channel
- Approve **`vault_init`** / **`vault_unlock`** with empty **`{}`** when Cursor shows no passphrase field
- Retry `vault_init` after `passphrase_missing` — switch to Terminal or MCP Environment instead
- Lead with Vault Manager / App forms / approval-form fields for create, unlock, or add
- Tell newcomers to clone the repo or run `pnpm install` for day-1 setup

### One-click alternative (no Terminal passphrase)

**Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE` (8+ chars), then call `vault_init` / `vault_unlock` with `{}`.

### Vault Manager

Do **not** call **`vault_manager`** for setup or secrets. It is status-only / legacy. Human UX is the Terminal CLI.

## After vault is ready (`setup_state` / `primary_action.id` = `ready`)

Keep chat **short**. Do **not** re-dump long `node …/dist/cli.js` paths on every turn.

- Say roughly: **Vault ready** — ask which named secret to use (e.g. **GITHUB_TOKEN**).
- Prefer **`list_secrets`** / **`inject_secret`** / **`vault_status`** / **`vault_lock`**.
- Show full Terminal **`copy_paste_command`** **only** when they ask to **add** or **remove** a secret (use the `cli_set` / `cli_remove` alternative on `primary_action`, or `node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" set|remove`).
- Session file: `~/.password-space/session` (0600) — MCP works until TTL ends or user runs Terminal `lock`.

Safe line when ready: *"Vault ready. Which secret should I use — for example GITHUB_TOKEN?"*

## Never

- Passphrase or secret values in chat
- Ask the user to edit **`mcp.json`** or explain MCP
- Call **`vault_init`** again when `setup_state` is `needs_unlock` / vault already exists
- Mention **Plugins → Configure** for vault home (removed — default is `~/.password-space`)
- Dump Vault Manager App HTML/JS / MCP resource bodies into chat
- Guide users to App forms for create / unlock / add
- Paste long Terminal CLI paths every turn after the vault is unlocked

Vault home defaults to **`~/.password-space`**. Optional override: a real absolute `PASSWORD_SPACE_HOME` in the process / MCP Environment (never an unresolved `${PASSWORD_SPACE_HOME}`).

Safe line (setup/unlock only): *"Next step: open Terminal and paste this command. Choose how long to stay unlocked, type your passphrase there (hidden). I won't ask for it in chat. No clone needed."*
