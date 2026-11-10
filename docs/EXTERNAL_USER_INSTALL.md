# Password Space for everyone

**Install · One-time Setup · Start Using** — no secrets in chat, no `mcp.json` edits.

Encrypted vault on your Mac. Your agent uses tokens without pasting them into the conversation.

## What Cursor can and cannot do

| Can | Cannot |
| --- | --- |
| Guide you with `/setup-password-space` | Read your mind for a passphrase |
| Run tools when you approve them | Open a custom macOS password dialog (plugin limits) |
| Keep secrets out of chat after setup | Set up an encrypted vault with **zero** input from you |

**You choose a passphrase once.** That is required for encryption — there is no silent auto-setup.

## Easiest path (3 steps)

### 1. Install

1. **Cursor → Settings → Plugins**
2. **Add marketplace:** `https://github.com/vishnutvm/password-space`
3. Install **password-space**
4. **Reload Window** (Cmd+Shift+P → *Developer: Reload Window*)

Requires **Node.js 20+** on your Mac (`node -v`). The plugin MCP uses Node's built-in SQLite.

### 2. Create your vault (one path)

1. In chat: **`/setup-password-space`**
2. Agent calls **`vault_onboard`** → follow the single **`primary_action`**
3. Approve **`vault_init`** / **`vault_unlock`** and **type your passphrase in the form** — never an empty approval

Optional: **Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE` (never in chat).

You do **not** edit `mcp.json`. You do **not** need to understand MCP.

### 3. Use

- Save: **`vault_set_secret`** (name + value in approval form only)
- Agent access: **`inject_secret`**
- Done for the day: **`vault_lock`**

## Advanced escape hatch (optional)

If MCP approval forms keep failing empty, power users with the repo CLI can run:

```bash
pnpm password-space setup
```

This is **not** the newcomer path — prefer `/setup-password-space` first.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Node too old / MCP won't start | Install Node **20+**, reload Cursor, run `/setup-password-space` again |
| `vault_init` failed / empty `{}` | Retry and **type the passphrase in the form** — do not approve blank |
| "Vault already initialized" | Call **`vault_unlock`** instead — your vault already exists |
| "Vault locked" after restart | **`vault_unlock`** with passphrase in form (session expired; vault is fine) |
| Mid-setup interruption | Run **`/setup-password-space`** again — `vault_onboard` resumes from current state |
| Reinstall plugin | [FRESH_INSTALL_VERIFY.md](./FRESH_INSTALL_VERIFY.md) |

## Trust

- Data stays in `~/.password-space` on your device
- Uninstalling the plugin does **not** delete your vault unless you remove that folder
- Passphrase is never collected via MCP elicitation (sensitive data stays in tool approval / env / CLI)

More: [zero-friction-v1.md](./zero-friction-v1.md) · [onboarding.md](./onboarding.md) · [SECURITY.md](../SECURITY.md)
