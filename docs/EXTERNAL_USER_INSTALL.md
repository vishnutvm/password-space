# Password Space for everyone

**Install · One-time Setup · Start Using** — no secrets in chat, no `mcp.json` edits.

Encrypted vault on your Mac. Your agent uses tokens without pasting them into the conversation.

## What Cursor can and cannot do

| Can | Cannot |
| --- | --- |
| Guide you with `/setup-password-space` | Read your mind for a passphrase |
| Show a Terminal command and run MCP tools when you approve them | Set up an encrypted vault with **zero** input from you |
| Keep secrets out of chat after setup | Invent a passphrase for you |

**You choose a passphrase once** in Terminal. That is required for encryption — there is no silent auto-setup.

Some Cursor builds approve `vault_init` with empty `{}` and **no passphrase field**. Password Space steers you to **Terminal** (or optional **MCP Environment**) — not MCP App forms as the default.

## Easiest path (3 steps)

### 1. Install

1. **Cursor → Settings → Plugins**
2. **Add marketplace:** `https://github.com/vishnutvm/password-space`
3. Install **password-space**
4. **Reload Window** (Cmd+Shift+P → *Developer: Reload Window*)

Requires **Node.js 20+** on your Mac (`node -v`). The plugin MCP uses Node's built-in SQLite.

### 2. Create your vault (Terminal)

1. In chat: **`/setup-password-space`**
2. Agent calls **`vault_onboard`** → follow the single **`primary_action`**
3. Open **Terminal** and paste **`copy_paste_command`** (typically from a clone: `pnpm password-space setup`)
4. Type your passphrase at the **hidden** prompts (8+ characters)

Do **not** approve empty `{}` in Cursor.

#### Optional: MCP Environment (skip Terminal passphrase)

**Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE` (8+ chars, never in chat), then approve `vault_init` / `vault_unlock` with `{}`.

You do **not** edit `mcp.json`. You do **not** need to understand MCP. Vault home defaults to `~/.password-space` (no Configure UI).

### 3. Add a secret + use

```bash
# From your password-space clone (after pnpm install && pnpm build):
pnpm password-space set
# prompts: Secret name → Value for NAME (hidden)
```

- Agent access: **`inject_secret`**
- Status / list: **`vault_status`** / **`list_secrets`**
- Done for the day: **`vault_lock`**

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Node too old / MCP won't start | Install Node **20+**, reload Cursor, run `/setup-password-space` again |
| `passphrase_missing` / empty `{}` | **Stop retrying.** Run the Terminal `copy_paste_command`, or set `PASSWORD_SPACE_PASSPHRASE` |
| Agent says reply "ready" then vault_init | Outdated skill — follow `primary_action` (Terminal first) |
| "Vault already initialized" | Unlock via Terminal `pnpm password-space unlock` — do not re-init |
| "Vault locked" after restart | Terminal unlock, or MCP Environment + `vault_unlock` |
| Mid-setup interruption | Run **`/setup-password-space`** again — `vault_onboard` resumes from current state |
| Reinstall plugin | [FRESH_INSTALL_VERIFY.md](./FRESH_INSTALL_VERIFY.md) |

## Trust

- Data stays in `~/.password-space` on your device
- Uninstalling the plugin does **not** delete your vault unless you remove that folder
- Passphrase and secret values are never collected via MCP elicitation

More: [zero-friction-v1.md](./zero-friction-v1.md) · [onboarding.md](./onboarding.md) · [SECURITY.md](../SECURITY.md)

CLI details: see the [root README](../README.md).
