# Password Space (Cursor plugin)

Local encrypted credential vault for Cursor agents. Secrets stay out of chat: agents use MCP `inject_secret` and handles like `ps://NAME`.

## What this plugin includes

| Component | Role |
| --- | --- |
| MCP (`dist/index.js`) | `list_secrets`, `get_secret_metadata`, `inject_secret`, `resolve_secret` |
| Skill | Prefer inject; never paste plaintext secrets in chat |
| Hook | `beforeSubmitPrompt` redaction via `scripts/redact.mjs` |
| Variable | `PASSWORD_SPACE_HOME` — vault directory (optional; default `~/.password-space`) |

## After install

1. **Unlock is required** — the plugin does not store your passphrase. From this repo (or a local clone):

   ```bash
   pnpm install && pnpm build
   pnpm password-space init      # once
   pnpm password-space unlock   # each session
   ```

2. Optional: **Plugins → Configure** → set `PASSWORD_SPACE_HOME` if your vault is not at `~/.password-space`.

3. Agents should call **`inject_secret`**, not paste values into the conversation.

## Manual MCP (without marketplace)

See the [root README](../../README.md) for a hand-written `mcp.json` pointing at `plugins/password-space/dist/index.js`.

## License

MIT
