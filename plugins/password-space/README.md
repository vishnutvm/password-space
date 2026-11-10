# Password Space

**A private credential vault for Cursor** — encrypted on your Mac, designed so agents never need your secrets in chat.

[Getting started in 2 minutes](../../docs/onboarding.md)

## What's included

| Piece | Purpose |
| --- | --- |
| MCP server | Create, unlock, store, and inject credentials |
| Skill + `/setup-password-space` | Guided setup in plain language |
| Hooks | Gentle welcome when no vault yet; redaction before send |

## After install

1. In chat: **`/setup-password-space`** — follow `primary_action` (usually **Terminal CLI setup**).
2. Paste the shown `copy_paste_command` (e.g. `pnpm password-space setup`) and enter a passphrase at the hidden prompt.
3. **One-click alternative:** **Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE` (never in chat), then `vault_init` with `{}`.
4. Never approve empty `{}` when Cursor shows no passphrase field — that causes `passphrase_missing`.

You do **not** edit `mcp.json`. Requires **Node.js 20+**.

**Trust:** Local encryption. Passphrases and tokens stay out of the conversation.

Default vault folder: `~/.password-space`. Override with `PASSWORD_SPACE_HOME` in MCP Environment.

## MCP tools (essentials)

| Tool | Returns secrets? |
| --- | --- |
| `vault_onboard` | No — start here (`primary_action` only) |
| `vault_status` | No |
| `vault_init` / `vault_unlock` | No |
| `vault_set_secret` | No (metadata only) |
| `inject_secret` | No — **preferred** for agents |

More: [EXTERNAL_USER_INSTALL.md](../../docs/EXTERNAL_USER_INSTALL.md) · [zero-friction-v1.md](../../docs/zero-friction-v1.md). Power users: [root README](../../README.md) · CLI.

MIT
