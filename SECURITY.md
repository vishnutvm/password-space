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

The Cursor (`beforeSubmitPrompt`), Claude Code and Codex (`UserPromptSubmit`) hooks
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

### Reporting

Please report security issues privately to the repository owner. Do not open public issues that include real secrets or exploit details that would harm other users.
