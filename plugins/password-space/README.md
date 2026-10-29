# Password Space (Cursor plugin)

Local encrypted credential vault for Cursor agents. Secrets stay out of chat: agents use MCP `inject_secret` and handles like `ps://NAME`.

## What this plugin includes

| Component | Role |
| --- | --- |
| MCP (`dist/index.js`) | Self-contained vault + MCP tools (init/unlock/store/list/inject) |
| Skill | Onboarding via MCP; prefer inject; never paste secrets in chat |
| Hook | `beforeSubmitPrompt` redaction via `scripts/redact.mjs` |
| Variable | `PASSWORD_SPACE_HOME` — vault directory (optional; default `~/.password-space`) |

## After install (primary path)

No `git clone` or `pnpm` required for day-1 setup. Ask the agent, for example:

> Set up Password Space: check vault status, init if needed, unlock, then store my API token.

The agent should call:

1. `vault_status`
2. `vault_init` (passphrase via tool arg / UI prompt or `PASSWORD_SPACE_PASSPHRASE` — **not** chat)
3. `vault_unlock`
4. `vault_set_secret` (value via tool arg — **not** chat)
5. `inject_secret` when a credential is needed

Optional: **Plugins → Configure** → set `PASSWORD_SPACE_HOME` if your vault is not at `~/.password-space`.

## MCP tools

| Tool | Returns secret value? | Use |
| --- | --- | --- |
| `vault_status` | No | Initialized? Unlocked? |
| `vault_init` | No | Create vault |
| `vault_unlock` / `vault_lock` | No | Session unlock / lock |
| `vault_set_secret` | No (metadata only) | Store/update secrets |
| `list_secrets` | No | Discover names / ids / tags |
| `get_secret_metadata` | No | One secret’s metadata |
| `inject_secret` | **No** (writes env file) | **Preferred** agent access |
| `resolve_secret` | Yes, if `confirm_redaction: true` | Last resort only |

## Optional CLI (power users)

From a local clone of this repo: `pnpm install && pnpm build`, then `pnpm password-space …`. See the [root README](../../README.md).

## Manual MCP (without marketplace)

See the [root README](../../README.md) for a hand-written `mcp.json` pointing at `plugins/password-space/dist/index.js`.

## License

MIT
