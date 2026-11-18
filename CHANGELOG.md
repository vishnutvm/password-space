# Changelog

All notable changes to Password Space are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). While the version is below 1.0.0,
a minor bump (0.x.0) may change behavior or storage; read its notes before
upgrading.

One version covers the whole project: the Cursor and Claude Code plugins, the
bundled MCP server and the `password-space` CLI on npm. See
[docs/RELEASING.md](./docs/RELEASING.md) for how a release is cut.

## [Unreleased]

### Changed

- Setup is done by the agent. `/password-space:setup-password-space` (Claude
  Code) and `/setup-password-space` (Cursor) now call the new `setup_vault` MCP
  tool, which creates the store in the OS keychain and moves old plain-text
  values into it. The user no longer pastes a Terminal command. If the MCP
  server cannot start, the command checks `node -v`, explains how to install
  Node.js 20+, or runs the bundled `cli.js setup --yes` itself.
- `vault_onboard` / `vault_status` now return `primary_action.id` of
  `setup_vault` or `ready` (was `cli_setup` / `cli_set`), and
  `terminal_fallback` instead of `copy_paste_command`.
- `list_secrets` before setup returns an empty list pointing at `setup_vault`
  instead of an error.
- `password-space setup --yes` now answers yes to moving plain-text values into
  the keychain (it used to skip the move).

### Fixed

- The skill and setup command now trigger on phrases like "set up password
  space", "save this token" and "remove this token".
- The plugin-path lookup now matches Claude Code's versioned install folder
  (`…/password-space/<version>/dist/cli.js`); the old `find` pattern missed it.

### Removed

- Unused code left from the encrypted vault, the duplicate root `skills/` and
  `hooks/` copies, the unused `redact.mjs` hook script, and stale internal
  audit notes under `docs/`. Cursor install docs are now one page,
  [docs/cursor.md](./docs/cursor.md).

### Security

- Dependency updates for `npm audit` findings: `zod` 4 and
  `@modelcontextprotocol/sdk` 1.32.2 in the MCP server, patched `hono` and
  `@hono/node-server`, and newer `vitest` and `smol-toml` for development.

## [0.2.0] - Unreleased

First tagged release. Everything before it shipped as `0.1.0` from `main`, so
plugin installs may not have picked up these changes until now.

### Changed

- **Values are stored in the OS keychain.** macOS Keychain, Windows Credential
  Manager and Linux Secret Service hold secret values. `secrets.json` (mode
  `0600`) keeps names, tags, notes and keyed fingerprints only. Machines with
  no keychain fall back to plain values in `secrets.json`, and `status`,
  `setup` and `vault_status` say so. (#17)
- **No unlock step.** The encrypted `vault.db` with a passphrase was replaced
  by a named store that needs no unlock. The `lock` / `unlock` MCP tools are
  gone; the CLI commands only print a notice. An existing `vault.db` is never wiped or migrated automatically. (#13)
- Versions are now kept in sync across every package, plugin manifest and
  marketplace entry, so plugin hosts see each release as an update.

### Security

- CLI `get` only prints to an interactive terminal and asks first;
  `run --no-redact` needs a terminal too. (#20)
- `resolve_secret` is off unless the MCP server env sets
  `PASSWORD_SPACE_ENABLE_RESOLVE=1`. (#20)
- Inject files live 60 seconds (was 5 minutes), are deleted on expiry and on
  server exit, and the inject folder is `0700`. (#20)
- New tool hook (Claude Code `PreToolUse`, Cursor `beforeShellExecution` /
  `beforeReadFile`) blocks `get`, direct keychain lookups and reads of
  `secrets.json` or inject files. (#20)

### Added

- `store_secret` / `remove_secret` MCP tools: hand an agent a key once and it
  saves it to the keychain by name, never echoing the value. Every change is
  audit-logged. (#18)
- `password-space run -s NAME -- <command>`: runs a command with secrets in
  its environment and redacts them from its output when it is not a terminal.
  (#17)
- `password-space migrate [--to file]`: moves values into the keychain after
  a read-back check, or back to the file. (#17)
- Claude Code plugin packaging: marketplace, plugin manifest, MCP server and a
  `UserPromptSubmit` hook. (#15)
- Prompt hooks for Cursor and Claude Code block a prompt that contains any
  stored value of 6 or more characters. (#17)
- OpenAI Codex support: `password-space codex-setup [--write]` registers the
  bundled MCP server, a setup hint and the prompt guard hook in
  `~/.codex/config.toml` and copies the skill to `~/.agents/skills`. See
  [docs/codex.md](./docs/codex.md). (#21)
- CI that builds, tests and checks the committed plugin bundles are fresh.
  (#14)
- The CLI can be published to npm as `password-space`, with a release
  workflow, this changelog and contributor, security and issue templates.

### Fixed

- `run` quotes its command line correctly on Windows. (#18)
- macOS keychain writes of long values (one `security -i` line). (#17)
- Docs aligned with the plain store. (#16)

## [0.1.0]

Initial development line: encrypted local vault, Terminal CLI, MCP server with
`list_secrets` / `inject_secret` / `resolve_secret`, Vault Manager MCP App and
Cursor plugin packaging. Never tagged.

[Unreleased]: https://github.com/vishnutvm/password-space/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/vishnutvm/password-space/releases/tag/v0.2.0
