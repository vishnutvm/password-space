# Password Space in Cursor

The plugin folder (`plugins/password-space`) installs from this repository as a
Cursor marketplace. It ships the MCP server, the Terminal CLI, the setup skill
and command, and three hooks. Requires **Node.js 20+** (`node -v`).

## Install

1. **Cursor Settings → Plugins** (or **Dashboard → Plugins & MCPs** for a team marketplace).
2. **Add marketplace → Import from GitHub** and paste
   `https://github.com/vishnutvm/password-space`.
3. Install **password-space**, then reload the window
   (*Developer: Reload Window*).
4. In **Settings → MCP**, check that **password-space** is on and its tools are
   allowed for the agent.

There is nothing to configure. The store lives in `~/.password-space`; to use
another folder, set `PASSWORD_SPACE_HOME` to a real absolute path in the MCP
server's environment.

## First run

1. In chat, run **`/setup-password-space`** (or ask the agent to call
   `vault_onboard`). It answers with one next step and a command to paste.
2. Run that command in your own Terminal. It uses the CLI bundled with the
   plugin, so no clone is needed:
   ```bash
   node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup   # create the store, pick keychain or file
   node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" set     # name, then the value at a hidden prompt
   node "${CURSOR_PLUGIN_ROOT}/dist/cli.js"         # interactive menu
   ```
   When the MCP server knows the absolute path to `cli.js`, the command it shows
   uses that path instead.
3. Back in Cursor, ask the agent to use the secret **by name**. It runs commands
   as `cli.js run -s NAME -- <command>`, so the value goes into that command's
   environment and never into the chat.

To test the whole flow in a real Cursor app, follow
[Check the plugin in Cursor](cursor-check.md).

## Hooks

| Hook | Script | What it does |
| --- | --- | --- |
| `sessionStart` | `session-vault-hint.mjs` | Adds a setup hint when no store exists yet |
| `beforeSubmitPrompt` | `prompt-guard.mjs --format cursor` | Warns when a prompt contains a stored value, and lets it through (`PASSWORD_SPACE_PROMPT_GUARD=block` blocks instead) |
| `beforeShellExecution`, `beforeReadFile` | `shell-guard.mjs --format cursor` | Blocks `get`, direct keychain lookups and reads of `secrets.json` or inject files |

See [SECURITY.md](../SECURITY.md) for what the hooks do and do not cover.

## Reinstalling cleanly

Uninstalling the plugin never touches your secrets: the store in
`~/.password-space` and the values in the OS keychain stay where they are.

If setup seems stuck, uninstall the plugin, then optionally clear Cursor's
cached copies before installing again:

| Location | What it is |
| --- | --- |
| `~/.cursor/plugins/cache/vishnutvm-password-space` | Cached plugin bundle |
| `~/.cursor/plugins/marketplaces/github.com/vishnutvm/password-space` | Marketplace checkout |
| `~/.cursor/projects/<project>/mcps/plugin-password-space-password-space` | Per-workspace MCP tool cache |

After reinstalling and reloading, these should hold:

| Check | Expected |
| --- | --- |
| `vault_onboard` | A `primary_action` with a `copy_paste_command` that runs `cli.js`, and no secret values |
| `vault_status` | `initialized: true` once the store exists, with the storage backend in use |
| `list_secrets` | Your secret names, never values |

## Manual MCP configuration

Without the marketplace, point Cursor (or any MCP client) at the bundled server:

```json
{
  "mcpServers": {
    "password-space": {
      "command": "node",
      "args": ["/absolute/path/to/password-space/plugins/password-space/dist/index.js"]
    }
  }
}
```

A manual setup gets the MCP tools only. Hooks and the skill come with the plugin.
