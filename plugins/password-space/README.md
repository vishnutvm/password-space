# Password Space

**A local named secret store for AI agents.** Values live in your OS keychain; agents use them by name, never through chat.

This folder is the plugin for Cursor and Claude Code, and the bundle Codex uses. Setup guides: [Cursor](../../docs/cursor.md) · [Claude Code](../../docs/claude-code.md) · [Codex](../../docs/codex.md).

## What's included

| Piece | Purpose |
| --- | --- |
| MCP server (`dist/index.js`) | Status, list, inject by name |
| Terminal CLI (`dist/cli.js`) | **Sole human UX** — interactive menu + setup / add / remove (hidden value prompts) — **bundled; no clone** |
| Skill + `/setup-password-space` | Guided setup — Terminal-only |
| Hooks | Gentle welcome when no store yet; warn (never block) when a prompt contains a stored value; block agent commands and file reads that would read values directly (`get`, keychain lookups, `secrets.json`, inject files) |

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
4. Back in Cursor: ask the agent to use the secret **by name**. It runs commands as `cli.js run -s NAME -- <command>`, so the value goes into the command's environment, not the chat.

You do **not** edit `mcp.json`. Requires **Node.js 20+**.

**Trust:** Values live in the macOS Keychain, Windows Credential Manager or Linux Secret Service; `~/.password-space/secrets.json` holds names only (plain-file fallback where there is no keychain — `status` says which). Prompts containing a stored value go through with a warning, and the agent is told to use the secret by name. Values never belong in chat.

Default store folder: `~/.password-space`. Optional override: a real absolute `PASSWORD_SPACE_HOME` in the process environment or MCP Environment (never an unresolved `${PASSWORD_SPACE_HOME}`).

## MCP tools (essentials)

| Tool | Returns secrets? |
| --- | --- |
| `vault_onboard` | No — start here (`primary_action` only) |
| `vault_status` / `list_secrets` | No — agents check `list_secrets` before asking for a key |
| `store_secret` | No — agent saves a key the user handed over (`overwrite: true` to replace) |
| `remove_secret` | No — agent deletes a secret by name |
| `inject_secret` | No — only when a command can't be wrapped with the CLI `run` |
| `vault_manager` | No — status-only; **do not** use for add |

**Claude Code:** `/plugin marketplace add vishnutvm/password-space`, then `/plugin install password-space@password-space-marketplace`. Hooks and differences from Cursor: [claude-code.md](../../docs/claude-code.md).

**OpenAI Codex:** `node "<this folder>/dist/cli.js" codex-setup --write` registers the MCP server, hooks and skill in `~/.codex/config.toml`. Details: [codex.md](../../docs/codex.md).

More: [root README](../../README.md) · [SECURITY.md](../../SECURITY.md).

MIT
