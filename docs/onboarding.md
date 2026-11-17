# Getting started in 2 minutes

Password Space keeps your API keys and passwords **in your OS keychain** under names you choose, and **out of chat**.

> **Trust:** Secrets stay on your device. Name them once in Terminal; your agent uses them by name without pasting values into the conversation. Lock/unlock are not needed.

## Install

1. **Cursor → Settings → Plugins** (or team marketplace).
2. Import `https://github.com/vishnutvm/password-space` and install **password-space**.
3. Ensure **Node.js 20+** (`node -v`), then reload Cursor.

## Set up (default = plugin Terminal CLI — no clone)

| Step | You do | Agent / tool |
| --- | --- | --- |
| **1. Welcome** | Run **`/setup-password-space`** | `vault_onboard` |
| **2. Store** | Terminal: `node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup` | follow `copy_paste_command` |
| **3. Save** | Terminal: `…/dist/cli.js set` (name + hidden value) | then `list_secrets` |
| **4. Use** | Ask the agent to use `NAME` | `cli.js run -s NAME -- <command>` |

### The one rule

Never paste secret values into chat. Create and add secrets in **Terminal**. **No git clone** for day-1 setup. **No unlock / passphrase.**

## Daily use

- **Add a secret:** Terminal `node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" set`
- **Status / list:** `vault_status` / `list_secrets`
- **Use a saved credential:** the agent runs `cli.js run -s NAME -- <command>` (no value in chat or on disk)
- **Upgrading from plain `secrets.json`:** run `…/dist/cli.js migrate` once to move values into the keychain
- **No App UI for secrets:** human add/remove is Terminal-only; ignore `vault_manager` for setup

## Coming from the old encrypted vault?

If you already have `~/.password-space/vault.db` from an earlier release, it is **left untouched**. Re-add secrets with Terminal `set`. There is no destructive migrate-by-default.

## Need help?

Say: *“Walk me through Password Space setup.”* The agent should call `vault_onboard` and show the Terminal command — no `mcp.json`, no Configure UI, no clone.

More: [zero-friction-v1.md](./zero-friction-v1.md) · [plugin README](../plugins/password-space/README.md) · [Security](../SECURITY.md)
