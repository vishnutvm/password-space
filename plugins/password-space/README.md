# Password Space

**A local named secret store for AI agents.** Values live in your OS keychain; agents use them by name, never through chat.

This folder is the plugin for Cursor and Claude Code, and the bundle Codex uses. Setup guides: [Cursor](../../docs/cursor.md) · [Claude Code](../../docs/claude-code.md) · [Codex](../../docs/codex.md).

## What's included

| Piece | Purpose |
| --- | --- |
| MCP server (`dist/index.js`) | Setup, save, list, remove, use by name |
| Terminal CLI (`dist/cli.js`) | `run` for agents; optional menu + setup / add / remove for humans (hidden value prompts) — **bundled; no clone** |
| Skill + `/setup-password-space` | The agent sets everything up; nothing to paste |
| Hooks | Gentle welcome when no store yet; block prompts that contain a stored value; block agent commands and file reads that would read values directly (`get`, keychain lookups, `secrets.json`, inject files) |

## After install

1. In chat: **`/password-space:setup-password-space`** (Claude Code) or **`/setup-password-space`** (Cursor), or say *"set up Password Space"*. The agent calls `setup_vault`. No passphrase, **no Terminal command, no git clone.**
2. *"Save this token as GITHUB_TOKEN: …"* — the agent calls `store_secret`.
3. *"Use GITHUB_TOKEN to …"* — the agent runs `cli.js run -s GITHUB_TOKEN -- <command>`, so the value goes into the command's environment, not the chat. Later sessions find it by name.
4. *"Remove GITHUB_TOKEN"* — the agent calls `remove_secret`.

Optional, for keys you never want in chat: type them in Terminal with `node "<this folder>/dist/cli.js" set` (hidden prompt).

You do **not** edit `mcp.json`. Requires **Node.js 20+**.

**Trust:** Values live in the macOS Keychain, Windows Credential Manager or Linux Secret Service; `~/.password-space/secrets.json` holds names only (plain-file fallback where there is no keychain — `status` says which). Prompts containing a stored value are blocked. Values never belong in chat.

Default store folder: `~/.password-space`. Optional override: a real absolute `PASSWORD_SPACE_HOME` in the process environment or MCP Environment (never an unresolved `${PASSWORD_SPACE_HOME}`).

## MCP tools (essentials)

| Tool | Returns secrets? |
| --- | --- |
| `setup_vault` | No — creates the store; the agent calls it during setup |
| `vault_onboard` | No — the one next step (`primary_action`) |
| `vault_status` / `list_secrets` | No — agents check `list_secrets` before asking for a key |
| `store_secret` | No — agent saves a key the user handed over (`overwrite: true` to replace) |
| `remove_secret` | No — agent deletes a secret by name |
| `inject_secret` | No — only when a command can't be wrapped with the CLI `run` |
| `vault_manager` | No — status-only; **do not** use for add |

**Claude Code:** `/plugin marketplace add vishnutvm/password-space`, then `/plugin install password-space@password-space-marketplace`. Hooks and differences from Cursor: [claude-code.md](../../docs/claude-code.md).

**OpenAI Codex:** `node "<this folder>/dist/cli.js" codex-setup --write` registers the MCP server, hooks and skill in `~/.codex/config.toml`. Details: [codex.md](../../docs/codex.md).

More: [root README](../../README.md) · [SECURITY.md](../../SECURITY.md).

MIT
