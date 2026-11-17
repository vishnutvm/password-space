# Security Policy

## Threat model (summary)

Password Space is a **local-only** named secret store. Secret values live in the
operating system's keychain; there is no cloud sync server.

| Principal | May see plaintext? |
| --- | --- |
| Human owner (CLI `get`) | Yes |
| A command started with `password-space run -s NAME -- …` | Yes, in its environment, for the secrets named |
| Agent process via MCP `inject_secret` / confirmed `resolve_secret` | Ephemerally, for requested secrets |
| Chat / transcript store | **Goal: no** — `run`, prompt hooks and the Skill reduce exposure; not an absolute guarantee |
| Copy of `secrets.json` (backup, sync folder, `cat` by an agent) | **No** with the keychain backend: names, tags, notes and keyed fingerprints only. **Yes** with the file fallback |
| Any process running as the same OS user | Can ask the keychain (or the CLI) for values. macOS may show an access prompt; Linux Secret Service and Windows Credential Manager usually do not |

### Storage

| Topic | Detail |
| --- | --- |
| Values | macOS Keychain (`/usr/bin/security`), Windows Credential Manager (`advapi32` via PowerShell), Linux Secret Service (`secret-tool`). Passed on stdin, never on argv |
| `secrets.json` | Mode `0600`. Names, ids, tags, notes, the backend in use, and for each value its length plus a truncated HMAC-SHA256 under a random key kept in the keychain |
| File fallback | Machines without a usable keychain store values in `secrets.json` in plain text. `status`, `setup` and MCP `vault_status` say so; `PASSWORD_SPACE_STORAGE=keychain` refuses to fall back |
| Migration | `password-space migrate` moves values into the keychain after a read-back check; `--to file` moves them back |
| Inject files | Short-lived env files under `inject/` with mode `0600` (default TTL 5 minutes) |
| Audit log | `audit.jsonl`: action, secret name, actor and time. Never values |

The fingerprints let the prompt hooks recognise a stored value without reading
it. Without the keychain-held key they cannot be checked against guesses
offline.

### Plaintext boundaries

Values can exist in:

- the OS keychain (and `secrets.json` with the file fallback)
- the environment and memory of a command started with `run`, and its output if it prints them (redacted when output is not a terminal)
- CLI `get` and MCP `resolve_secret` results
- inject `*.env` files until deleted

Prefer `run`: it writes nothing to disk and redacts its output.

### MCP access

| Tool | Can obtain plaintext? |
| --- | --- |
| `list_secrets` / `get_secret_metadata` / `vault_status` | No |
| `inject_secret` | Writes plaintext to a local env file; tool JSON omits the value |
| `resolve_secret` | Yes, only with `confirm_redaction: true` |

There is **no per-secret ACL**: any caller that can talk to the MCP server, or
run the CLI as you, can request any secret by name.

### Prompt hooks

The Cursor (`beforeSubmitPrompt`) and Claude Code (`UserPromptSubmit`) hooks
block a prompt that contains any stored value of 6 or more characters, plus
values in live inject files. They do not see tool output, screenshots, or
values that were never stored. If the keychain cannot be reached the hook lets
the prompt through and prints a warning, so a locked keychain never blocks chat.

### Trust boundaries

```text
┌─────────────┐  set/remove   ┌──────────────────────────┐
│ Human + CLI │ ────────────► │ OS keychain (values)     │
└─────────────┘               │ secrets.json (names)     │
                              └────────────┬─────────────┘
┌─────────────┐  run -s NAME -- cmd        │
│ Agent       │ ───────────────────────────┤──► cmd env (output redacted)
│  + MCP      │  inject_secret             │
└─────────────┘ ◄──────────────────────────┘──► inject/*.env (short-lived)
```

### Legacy encrypted vault

Older releases stored ciphertext in `vault.db`. That file is **never wiped or
auto-migrated**. Users re-add secrets via Terminal `set`.

## Supported versions

Password Space is pre-1.0. Security fixes land on `main` and ship in the next
release; only the latest release is supported.

| Version | Supported |
| --- | --- |
| Latest release (see [CHANGELOG.md](./CHANGELOG.md)) | Yes |
| Older releases, untagged `0.1.0` builds | No. Update the plugin or `npm install -g password-space@latest` |

## Reporting a vulnerability

Report vulnerabilities **privately** through GitHub:
[Security → Report a vulnerability](https://github.com/vishnutvm/password-space/security/advisories/new).
Do not open a public issue, pull request or discussion for an unfixed
vulnerability, and never include a real secret value in any report.

Please include the version, OS and storage backend (`password-space status`),
and the steps that expose a value or bypass a guard.

What to expect:

- An acknowledgement within 7 days.
- An assessment and, if the report is valid, a fix plan within 30 days.
- Credit in the release notes and advisory, unless you prefer not to be named.

In scope: anything that lets a value reach a chat transcript, log, tool result
or file it should not, a way around the prompt hooks or `run` redaction that
the docs say is covered, or a weakness in how values are written to or read
from the keychain. Known limits listed in the threat model above (for example
a process running as your user asking the keychain directly) are not
vulnerabilities on their own, but reports that narrow them are welcome.
