# Getting started in 2 minutes

Password Space keeps your API keys and passwords **on your Mac**, **encrypted**, and **out of chat**.

> **Trust:** Secrets stay on your device. Your agent uses them without pasting values into the conversation.

## Install

1. **Cursor → Settings → Plugins** (or team marketplace).
2. Import `https://github.com/vishnutvm/password-space` and install **password-space**.
3. Ensure **Node.js 20+** (`node -v`), then reload Cursor.

## Set up (default = Terminal)

| Step | You do | Agent / tool |
| --- | --- | --- |
| **1. Welcome** | Run **`/setup-password-space`** | `vault_onboard` |
| **2. Secure** | Terminal: `pnpm password-space setup` (hidden passphrase) | follow `copy_paste_command` |
| **3. Unlock** | Terminal: `pnpm password-space unlock` when needed | same |
| **4. Save** | Terminal: `pnpm password-space set` (name + hidden value) | then `list_secrets` |

### Optional: MCP Environment

**Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE`  
Then `vault_init` / `vault_unlock` with `{}` is safe. Never put that value in chat.

### The one rule people miss

Never approve `vault_init` / `vault_unlock` with empty fields unless `PASSWORD_SPACE_PASSPHRASE` is set. Never reply "ready" and expect the agent to invent a passphrase channel. Create, unlock, and add secrets in **Terminal**.

## Daily use

- **Add a secret:** Terminal `pnpm password-space set`
- **Status / list:** `vault_status` / `list_secrets`
- **Use a saved credential:** `inject_secret` (preferred — no value in chat)
- **Done for the day:** `vault_lock`
- **Optional UI:** `vault_manager` for status only when MCP Apps render

## Need help?

Say: *“Walk me through Password Space setup.”* The agent should call `vault_onboard` and show the Terminal command — no `mcp.json`, no Configure UI.

More: [zero-friction-v1.md](./zero-friction-v1.md) · [plugin README](../plugins/password-space/README.md) · [Security](../SECURITY.md)
