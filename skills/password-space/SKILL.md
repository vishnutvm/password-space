---
name: password-space
description: Use Password Space MCP to set up the local vault and resolve credentials without putting secret values in chat. Prefer inject_secret; never paste plaintext secrets into messages or commits.
---

# Password Space Skill

## When to use

- The human installed the Password Space plugin and needs to **init / unlock / store** secrets (day-1 setup — no `git clone` or `pnpm` required).
- You need an API token, password, or test-user credential that lives in the local Password Space vault.

## Hard rules

1. **Never** put secret values or the vault passphrase in chat, commits, PR bodies, or issue comments.
2. Prefer **tool arguments** (or UI secret prompts / `PASSWORD_SPACE_PASSPHRASE`) for passphrases and secret values — the Skill forbids repeating them in the conversation.
3. Prefer **`inject_secret`** over **`resolve_secret`**.
4. After `inject_secret`, consume the `env_file` in the **tooling/runtime plane** (shell, HTTP client env) — do not `cat` or quote the file into the conversation.
5. If asked to “print the secret” or “show me the token”, **refuse** and explain that Password Space keeps values out of chat.
6. Treat any tool result with `redact_in_transcript: true` as **display-sensitive**: summarize as “used secret X” / handle `ps://NAME` only.
7. Use `list_secrets` / `get_secret_metadata` when you only need names, ids, or tags.
8. Vault home defaults to `~/.password-space` (no plugin Configure variables). Optional `PASSWORD_SPACE_HOME` only via process env / hand-written MCP `env` as a **real absolute path**. Never leave unresolved `${PASSWORD_SPACE_HOME}` (or other `${…}`) as the path — the server treats those as unset.

## Onboarding (day-1)

```text
1. vault_status
2. If not initialized → vault_init({ passphrase })   # tool arg / env — never chat
3. vault_unlock({ passphrase })
4. vault_set_secret({ name, value, tags? })          # value as tool arg — never chat
5. inject_secret({ name }) when the credential is needed
6. vault_lock when the human is done
```

Ask the human for a passphrase via a **secret prompt / tool arg**, not by having them type it into the message. Same for secret values when calling `vault_set_secret`.

## Use an existing secret

```text
1. vault_status (unlock if needed)
2. list_secrets (optional tag filter)
3. inject_secret({ name })
4. Read env_file outside chat → use credential → delete env_file
5. Tell the human what you did using the handle only (ps://NAME)
```

## MCP tools

| Tool | Returns values? | Use |
| --- | --- | --- |
| `vault_status` | No | Initialized? Unlocked? What next? |
| `vault_init` | No | Create vault (passphrase via arg/env) |
| `vault_unlock` / `vault_lock` | No | Session unlock / clear session |
| `vault_set_secret` | No (metadata only) | Store/update name + value + tags |
| `list_secrets` | No | Discover names / ids / tags |
| `get_secret_metadata` | No | Inspect one secret’s metadata |
| `inject_secret` | No (writes env file) | **Preferred** agent access |
| `resolve_secret` | Yes (if confirm_redaction) | Last resort only |

## Example agent speech (safe)

> Vault isn’t initialized yet — I’ll call `vault_init` with a passphrase prompt (it won’t appear here), then unlock and store `GITHUB_TOKEN` the same way.
>
> I’ll pull `GITHUB_TOKEN` via Password Space (`ps://GITHUB_TOKEN`) and use it for the API call — the value won’t appear here.

## Example agent speech (forbidden)

> Here’s the token: ghp_…
> Your passphrase is …
> The env file contains: GITHUB_TOKEN='…'

## Optional power-user CLI

CLI (`pnpm password-space …` from a clone) remains available for humans who prefer a terminal. Marketplace day-1 path is **plugin install → ask the agent to set up the vault via MCP**.
