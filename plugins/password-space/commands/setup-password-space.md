---
description: Set up Password Space for the user (the agent does it; the user pastes nothing). Use when the user says "set up password space", "install password space", "start password space" or "/setup-password-space".
---

Set up Password Space **for** the user. They may not be technical. **You** do every step. Do **not** give them a command to paste into Terminal. Do **not** ask them to edit `mcp.json`. Do **not** ask for any secret value during setup.

## 1. Run setup

Call the Password Space MCP tool **`setup_vault`** (no arguments). It creates `~/.password-space`, keeps values in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service; a private file when there is none), and moves any old plain-text values into the keychain. It is safe to call again.

When it returns `ok: true`, go to step 3.

## 2. Only if the `setup_vault` tool is not available

The Password Space MCP server did not start. The usual reason is Node.js missing or older than 20.

1. Run with Bash: `node -v`
2. **No Node, or below v20:** tell the user, in plain words:
   - Mac: install the **LTS** version from https://nodejs.org (the `.pkg` installer), or run `brew install node` if they use Homebrew.
   - Windows: the LTS installer from https://nodejs.org.
   - Then **quit and reopen** Claude Code (or reload Cursor) and run `/password-space:setup-password-space` again.
   Stop here.
3. **Node is v20 or newer:** run the bundled CLI yourself with Bash (one command, no secrets in it):

   ```bash
   CLI="${CLAUDE_PLUGIN_ROOT}/dist/cli.js"; [ -f "$CLI" ] || CLI="$(find "$HOME/.claude/plugins" "$HOME/.cursor/plugins" -path '*password-space*/dist/cli.js' 2>/dev/null | head -1)"; [ -n "$CLI" ] && node "$CLI" setup --yes || echo "password-space cli.js not found"
   ```

   If it prints `Store created` or `Store already exists`, setup worked. Tell the user to run `/mcp` (or restart Claude Code) once so the save / remove tools connect. If `cli.js` is not found, tell them to reinstall the plugin (`/plugin install password-space@password-space-marketplace`).

## 3. Tell the user it is ready

Say `tell_user` from the result in plain words (no JSON, no paths unless they ask). In short:

> Password Space is ready. Your secrets stay in your Mac's Keychain. From now on just tell me things like:
> - "save this token as GITHUB_TOKEN: ghp_…"
> - "use GITHUB_TOKEN to list my repos"
> - "remove GITHUB_TOKEN"
> Any later session finds saved secrets by name, so you only give me a token once.

## Rules

- Never repeat, print or echo a secret value, even one the user just gave you.
- Never ask for a passphrase or unlock step (there is none).
- Summarize errors with `howToFix` / `recovery` in plain words; never dump JSON.
- If the result has `legacy_encrypted_vault: true`, say the old `vault.db` was left untouched and its secrets need to be saved again.
- Do not call `vault_manager` for setup.
