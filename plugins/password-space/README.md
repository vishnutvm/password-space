# Password Space

**A local named secret store for Cursor** — plain files on your Mac, designed so agents never need your secrets in chat.

[Getting started in 2 minutes](../../docs/onboarding.md)

## What's included

| Piece | Purpose |
| --- | --- |
| MCP server (`dist/index.js`) | Status, list, inject by name |
| Terminal CLI (`dist/cli.js`) | **Sole human UX** — interactive menu + setup / add / remove (hidden value prompts) — **bundled; no clone** |
| Skill + `/setup-password-space` | Guided setup — Terminal-only |
| Hooks | Gentle welcome when no store yet; redaction before send |

## After install

1. In chat: **`/setup-password-space`** — follow `primary_action` (**Terminal** only).
2. Open Terminal and run the shown **`copy_paste_command`** — typically:
   ```bash
   node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup
   ```
   No passphrase. **No git clone.**
3. Add a credential (or open the menu with no subcommand):
   ```bash
   node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" set
   node "${CURSOR_PLUGIN_ROOT}/dist/cli.js"        # interactive menu
   ```
4. Back in Cursor: ask the agent to use the secret **by name** via `inject_secret` / `list_secrets`.

You do **not** edit `mcp.json`. Requires **Node.js 20+**.

**Trust:** Secrets stay local as plain files (`~/.password-space/secrets.json`, mode 0600). Values never belong in chat. Lock/unlock not needed.

Default store folder: `~/.password-space`. Optional override: a real absolute `PASSWORD_SPACE_HOME` in the process environment or MCP Environment (never an unresolved `${PASSWORD_SPACE_HOME}`).

## MCP tools (essentials)

| Tool | Returns secrets? |
| --- | --- |
| `vault_onboard` | No — start here (`primary_action` only) |
| `vault_status` / `list_secrets` | No |
| `inject_secret` | No — **preferred** for agents (by name) |
| `vault_manager` | No — status-only; **do not** use for add |

`vault_init` / `vault_unlock` / `vault_lock` may still appear for compatibility — they are **not** required.

More: [EXTERNAL_USER_INSTALL.md](../../docs/EXTERNAL_USER_INSTALL.md) · [plain-text store note](../../docs/onboarding.md). CLI details: [root README](../../README.md).

MIT
