# Password Space in OpenAI Codex

Codex (CLI and IDE extension) uses the same plugin folder (`plugins/password-space`)
as Cursor and Claude Code: the bundled MCP server, the Terminal CLI, the skill and
the hook scripts. There is no Codex plugin package yet, so you register it in
`~/.codex/config.toml`. One command does that for you. Requires **Node.js 20+**.

The store is shared: `~/.password-space` (or a real absolute `PASSWORD_SPACE_HOME`)
is the same for Cursor, Claude Code and Codex.

## 1. Get the plugin folder

Use any copy of `plugins/password-space`:

- **Already use Cursor or Claude Code with the plugin?** Use its installed folder
  (the `vault_status` tool shows the CLI path; the plugin folder is the parent of `dist/`).
- **Codex only:** clone the repo once. The bundles are committed, so there is no build step.
  ```bash
  git clone --depth 1 https://github.com/vishnutvm/password-space ~/password-space
  ```

The config points at absolute paths in that folder, so keep it where it is. If you
move it, run step 2 again with the new path (after removing the old block).

## 2. Register it with Codex

```bash
node ~/password-space/plugins/password-space/dist/cli.js codex-setup --write
```

This appends a block to `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`). It never
edits or removes your existing lines, skips anything Password Space already added, and
creates the file with mode 0600 if it is missing. It also copies the skill to
`~/.agents/skills/password-space/SKILL.md` unless one is already there.

Run it with the plugin's own `dist/cli.js`. The npm `password-space` CLI does not ship
the MCP server or hooks, so with it you must pass `--plugin-root <plugin folder>`.

To see the block first without writing anything, drop `--write`. Options:
`--no-hooks`, `--no-skill`, `--plugin-root <dir>`, `--codex-home <dir>`.

The block it writes (paths are filled in for your machine):

```toml
[mcp_servers.password-space]
command = "node"
args = ["/Users/you/password-space/plugins/password-space/dist/index.js"]

[[hooks.SessionStart]]
matcher = "startup"

[[hooks.SessionStart.hooks]]
type = "command"
command = "node \"/Users/you/password-space/plugins/password-space/scripts/claude-session-hint.mjs\" --host codex"
timeout = 10

[[hooks.UserPromptSubmit]]

[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = "node \"/Users/you/password-space/plugins/password-space/scripts/prompt-guard.mjs\" --format codex"
timeout = 10
```

If `PASSWORD_SPACE_HOME` is set when you run `codex-setup`, the block also gets
`[mcp_servers.password-space.env]` with that path. The hooks read it from the shell
that starts Codex, so export it there too.

If your config already uses an inline `mcp_servers = { … }` or `hooks = { … }`,
`--write` stops without changing anything; paste the printed block by hand instead,
merged into your existing tables.

Prefer the Codex CLI for the MCP part? This is equivalent to the first table:

```bash
codex mcp add password-space -- node ~/password-space/plugins/password-space/dist/index.js
```

## 3. Restart Codex and trust the hooks

1. Restart Codex and run `/mcp`: `password-space` should be listed.
2. Run `/hooks` and trust the two Password Space hooks. Codex skips new or changed
   hooks until you trust them, so the prompt guard does nothing until you do this.

## 4. First run

Ask Codex to "set up Password Space" (the skill calls `vault_onboard`), or run the
CLI yourself in a Terminal:

```bash
node ~/password-space/plugins/password-space/dist/cli.js setup
node ~/password-space/plugins/password-space/dist/cli.js set     # name, then hidden value
```

Names and values go in the Terminal only, never in the Codex prompt.

## How agents use the vault in Codex

Same rules as the other tools; the skill at `~/.agents/skills/password-space` carries
them. Codex picks the skill up by its description, or you can mention it with
`$password-space`. In short:

- Check what exists with `vault_status` / `list_secrets` (names only).
- Use a secret by running the command through the CLI, so the value goes into that
  process's environment and is redacted from its output:
  ```bash
  node "<plugin>/dist/cli.js" run -s GITHUB_TOKEN -- gh repo list
  ```
  `vault_status` returns the exact `run_command` with the right path.
- Use `inject_secret` only when a command cannot be wrapped with `run`.
- Never print, `cat`, `get` or echo a value, and never ask for one in chat.

If you prefer `AGENTS.md` over the skill (for example, to apply it to one repo),
this is enough:

```markdown
## Secrets
Secrets live in Password Space. Never ask for, print or paste secret values.
Check names with the password-space MCP tools (vault_status, list_secrets) and run
commands that need a secret as `node "<plugin>/dist/cli.js" run -s NAME -- <command>`.
```

**Codex sandbox.** Commands Codex runs go through its sandbox. `run -s NAME -- <cmd>`
has to read the OS keychain, and most commands that use a token need the network,
which the default sandbox blocks. Expect Codex to ask for approval to run these
outside the sandbox. The MCP server itself is started by Codex, not inside the
command sandbox.

## What carries over from Cursor and Claude Code

| Piece | In Codex | Notes |
| --- | --- | --- |
| MCP server and tools | Yes | Same `dist/index.js`, registered in `config.toml`. |
| Terminal CLI (`dist/cli.js`) | Yes | Same commands, including `run`. |
| Skill | Yes | Copied to `~/.agents/skills/password-space`. The copy does not update with the plugin; delete it and run `codex-setup --write` again after an update. |
| Setup command (`/setup-password-space`) | No | Codex has no plugin commands here. Ask Codex to set up Password Space, or call `vault_onboard`. |
| SessionStart setup hint | Yes | `claude-session-hint.mjs --host codex`. Adds a hint to the context when no store exists; silent otherwise. |
| Prompt guard | Yes, after `/hooks` trust | `prompt-guard.mjs --format codex`. Never blocks. A prompt that contains a stored value goes through; you get a warning and Codex is told the secret's name and not to repeat the value. `PASSWORD_SPACE_PROMPT_GUARD=block` blocks instead. |
| Tool output filtering | No | As in Claude Code, hooks do not see command output. Use `run`, which redacts. |
| Marketplace install | Not yet | Codex has its own plugin format and marketplaces; packaging Password Space as a Codex plugin is a possible follow-up. |

## Remove

Delete the `# Password Space` block (the `[mcp_servers.password-space]` table and the
two hook entries) from `~/.codex/config.toml`, and `~/.agents/skills/password-space`.
Your secrets stay in the store.
