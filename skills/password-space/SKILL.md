---
name: password-space
description: Install · One-time Setup · Start Using. Follow vault_onboard primary_action — Terminal-only interactive CLI for setup/add/remove; never ask users to edit mcp.json or clone the repo. Lock/unlock not needed.
---

# Password Space

Local **plain-text named secrets** on the user's machine (`~/.password-space/secrets.json`). **One obvious next step** — follow `primary_action` only.

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
   - After Terminal steps: `vault_status` / `list_secrets` / `inject_secret`.
5. **No `git clone`.** The CLI ships inside the marketplace plugin. Clone is optional for contributors only.
6. Secret **name + value** go in **Terminal only** — **never** in chat, **never** via elicitation, **never** via App forms.

### Product path

- Store is **local plain files** — values are readable at rest on disk (mode `0600`).
- **Lock / unlock / passphrase are not needed.**
- Name a secret once in Terminal, then ask the agent to use it **by name** (`inject_secret`).

### Never do this

- Paste secret values into chat
- Ask the user to edit **`mcp.json`** or explain MCP
- Lead with Vault Manager / App forms for add or remove
- Tell newcomers to clone the repo or run `pnpm install` for day-1 setup
- Require `vault_unlock` / passphrase before `inject_secret`
- Mention **Plugins → Configure** for vault home (default is `~/.password-space`)

### Vault Manager

Do **not** call **`vault_manager`** for setup or secrets. It is status-only. Human UX is the Terminal CLI.

## After store exists

- **Terminal** `set` / `remove` / interactive menu — primary way to add or delete
- **`list_secrets`** / **`vault_status`** / **`inject_secret`** — MCP by name (no unlock)
- Soft-compat: `vault_init` / `vault_unlock` / `vault_lock` may still exist but are **not** required

## Legacy encrypted vault

If `vault_onboard` reports `legacy_encrypted_vault`, the old `vault.db` is **left untouched**. Tell the user to re-add secrets with Terminal `set` into the new plain store. Do not invent a destructive migrate-by-default.

## Never

- Secret values in chat
- Ask the user to edit **`mcp.json`**
- Dump Vault Manager App HTML/JS / MCP resource bodies into chat
- Guide users to App forms for add / remove

Vault home defaults to **`~/.password-space`**. Optional override: a real absolute `PASSWORD_SPACE_HOME` in the process / MCP Environment (never an unresolved `${PASSWORD_SPACE_HOME}`).

Safe line: *"Next step: open Terminal and paste this command. Type the secret name and value there (hidden). I won't ask for it in chat. No unlock needed. No clone needed."*
