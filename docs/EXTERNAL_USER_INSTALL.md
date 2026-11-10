# Password Space for everyone

**Install · One-time Setup · Start Using** — no secrets in chat, no `mcp.json` edits.

Encrypted vault on your Mac. Your agent uses tokens without pasting them into the conversation.

## What Cursor can and cannot do

| Can | Cannot |
| --- | --- |
| Guide you with `/setup-password-space` | Read your mind for a passphrase |
| Open Vault Manager and run tools when you approve them | Set up an encrypted vault with **zero** input from you |
| Keep secrets out of chat after setup | Invent a passphrase for you |

**You choose a passphrase once.** That is required for encryption — there is no silent auto-setup.

Some Cursor builds approve `vault_init` with empty `{}` and **no passphrase field**. Password Space steers you to **Vault Manager**, a **visible approval-form field**, or optional **MCP Environment** — not Terminal as the default.

## Easiest path (3 steps)

### 1. Install

1. **Cursor → Settings → Plugins**
2. **Add marketplace:** `https://github.com/vishnutvm/password-space`
3. Install **password-space**
4. **Reload Window** (Cmd+Shift+P → *Developer: Reload Window*)

Requires **Node.js 20+** on your Mac (`node -v`). The plugin MCP uses Node's built-in SQLite.

### 2. Create your vault (UI / chat)

1. In chat: **`/setup-password-space`**
2. Agent calls **`vault_onboard`** → follow the single **`primary_action`**
3. Default: agent opens **`vault_manager`** — create your vault in the App UI
4. If no App UI appears: type your passphrase (8+ characters) in the **MCP approval form** when the agent calls `vault_init` / `vault_unlock`

Do **not** approve empty `{}` in Cursor.

#### Optional: MCP Environment (skip empty-form pain)

**Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE` (8+ chars, never in chat), then approve `vault_init` / `vault_unlock` with `{}`.

You do **not** edit `mcp.json`. You do **not** need to understand MCP. You do **not** need Terminal for day-1 setup.

### 3. Use

- Save: **Vault Manager** or **`vault_set_secret`** (name + value in approval form only)
- Agent access: **`inject_secret`**
- Done for the day: **`vault_lock`**

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Node too old / MCP won't start | Install Node **20+**, reload Cursor, run `/setup-password-space` again |
| `passphrase_missing` / empty `{}` | **Stop retrying.** Open Vault Manager, use a visible approval field, or set `PASSWORD_SPACE_PASSPHRASE` |
| Agent says reply "ready" then vault_init | Outdated skill — follow `primary_action` (`vault_manager` first) |
| "Vault already initialized" | Unlock via Vault Manager / `vault_unlock` — do not re-init |
| "Vault locked" after restart | Vault Manager unlock, or MCP Environment + `vault_unlock` |
| Vault Manager shows JSON only | Host lacks MCP Apps — use approval-form `vault_init` / `vault_unlock` or MCP Environment |
| Mid-setup interruption | Run **`/setup-password-space`** again — `vault_onboard` resumes from current state |
| Reinstall plugin | [FRESH_INSTALL_VERIFY.md](./FRESH_INSTALL_VERIFY.md) |

## Trust

- Data stays in `~/.password-space` on your device
- Uninstalling the plugin does **not** delete your vault unless you remove that folder
- Passphrase is never collected via MCP elicitation (sensitive data stays in App form / env / approval args when a field exists)

More: [zero-friction-v1.md](./zero-friction-v1.md) · [onboarding.md](./onboarding.md) · [SECURITY.md](../SECURITY.md)

Power-user Terminal CLI (not required for onboarding): see the **CLI appendix** in the [root README](../README.md).
