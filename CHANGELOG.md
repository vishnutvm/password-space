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
  by a named store that needs no unlock. `lock` / `unlock` remain as no-op MCP
  tools. An existing `vault.db` is never wiped or migrated automatically. (#13)
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
- Docs aligned with the plain store; a single redaction implementation. (#16)

## [0.1.0]

Initial development line: encrypted local vault, Terminal CLI, MCP server with
`list_secrets` / `inject_secret` / `resolve_secret`, Vault Manager MCP App and
Cursor plugin packaging. Never tagged.

[Unreleased]: https://github.com/vishnutvm/password-space/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/vishnutvm/password-space/releases/tag/v0.2.0
