# Getting started in 2 minutes

Password Space keeps your API keys and passwords **on your Mac**, **encrypted**, and **out of chat**.

> **Trust:** Secrets stay on your device. Your agent uses them without pasting values into the conversation.

## Install

1. **Cursor → Settings → Plugins** (or team marketplace).
2. Import `https://github.com/vishnutvm/password-space` and install **password-space**.
3. Ensure **Node.js 20+** (`node -v`), then reload Cursor.

## Set up (default = Vault Manager / chat UI)

| Step | You do | Agent / tool |
| --- | --- | --- |
| **1. Welcome** | Run **`/setup-password-space`** | `vault_onboard` |
| **2. Secure** | Create vault in **Vault Manager** (or type passphrase in approval form) | `vault_manager` → `vault_init` |
| **3. Unlock** | Same channel | `vault_manager` / `vault_unlock` |
| **4. Save** | Name + token in App or approval form | `vault_set_secret` |

### Optional: MCP Environment

**Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE`  
Then `vault_init` / `vault_unlock` with `{}` is safe. Never put that value in chat.

### The one rule people miss

Never approve `vault_init` / `vault_unlock` with empty fields unless `PASSWORD_SPACE_PASSPHRASE` is set. Never reply "ready" and expect the agent to invent a passphrase channel. Never treat Terminal as the day-1 path.

## Daily use

- **Vault Manager (MCP Apps):** ask the agent to open **`vault_manager`** — interactive list/add/edit/remove (Cursor 2.6+). If only JSON returns, use approval-form tools.
- **Status:** `vault_status`
- **Use a saved credential:** `inject_secret` (preferred — no value in chat)
- **Done for the day:** `vault_lock`

## Need help?

Say: *“Walk me through Password Space setup.”* The agent should call `vault_onboard` and open **Vault Manager** (or guide the approval form) — no `mcp.json`, no Terminal required.

More: [zero-friction-v1.md](./zero-friction-v1.md) · [plugin README](../plugins/password-space/README.md) · [Security](../SECURITY.md)
