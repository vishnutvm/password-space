# Password Space for everyone

**Install · One-time Setup · Start Using** — no secrets in chat, no `mcp.json` edits, **no repo clone**.

Local plain named secrets on your Mac. Your agent uses tokens by name without pasting them into the conversation. **Lock/unlock are not needed.**

## What Cursor can and cannot do

| Can | Cannot |
| --- | --- |
| Guide you with `/setup-password-space` | Read secrets from chat |
| Show a Terminal command and run MCP tools when you approve them | Keep values off disk (they are plain local files) |
| Keep secrets out of chat after setup | Replace a dedicated encrypted password manager |

**You name a secret once** in Terminal (hidden value prompt). That is the only human input required.

## Easiest path (3 steps)

### 1. Install

1. **Cursor → Settings → Plugins**
2. **Add marketplace:** `https://github.com/vishnutvm/password-space`
3. Install **password-space**
4. **Reload Window** (Cmd+Shift+P → *Developer: Reload Window*)

Requires **Node.js 20+** on your Mac (`node -v`).

### 2. Create your store (Terminal — no clone)

1. In chat: **`/setup-password-space`**
2. Agent calls **`vault_onboard`** → follow the single **`primary_action`**
3. Open **Terminal** and paste **`copy_paste_command`**. Typical form after plugin install:

```bash
node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup
```

(If the agent shows an absolute path to `…/dist/cli.js`, use that — same binary.)

4. No passphrase. Creates `~/.password-space/secrets.json` (mode 0600).

Do **not** clone the repo for day-1 setup. Do **not** use App forms for add — Terminal only.

You do **not** edit `mcp.json`. Vault home defaults to `~/.password-space` (no Configure UI).

### 3. Add a secret + use

```bash
node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" set
# prompts: Secret name → Value for NAME (hidden)

# or full interactive menu:
node "${CURSOR_PLUGIN_ROOT}/dist/cli.js"
```

Back in Cursor: `list_secrets` / `inject_secret` — ask the agent to use the secret **by name**.

## Coming from the encrypted vault?

Older installs used `vault.db` + unlock. That file is **left untouched**. Re-add secrets with Terminal `set`.

## Rules of thumb

- Secret values: **Terminal only** (hidden prompts)
- Agents: **`inject_secret` by name** — never paste values into chat
- Human UX: **Terminal CLI only** — not Vault Manager App forms
- No unlock session required

More: [onboarding.md](./onboarding.md) · [plugin README](../plugins/password-space/README.md) · [SECURITY.md](../SECURITY.md)
