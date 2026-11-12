# Password Space for everyone

**Install · One-time Setup · Start Using** — no secrets in chat, no `mcp.json` edits, **no repo clone**.

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

Requires **Node.js 20+** on your Mac (`node -v`). The plugin MCP and Terminal CLI use Node's built-in SQLite.

### 2. Create your vault (Terminal — no clone)

1. In chat: **`/setup-password-space`**
2. Agent calls **`vault_onboard`** → follow the single **`primary_action`**
3. Open **Terminal** and paste **`copy_paste_command`**. Typical form after plugin install:

```bash
node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup
```

(If the agent shows an absolute path to `…/dist/cli.js`, use that — same binary.)

4. Type your passphrase at the **hidden** prompts (8+ characters)
5. Choose how long to stay unlocked: **1 day**, **1 week**, or **until lock** (no auto-expiry until you run `lock`)

Do **not** approve empty `{}` in Cursor. Do **not** clone the repo for day-1 setup. Do **not** use App forms for create/add — Terminal only.

#### Optional: MCP Environment (skip Terminal passphrase)

**Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE` (8+ chars, never in chat), then approve `vault_init` / `vault_unlock` with `{}`.

You do **not** edit `mcp.json`. You do **not** need to understand MCP. Vault home defaults to `~/.password-space` (no Configure UI).

### 3. Add a secret + use

```bash
node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" set
# prompts: Secret name → Value for NAME (hidden)

# or full interactive menu:
node "${CURSOR_PLUGIN_ROOT}/dist/cli.js"
```

- Agent access: **`inject_secret`** (works while `~/.password-space/session` is valid)
- Status / list: **`vault_status`** / **`list_secrets`** (or Terminal `list`)
- Done: Terminal `lock` or MCP **`vault_lock`**

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Node too old / MCP won't start | Install Node **20+**, reload Cursor, run `/setup-password-space` again |
| `passphrase_missing` / empty `{}` | **Stop retrying.** Run the Terminal `copy_paste_command`, or set `PASSWORD_SPACE_PASSPHRASE` |
| Agent says reply "ready" then vault_init | Outdated skill — follow `primary_action` (Terminal first) |
| Agent re-dumps long `…/dist/cli.js` paths every turn after unlock | Outdated skill — when `ready`, ask for a named secret; show Terminal command only for add/remove |
| Agent asks you to clone the repo | Outdated guidance — use plugin `dist/cli.js` instead |
| "Vault already initialized" | Unlock via Terminal `…/dist/cli.js unlock` — do not re-init |
| "Vault locked" after restart | Terminal unlock, or MCP Environment + `vault_unlock` |
| Mid-setup interruption | Run **`/setup-password-space`** again — `vault_onboard` resumes from current state |
| Reinstall plugin | [FRESH_INSTALL_VERIFY.md](./FRESH_INSTALL_VERIFY.md) |

## Trust

- Data stays in `~/.password-space` on your device
- Uninstalling the plugin does **not** delete your vault unless you remove that folder
- Passphrase and secret values are never collected via MCP elicitation

More: [zero-friction-v1.md](./zero-friction-v1.md) · [onboarding.md](./onboarding.md) · [SECURITY.md](../SECURITY.md)

CLI details: see the [root README](../README.md).
