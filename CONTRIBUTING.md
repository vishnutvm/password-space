# Contributing

## Principles

1. **Chat stays clean** — MCP list/metadata tools must not return values; agents use secrets by name through `run`.
2. **The agent does setup** — `setup_vault` creates the store; the user never pastes a setup command. Values are entered by handing them to the agent (`store_secret`) or at a hidden Terminal prompt, never via App UI / Configure variables.
3. **OS keychain store** — values in the OS keychain, names in `secrets.json` (mode `0600`), plain-file fallback only without a keychain; do not reintroduce unlock as a required gate without an explicit product decision.
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
| `packages/vault` | Store, OS keychain backends, inject, redact |
| `packages/cli` | Human CLI, published to npm as `password-space` (also bundled to plugin `dist/cli.js`) |
| `packages/mcp-server` | MCP tools for agents |
| `plugins/password-space` | Cursor and Claude Code plugin, also used by Codex (bundled MCP + CLI + skill + hooks + logo) |
| `scripts/` | Bundling, version sync, hook script tests |

## Pull requests

- Keep PRs focused; include tests for store behavior or MCP no-leak contracts when touching those paths.
- Do not commit real secrets, `~/.password-space` data, or `.demo-data/`.
- Update README / SECURITY.md if behavior or threat model changes.
- Add a line under `## [Unreleased]` in [CHANGELOG.md](./CHANGELOG.md) for anything a user would notice.
- Do not change version numbers in a feature PR; they move together at release time.

## Versions and releases

One version covers the whole project. The root `package.json` is the source of
truth, and `pnpm version:check` (also run by `pnpm test`) fails if any package,
plugin manifest, marketplace entry or MCP server identity disagrees. Releases
are cut by a maintainer; the steps are in [docs/RELEASING.md](./docs/RELEASING.md).

## Reporting security issues

See [SECURITY.md](./SECURITY.md). Never in a public issue.

## Code of conduct

Be respectful. Security-sensitive discussions belong in private channels when they involve unfixed issues.
