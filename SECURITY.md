# Security Policy

## Threat model (summary)

Password Space is a **local-only** named secret store. Secret values live in the
operating system's keychain; there is no cloud sync server.

| Principal | May see plaintext? |
| --- | --- |
| Human owner (CLI `get`, interactive terminal only, asks first) | Yes |
| A command started with `password-space run -s NAME -- …` | Yes, in its environment, for the secrets named |
| Agent process via MCP `inject_secret` | Ephemerally, through a short-lived env file it sources |
| Agent process via MCP `resolve_secret` | Only if the user turned the tool on with `PASSWORD_SPACE_ENABLE_RESOLVE=1` (off by default) |
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
| Inject files | Env files under `inject/` (dir `0700`, files `0600`). Default TTL 60 seconds; the MCP server deletes each file at expiry and every file it wrote when it exits, and clears expired ones on start |
| Audit log | `audit.jsonl`: action, secret name, actor and time. Never values |

The fingerprints let the prompt hooks recognise a stored value without reading
it. Without the keychain-held key they cannot be checked against guesses
offline.

### Plaintext boundaries

Values can exist in:

- the OS keychain (and `secrets.json` with the file fallback)
- the environment and memory of a command started with `run`, and its output if it prints them (redacted when output is not a terminal)
- CLI `get` output (interactive terminal only) and MCP `resolve_secret` results (only when turned on)
- inject `*.env` files until they expire (60 s) or the MCP server exits

Prefer `run`: it writes nothing to disk and redacts its output.

### MCP access

| Tool | Can obtain plaintext? |
| --- | --- |
| `list_secrets` / `get_secret_metadata` / `vault_status` | No |
| `inject_secret` | Writes plaintext to a local env file; tool JSON omits the value |
| `resolve_secret` | Yes. **Not registered** unless `PASSWORD_SPACE_ENABLE_RESOLVE=1` is set in the server's env, and then only with `confirm_redaction: true` |

There is **no per-secret ACL**: any caller that can talk to the MCP server, or
run the CLI as you, can request any secret by name.

### Prompt hooks

The Cursor (`beforeSubmitPrompt`), Claude Code and Codex (`UserPromptSubmit`) hooks
detect a prompt that contains any stored value of 6 or more characters, plus
values in live inject files. They warn and let the prompt through, so the value
does reach the chat; Claude Code and Codex also tell the agent the secret's
name and not to repeat the value. Set `PASSWORD_SPACE_PROMPT_GUARD=block` to
block such prompts instead. They do not see tool output, screenshots, or
values that were never stored. If the keychain cannot be reached the hook lets
the prompt through and prints a warning, so a locked keychain never blocks chat.

### Tool hooks

The Claude Code (`PreToolUse` on `Bash`, `Read`, `Grep`) and Cursor
(`beforeShellExecution`, `beforeReadFile`) hooks in
`plugins/password-space/scripts/shell-guard.mjs` block the obvious ways an
agent could read a value around Password Space:

- `password-space get` / `cli.js get`
- `security find-generic-password` / `dump-keychain`, `secret-tool lookup|search`,
  Windows `CredRead` / `Get-StoredCredential` / `PasswordVault`
- reading `secrets.json` in the store directory
- reading or printing `inject/*.env` files (sourcing one with `. FILE` or
  `source FILE` in the same command is allowed, which is how `inject_secret` is
  meant to be used)

### What an agent with shell access can still do

Password Space keeps values out of chat for an agent that uses secrets by name.
It is **not a sandbox**. An agent that can run arbitrary commands as your user
and decides to work around it can still read a value, because the keychain
trusts every process of that user. Specifically:

| Path | What we do | What still works for a determined agent |
| --- | --- | --- |
| CLI `get` | Refuses unless stdin and stdout are an interactive terminal, then asks y/N. Tool hooks block the command | Running it inside a pseudo-terminal (`script`, `expect`, `python -c 'import pty…'`) and answering the prompt |
| `run --no-redact` | Refused unless stdout is a terminal; piped output is always redacted | Transforming the value before printing (`base64`, `rev`, splitting it) defeats string redaction |
| `resolve_secret` | Not registered unless the user sets `PASSWORD_SPACE_ENABLE_RESOLVE=1`; warning in the description; `confirm_redaction` required | An agent that can edit your MCP config can turn it on. Watch for config edits |
| Direct keychain lookup | Tool hooks block `security`, `secret-tool` and `CredRead` commands. The account names (`<storeId>:<id>`) are in `secrets.json`, which the hooks also block | Obfuscated commands (variables, a script file, another language's keychain API) are not recognised. On Linux and Windows the keychain does not prompt; macOS may |
| Inject files | 60 s TTL, deleted by a timer and on server exit, owner-only directory, hooks block `cat`/`grep`/`Read` of them | Sourcing a file and then printing the variable. Prefer `run`, which writes no file and redacts output |
| Any command run with a secret | Output redacted when not a terminal | The command itself can send the value anywhere |

If you need a hard barrier, run the agent as a different OS user, in a
container or VM without access to your keychain, or with a sandbox that
denies `security`, `secret-tool` and the store directory. Keep hooks on, and
review an agent's shell commands when it handles credentials.

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
