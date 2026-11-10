# Password Space for everyone

**Install · Create vault · Use secrets** — no secrets in chat.

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

### 2. Create your vault (pick **one** way)

**Recommended — Terminal (clearest):**

After cloning the repo (or any install with the CLI):

```bash
cd path/to/password-space
pnpm install && pnpm build
pnpm password-space setup
```

One screen, hidden passphrase, create + unlock. No `{}` approval confusion.

**Or — stay in Cursor:**

1. Chat: **`/setup-password-space`**
2. Agent calls **`vault_onboard`** → follow **`primary_action.do_this`**
3. Approve **`vault_init`** / **`vault_unlock`** and **type your passphrase in the form** — never an empty approval

Optional: **Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE` (never in chat).

### 3. Use

- Save: **`vault_set_secret`** (name + value in approval form only)
- Agent access: **`inject_secret`**
- Done for the day: **`vault_lock`**

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `vault_init` failed | You approved with `{}` — run **`password-space setup`** in Terminal or retry with passphrase in the form |
| "Vault locked" | **`password-space unlock`** or **`vault_unlock`** with passphrase in form |
| Reinstall plugin | [FRESH_INSTALL_VERIFY.md](./FRESH_INSTALL_VERIFY.md) |

## Trust

- Data stays in `~/.password-space` on your device
- Uninstalling the plugin does **not** delete your vault unless you remove that folder

More: [onboarding.md](./onboarding.md) · [SECURITY.md](../SECURITY.md)
