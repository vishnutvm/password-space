# Password Space in Claude Code

The same plugin folder (`plugins/password-space`) works in Claude Code. It ships
the MCP server, the Terminal CLI, the setup skill and command, and two
Claude Code hooks. Requires **Node.js 20+** and Claude Code with plugin support.

## Install

In Claude Code:

```text
/plugin marketplace add vishnutvm/password-space
/plugin install password-space@password-space-marketplace
```

Restart Claude Code so the MCP server and hooks load.
Check with `/mcp`: you should see `plugin:password-space:password-space`.

To try a local checkout without the marketplace:

```bash
claude --plugin-dir /path/to/password-space/plugins/password-space
```

If you wired the MCP server by hand before (`claude mcp add password-space …`),
remove that entry so the tools are not registered twice:
`claude mcp remove password-space`.

## First run

1. Run `/password-space:setup-password-space` (plugin commands are namespaced
   in Claude Code), or ask Claude to call `vault_onboard`.
2. Run the `copy_paste_command` it shows in your own Terminal. The MCP server
   resolves the bundled CLI to an absolute path, so you get something like:
   ```bash
   node "/Users/you/.claude/plugins/cache/.../password-space/dist/cli.js" setup
   node "/Users/you/.claude/plugins/cache/.../password-space/dist/cli.js" set
   ```
3. Back in Claude Code, refer to secrets by name and let Claude use
   `inject_secret`. Never paste values into the prompt.

The store is the same as in Cursor: `~/.password-space/secrets.json`
(or a real absolute `PASSWORD_SPACE_HOME`). Cursor and Claude Code share it.

## What's in the package

| File | Used by |
| --- | --- |
| `.claude-plugin/marketplace.json` (repo root) | Claude Code marketplace |
| `plugins/password-space/.claude-plugin/plugin.json` | Claude Code manifest; declares the MCP server (`${CLAUDE_PLUGIN_ROOT}/dist/index.js`) and points at the Claude hooks file |
| `plugins/password-space/hooks/claude-hooks.json` | Claude Code hooks |
| `plugins/password-space/hooks/hooks.json` | Cursor hooks (Claude Code ignores its events) |
| `.cursor-plugin/…`, `plugins/password-space/mcp.json` | Cursor only |
| `skills/`, `commands/`, `dist/`, `scripts/` | Both |

## Hooks: Cursor vs Claude Code

| Cursor hook | Claude Code equivalent | Behaviour |
| --- | --- | --- |
| `sessionStart` → `session-vault-hint.mjs` | `SessionStart` (startup) → `claude-session-hint.mjs` | Adds a setup hint to Claude's context when `secrets.json` does not exist. Silent once the store exists. |
| `beforeSubmitPrompt` → `prompt-guard.mjs --format cursor` | `UserPromptSubmit` → `prompt-guard.mjs --format claude` | **Blocks** a prompt that contains any stored secret value and tells you which secret name matched. Same script for both. |

What does not carry over:

- **Blocked, not rewritten.** Both hooks block the prompt; Claude Code erases
  it. Retype it using the secret's name.
- **Tool output is not filtered.** Neither hook sees output from Bash or other
  tools. Have Claude run commands as `cli.js run -s NAME -- <command>`: the
  value goes into the command's environment and is redacted from its output.
- **Matching is exact.** Only stored values (keychain or file) and live
  `inject/*.env` values are detected. Values shorter than 6 characters are skipped to
  avoid false blocks on common strings.

Keychain values are matched by a keyed fingerprint stored in `secrets.json`, so
the hook never reads the values themselves. If the keychain cannot be reached,
the hook lets the prompt through and prints a warning. It never prints a value,
only the secret's name.
