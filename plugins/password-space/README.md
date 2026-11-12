# Password Space

**A private credential vault for Cursor** — encrypted on your Mac, designed so agents never need your secrets in chat.

[Getting started in 2 minutes](../../docs/onboarding.md)

## What's included

| Piece | Purpose |
| --- | --- |
| MCP server (`dist/index.js`) | Status, list, inject, lock after unlock |
| Terminal CLI (`dist/cli.js`) | Create / unlock / add secrets with hidden prompts — **bundled; no clone** |
| Skill + `/setup-password-space` | Guided setup — Terminal-first |
| Hooks | Gentle welcome when no vault yet; redaction before send |

## After install

1. In chat: **`/setup-password-space`** — follow `primary_action` (**Terminal** first).
2. Open Terminal and run the shown **`copy_paste_command`** — typically:
   ```bash
   node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup
   ```
   (After Reload, the agent may show an absolute path to the same `cli.js`.) Passphrase is typed there, hidden. **No git clone.**
3. Add a credential:
   ```bash
   node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" set
   ```
4. Back in Cursor: `vault_status` / `list_secrets` / `inject_secret`. Never approve empty `{}` when Cursor shows no passphrase field.

You do **not** edit `mcp.json`. Requires **Node.js 20+**.

**Trust:** Local encryption. Passphrases and tokens stay out of the conversation.

Default vault folder: `~/.password-space`. Optional override: a real absolute `PASSWORD_SPACE_HOME` in the process environment or MCP Environment (never an unresolved `${PASSWORD_SPACE_HOME}`).

## MCP tools (essentials)

| Tool | Returns secrets? |
| --- | --- |
| `vault_onboard` | No — start here (`primary_action` only) |
| `vault_status` / `list_secrets` | No |
| `inject_secret` | No — **preferred** for agents |
| `vault_lock` | No |
| `vault_manager` | No — optional status UI only |

More: [EXTERNAL_USER_INSTALL.md](../../docs/EXTERNAL_USER_INSTALL.md) · [zero-friction-v1.md](../../docs/zero-friction-v1.md). CLI details: [root README](../../README.md).

MIT
