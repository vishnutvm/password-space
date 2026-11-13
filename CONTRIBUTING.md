# Contributing

Thanks for helping make Password Space better.

## Principles

1. **Chat stays clean** — MCP list/metadata tools must not return values; prefer inject handles.
2. **Terminal-only human UX** — no App UI / Configure variables for secret entry.
3. **Plain local store** — product path is named secrets in `secrets.json` (mode `0600`); do not reintroduce unlock as a required gate without an explicit product decision.
4. **Local-first** — sync/cloud features are out of scope until designed with a threat model update.
5. **No destructive migrate-by-default** — never wipe a user's existing `~/.password-space` or legacy `vault.db`.

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

Requires **Node.js ≥ 20**.

After changing MCP, CLI, or vault sources, `pnpm build` rebuilds packages and rebundles `plugins/password-space/dist/index.js` (MCP) and `dist/cli.js` (Terminal CLI) for marketplace installs. External users must not need a clone for setup/set.

## Package layout

| Path | Role |
| --- | --- |
| `packages/vault` | Plain store, inject, redact (legacy crypto helpers may remain unused) |
| `packages/cli` | Human CLI (also bundled to plugin `dist/cli.js`) |
| `packages/mcp-server` | MCP tools for agents |
| `plugins/password-space` | Cursor plugin (bundled MCP + CLI + skill + hooks + logo) |
| `skills/password-space` | Convenience Skill mirror |
| `hooks/` | Standalone redaction utility + hook examples |

## Pull requests

- Keep PRs focused; include tests for store behavior or MCP no-leak contracts when touching those paths.
- Do not commit real secrets, `~/.password-space` data, or `.demo-data/`.
- Update README / SECURITY.md if behavior or threat model changes.
- Keep plugin Skill (`plugins/password-space/skills/…`) and root `skills/` mirror in sync when editing agent guidance.

## Code of conduct

Be respectful. Security-sensitive discussions belong in private channels when they involve unfixed issues.
