# Fresh install verification (Cursor plugin)

Use this after **uninstalling** Password Space or when setup feels stuck. Your secret store at `~/.password-space` (`secrets.json`) is **separate** from the plugin — uninstall does not delete it unless you remove that folder yourself.

## Before you reinstall (uninstall checklist)

In **Cursor → Settings → Plugins**, confirm **password-space** is **not** installed.

Optional deep clean on macOS (only if you want a totally fresh plugin fetch):

| Location | What it is |
| --- | --- |
| `~/.cursor/plugins/cache/vishnutvm-password-space` | Cached plugin bundle |
| `~/.cursor/plugins/marketplaces/github.com/vishnutvm/password-space` | Marketplace checkout |
| `~/.cursor/projects/<project>/mcps/plugin-password-space-password-space` | Per-workspace MCP tool cache |

Do **not** delete `~/.password-space` if you want to keep your existing secrets.

Do **not** edit `~/.cursor/mcp.json` unless you maintain a manual MCP entry yourself.

## Reinstall (about 2 minutes)

1. **Import marketplace:** Settings → Plugins → **Add marketplace** → `https://github.com/vishnutvm/password-space` → install **password-space**.
2. **Reload Cursor** (Cmd+Shift+P → *Developer: Reload Window*) so MCP and hooks load cleanly.
3. **Enable tools:** Settings → MCP → confirm **password-space** is on and tools are allowed for the agent.
4. In chat, run **`/setup-password-space`** or ask: *"Set up Password Space with vault_onboard."*
5. Follow **`primary_action`**: open **Terminal** and run **`copy_paste_command`** (plugin-bundled CLI — typically `node "${CURSOR_PLUGIN_ROOT}/dist/cli.js" setup`). There is **no passphrase** — `setup` just creates `~/.password-space/secrets.json` (mode `0600`) if it is missing. Then run `…/dist/cli.js set` to add a secret (name, then hidden value). **No git clone.** If an old `vault.db` exists from the encrypted release, it is left untouched; re-add those secrets with `set`.

## Success checks

| Check | Good sign |
| --- | --- |
| `vault_onboard` | `human_summary`, `progress`, `trust_line`, `copy_paste_command` mentioning `cli.js` — no secret values |
| `vault_status` | `initialized: true` once `secrets.json` exists; `secret_count` matches what you added |
| `list_secrets` | Your secret names (no values) |
| Chat | Agent never asks you to paste tokens here, never asks for a passphrase or unlock, and never asks you to clone |

Optional: **Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_HOME` (a real absolute path) to use a store folder other than `~/.password-space`. `PASSWORD_SPACE_PASSPHRASE` is no longer used.

## Developers (repo verify)

```bash
cd /path/to/password-space   # contributors only
git pull origin main
pnpm test                    # mcp-server includes vault_onboard + plugin CLI command tests
pnpm build:plugin            # refreshes dist/index.js + dist/cli.js
ls plugins/password-space/dist/cli.js
```

See also [onboarding.md](./onboarding.md).
