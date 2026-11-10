# Getting started in 2 minutes

Password Space keeps your API keys and passwords **on your Mac**, **encrypted**, and **out of chat**.

> **Trust:** Secrets stay on your device. Your agent uses them without pasting values into the conversation.

## Install

1. **Cursor → Settings → Plugins** (or team marketplace).
2. Import `https://github.com/vishnutvm/password-space` and install **password-space**.
3. Ensure **Node.js 20+** (`node -v`), then reload Cursor.

## Set up (default = Terminal CLI)

| Step | You do | Agent / tool |
| --- | --- | --- |
| **1. Welcome** | Run **`/setup-password-space`** | `vault_onboard` |
| **2. Secure** | Paste **`copy_paste_command`** in Terminal (hidden passphrase) | `cli_setup` / `pnpm password-space setup` |
| **3. Confirm** | Back in chat | `vault_status` |
| **4. Save** | Name + token in approval form or Vault Manager | `vault_set_secret` |

### Why Terminal first?

Many Cursor builds approve `vault_init` with empty `{}` and **no passphrase field**. That causes a `passphrase_missing` loop. CLI setup avoids it.

### One-click alternative

**Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE`  
Then `vault_init` / `vault_unlock` with `{}` is safe. Never put that value in chat.

### The one rule people miss

Never approve `vault_init` / `vault_unlock` with empty fields unless `PASSWORD_SPACE_PASSPHRASE` is set. Never reply "ready" and expect the agent to invent a passphrase channel.

## Daily use

- **Vault Manager (MCP Apps):** ask the agent to open **`vault_manager`** — interactive list/add/edit/remove (Cursor 2.6+). If only JSON returns, use tools/CLI.
- **Status:** `vault_status`
- **Use a saved credential:** `inject_secret` (preferred — no value in chat)
- **Done for the day:** `vault_lock`

## Need help?

Say: *“Walk me through Password Space setup.”* The agent should call `vault_onboard` and explain the **single** `primary_action` (usually a Terminal copy-paste) — no `mcp.json`.

More: [zero-friction-v1.md](./zero-friction-v1.md) · [plugin README](../plugins/password-space/README.md) · [Security](../SECURITY.md)
