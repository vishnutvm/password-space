# Password Space for everyone

**Install · One-time Setup · Start Using** — no secrets in chat, no `mcp.json` edits.

Encrypted vault on your Mac. Your agent uses tokens without pasting them into the conversation.

## What Cursor can and cannot do

| Can | Cannot |
| --- | --- |
| Guide you with `/setup-password-space` | Read your mind for a passphrase |
| Run tools when you approve them | Reliably show a passphrase field on every Cursor build |
| Keep secrets out of chat after setup | Set up an encrypted vault with **zero** input from you |

**You choose a passphrase once.** That is required for encryption — there is no silent auto-setup.

Some Cursor builds approve `vault_init` with empty `{}` and **no passphrase field** (and may not render MCP Apps UI). Password Space detects this and steers you to **Terminal CLI setup** or **MCP Environment**.

## Easiest path (3 steps)

### 1. Install

1. **Cursor → Settings → Plugins**
2. **Add marketplace:** `https://github.com/vishnutvm/password-space`
3. Install **password-space**
4. **Reload Window** (Cmd+Shift+P → *Developer: Reload Window*)

Requires **Node.js 20+** on your Mac (`node -v`). The plugin MCP uses Node's built-in SQLite.

### 2. Create your vault (default = Terminal)

1. In chat: **`/setup-password-space`**
2. Agent calls **`vault_onboard`** → follow the single **`primary_action`**
3. When `recommended_path` is **`cli_setup`**, paste the Terminal command (example from a local clone):

```bash
cd ~/Shajipapan/Personal/Projects/password-space
pnpm password-space setup
```

Or, if the `password-space` CLI is on your PATH:

```bash
password-space setup
```

Enter a passphrase at the hidden prompts (8+ characters). Do **not** approve empty `{}` in Cursor.

#### One-click alternative (no Terminal)

**Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE` (8+ chars, never in chat), then approve `vault_init` / `vault_unlock` with `{}`.

#### Vault Manager App (Cursor 2.6+ with MCP Apps)

Ask the agent to open **`vault_manager`**. If an App UI appears, create/unlock there. If only JSON returns, your Cursor build lacks Apps — use CLI or Environment instead.

You do **not** edit `mcp.json`. You do **not** need to understand MCP.

### 3. Use

- Save: **`vault_set_secret`** (name + value in approval form only) or Vault Manager
- Agent access: **`inject_secret`**
- Done for the day: **`vault_lock`**

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Node too old / MCP won't start | Install Node **20+**, reload Cursor, run `/setup-password-space` again |
| `passphrase_missing` / empty `{}` | **Stop retrying.** Run `pnpm password-space setup` or set `PASSWORD_SPACE_PASSPHRASE` |
| Agent says reply "ready" then vault_init | Outdated skill — use CLI/`copy_paste_command` instead |
| "Vault already initialized" | Unlock with `pnpm password-space unlock` — do not re-init |
| "Vault locked" after restart | `pnpm password-space unlock` (or MCP Environment + `vault_unlock`) |
| Vault Manager shows JSON only | Host lacks MCP Apps — use CLI |
| Mid-setup interruption | Run **`/setup-password-space`** again — `vault_onboard` resumes from current state |
| Reinstall plugin | [FRESH_INSTALL_VERIFY.md](./FRESH_INSTALL_VERIFY.md) |

## Trust

- Data stays in `~/.password-space` on your device
- Uninstalling the plugin does **not** delete your vault unless you remove that folder
- Passphrase is never collected via MCP elicitation (sensitive data stays in CLI / env / App form / approval args when a field exists)

More: [zero-friction-v1.md](./zero-friction-v1.md) · [onboarding.md](./onboarding.md) · [SECURITY.md](../SECURITY.md)
