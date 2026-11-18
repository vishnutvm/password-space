# Password Space in Claude Code

The same plugin folder (`plugins/password-space`) works in Claude Code. It ships
the MCP server, the Terminal CLI, the setup skill and command, and three
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

Setup is one command. You do not paste anything into Terminal.

1. Run `/password-space:setup-password-space` (plugin commands are namespaced
   in Claude Code), or just say *"set up Password Space"*. Claude calls the
   `setup_vault` tool, which creates `~/.password-space` with values in your
   OS keychain, and tells you it is ready.
2. Hand Claude a key once: *"save this token as GITHUB_TOKEN: ghp_…"*. Claude
   calls `store_secret` and replies "Saved as GITHUB_TOKEN" without repeating
   the value.
3. Use it by name, in this session or any later one: *"use GITHUB_TOKEN to list
   my repos"*. Claude checks `list_secrets`, then runs the command as
   `cli.js run -s GITHUB_TOKEN -- <command>`, so the value goes into that
   command's environment and is redacted from its output.
4. *"Remove GITHUB_TOKEN"* deletes it (`remove_secret`).

**If setup says Node.js is missing.** The MCP server needs Node.js 20 or
newer. On a Mac, install the LTS `.pkg` from <https://nodejs.org> (or
`brew install node`), quit and reopen Claude Code, and run the setup command
again. If the MCP tools are not connected but Node is fine, the setup command
has Claude run the bundled CLI itself (`cli.js setup --yes`) and then asks you
to run `/mcp` once.

**Keys you do not want in chat.** A key you paste stays in that chat's
history. To keep one out of chat entirely, type it in Terminal at a hidden
prompt instead: ask Claude for the `set` command (`vault_status` returns the
exact path).

The store is the same as in Cursor: `~/.password-space/secrets.json`
(or a real absolute `PASSWORD_SPACE_HOME`). Cursor, Claude Code and Codex ([codex.md](./codex.md)) share it.

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
| `beforeShellExecution` + `beforeReadFile` → `shell-guard.mjs --format cursor` | `PreToolUse` (`Bash`, `Read`, `Grep`) → `shell-guard.mjs --format claude` | **Blocks** agent tool calls that would read a value directly: `get`, keychain lookups, `secrets.json`, inject files. Same script for both. |

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
