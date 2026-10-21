# Contributing

Thanks for helping make Password Space better.

## Principles

1. **Ciphertext at rest** — never weaken encryption or log plaintext secrets.
2. **Chat stays clean** — MCP list/metadata tools must not return values; prefer inject handles.
3. **No invented crypto** — use Node `crypto` AEAD/KDF or other audited libraries.
4. **Local-first** — sync/cloud features are out of scope until designed with a threat model update.

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

Requires **Node.js ≥ 20** (uses built-in `node:sqlite`).

After changing MCP or vault sources, `pnpm build` rebuilds packages and rebundles `plugins/password-space/dist/index.js` for marketplace installs.

## Package layout

| Path | Role |
| --- | --- |
| `packages/vault` | Crypto, SQLite store, session, redact, inject |
| `packages/cli` | Human CLI |
| `packages/mcp-server` | MCP tools for agents |
| `plugins/password-space` | Cursor plugin (bundled MCP + skill + hooks + logo) |
| `skills/password-space` | Convenience Skill mirror |
| `hooks/` | Standalone redaction utility + hook examples |

## Pull requests

- Keep PRs focused; include tests for crypto, lock/session state, or MCP no-leak contracts when touching those paths.
- Do not commit real secrets, `~/.password-space` data, session files, or `.demo-data/`.
- Update README / SECURITY.md if behavior or threat model changes.
- Keep plugin Skill (`plugins/password-space/skills/…`) and root `skills/` mirror in sync when editing agent guidance.

## Code of conduct

Be respectful. Security-sensitive discussions belong in private channels when they involve unfixed issues.
