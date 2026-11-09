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

1. In chat: **`/setup-password-space`** or *"Set up Password Space."*
2. When Cursor shows **Run tool**, enter your **passphrase** in the form (8+ characters).
3. Optional: **Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE` (never in chat).

**Trust:** Local encryption. Passphrases and tokens stay out of the conversation.

Default vault folder: `~/.password-space`. Override with `PASSWORD_SPACE_HOME` in MCP Environment.

## MCP tools (essentials)

| Tool | Returns secrets? |
| --- | --- |
| `vault_onboard` | No — start here |
| `vault_status` | No |
| `vault_init` / `vault_unlock` | No |
| `vault_set_secret` | No (metadata only) |
| `inject_secret` | No — **preferred** for agents |

Power users: [root README](../../README.md) · CLI · manual MCP config.

MIT
