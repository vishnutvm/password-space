---
name: password-space
description: Install · One-time Setup · Start Using. Before asking the user for any API key, token or password, check list_secrets and use it by name via `run`. When the user hands you a secret, save it once with store_secret. Setup follows vault_onboard primary_action (Terminal CLI); never ask users to edit mcp.json or clone the repo.
---

# Password Space

Named secrets on the user's machine: values in the **OS keychain**, names in `~/.password-space/secrets.json`. **One obvious next step** — follow `primary_action` only.

## Newcomer path (default = plugin Terminal CLI)

1. User runs **`/setup-password-space`** (or asks to set up Password Space).
2. Call **`vault_onboard`**.
3. Follow **`primary_action.do_this` exactly**.
4. When `recommended_path` is **`cli_setup`** / **`cli_set`** (usual case):
   - Show **`copy_paste_command`** (Terminal).
   - Typical form: `node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup|set` (or absolute path when MCP resolves the bundled CLI).
   - Bare `node "…/dist/cli.js"` opens the **interactive menu** (setup, add, remove, list, status).
   - Tell the user to run it and enter the **secret name**, then the **value** at the **hidden** prompt.
   - **Do not** require unlock or a passphrase.
   - After Terminal steps: `vault_status` / `list_secrets`, then use secrets with `run` (below).
5. **No `git clone`.** The CLI ships inside the marketplace plugin. Clone is optional for contributors only.
6. For setup, the user types secret **name + value** in **Terminal** — **never** ask via elicitation or App forms. If the user prefers to hand you a key, save it with `store_secret` (below).

### Product path

- Values live in the **OS keychain** (macOS Keychain, Windows Credential Manager, Linux Secret Service). Without one they fall back to `secrets.json` in plain text; if `vault_status` shows `migrate_command`, suggest the user run it in Terminal.
- **Lock / unlock / passphrase are not needed.**
- Name a secret once in Terminal, then use it **by name**.

## When a task needs a key, token or password (agents)

1. **Check the vault first.** Call `list_secrets`. If a fitting name is there (e.g. `GITHUB_TOKEN`), use it by name (below). **Do not ask the user for it again.**
2. **Not there?** Ask the user for it once, and say you will save it in their Password Space vault so they never have to give it again (or they can run Terminal `set` themselves).
3. **The user hands you a secret** (in chat or otherwise): immediately call `store_secret` with a clear name (`GITHUB_TOKEN`, `OPENAI_API_KEY`, `NPM_TOKEN`) and a short `notes` saying what it is for. Then tell the user *"Saved as GITHUB_TOKEN"* — never repeat the value, never put it in the name, notes or tags.
4. **Name already exists** (`code: "already_exists"`): nothing was changed. Use the stored one. Only if the user says it is a new / rotated key, call `store_secret` again with `overwrite: true`.
5. **Remove** only when the user asks to delete or forget a secret: `remove_secret` with its name.
6. A value that is too long for the keychain is refused with a size message (about 1.9 KB on macOS); pass that message on to the user.

Every add / update / remove is audit-logged by name (never the value).

## Using a secret (agents)

Run the command through the CLI so the value goes straight into the process environment:

```bash
node "<plugin>/dist/cli.js" run -s GITHUB_TOKEN -- gh repo list
node "<plugin>/dist/cli.js" run -s OPENAI_API_KEY=openai-prod -- npm test
```

`vault_status` returns the exact `run_command` with the right path. Output is redacted for you. Never `cat ~/.password-space/*`, never `get`, never echo the variable. Use `inject_secret` only when a command cannot be wrapped with `run`, and then only source the file in the same command (`set -a; . FILE; set +a; <command>`). It is deleted after 60 seconds. A prompt that contains a stored value is blocked by the plugin hook, and the tool hook blocks `get`, direct keychain lookups (`security`, `secret-tool`) and reads of `secrets.json` or inject files. Do not try to work around a block: use the secret by name. `resolve_secret` is off unless the user turned it on; never ask them to.

### Never do this

- Echo, print or paste secret values into chat (including ones the user just gave you)
- Ask the user to edit **`mcp.json`** or explain MCP
- Lead with Vault Manager / App forms for add or remove
- Tell newcomers to clone the repo or run `pnpm install` for day-1 setup
- Ask for a passphrase or an unlock step (there is none)
- Mention **Plugins → Configure** for vault home (default is `~/.password-space`)

### Vault Manager

Do **not** call **`vault_manager`** for setup or secrets. It is status-only. Human UX is the Terminal CLI.

## After store exists

- **Terminal** `set` / `remove` / interactive menu — the user's way to add or delete
- **`store_secret`** / **`remove_secret`** — your way, when the user hands you a key or asks you to forget one
- **`list_secrets`** / **`vault_status`** — MCP by name; **`run -s NAME -- <command>`** to use one

## Legacy encrypted vault

If `vault_onboard` reports `legacy_encrypted_vault`, the old `vault.db` is **left untouched**. Tell the user to re-add secrets with Terminal `set`. Do not invent a destructive migrate-by-default.

## Never

- Repeat secret values in chat
- Ask the user to edit **`mcp.json`**
- Dump Vault Manager App HTML/JS / MCP resource bodies into chat
- Guide users to App forms for add / remove

Vault home defaults to **`~/.password-space`**. Optional override: a real absolute `PASSWORD_SPACE_HOME` in the process / MCP Environment (never an unresolved `${PASSWORD_SPACE_HOME}`).

Safe line: *"Next step: open Terminal and paste this command. Type the secret name and value there (hidden). I won't ask for it in chat. No unlock needed. No clone needed."*
