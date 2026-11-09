# Password Space (Cursor plugin)

Local encrypted credential vault for Cursor agents. Secrets stay out of chat: agents use MCP `inject_secret` and handles like `ps://NAME`.

## What this plugin includes

| Component | Role |
| --- | --- |
| MCP (`dist/index.js`) | Self-contained vault + MCP tools (init/unlock/store/list/inject) |
| Skill | Onboarding via MCP; prefer inject; never paste secrets in chat |
| Hook | `beforeSubmitPrompt` redaction via `scripts/redact.mjs` |

## After install (primary path)

No `git clone` or `pnpm` required.

1. In chat, run **`/setup-password-space`** or ask: *“Set up Password Space using the onboarding checklist.”*
2. When Cursor shows an **MCP tool approval** for `vault_init` or `vault_unlock`, type your **passphrase** in the form field (8+ characters). **Do not approve with an empty form** — that is the most common setup failure.
3. Optional: **Cursor → Settings → MCP → password-space → Environment** → set `PASSWORD_SPACE_PASSPHRASE` so you are not prompted on every unlock (never paste it into chat).

Agent flow:

1. `vault_onboard` or `vault_status`
2. `vault_init` → passphrase in approval form only
3. `vault_unlock`
4. `vault_set_secret` → name + value in approval form only
5. `inject_secret` when needed

Vault home defaults to `~/.password-space`. Override with `PASSWORD_SPACE_HOME` in MCP Environment (absolute path). Plugin **Configure** has no `variables` block (Cursor schema limitation) — use MCP Environment instead.

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
