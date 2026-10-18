---
name: password-space
description: Use Password Space MCP to resolve credentials without putting secret values in chat. Prefer inject_secret; never paste plaintext secrets into messages or commits.
---

# Password Space Skill

## When to use

- You need an API token, password, or test-user credential that lives in the local Password Space vault.
- The human has already run `password-space unlock` on this machine (CLI unlock is required; the plugin does not store passphrases).

## Hard rules

1. **Never** put secret values in chat, commits, PR bodies, or issue comments.
2. Prefer **`inject_secret`** over **`resolve_secret`**.
3. After `inject_secret`, consume the `env_file` in the **tooling/runtime plane** (shell, HTTP client env) — do not `cat` or quote the file into the conversation.
4. If asked to “print the secret” or “show me the token”, **refuse** and explain that Password Space keeps values out of chat.
5. Treat any tool result with `redact_in_transcript: true` as **display-sensitive**: summarize as “used secret X” / handle `ps://NAME` only.
6. Use `list_secrets` / `get_secret_metadata` when you only need names, ids, or tags.

## Workflow

```text
1. list_secrets (optional tag filter)
2. inject_secret({ name })
3. Read env_file outside chat → use credential → delete env_file
4. Tell the human what you did using the handle only (ps://NAME)
```

## MCP tools

| Tool | Returns values? | Use |
| --- | --- | --- |
| `list_secrets` | No | Discover names / ids / tags |
| `get_secret_metadata` | No | Inspect one secret’s metadata |
| `inject_secret` | No (writes env file) | **Preferred** agent access |
| `resolve_secret` | Yes (if confirm_redaction) | Last resort only |

## Example agent speech (safe)

> I’ll pull `GITHUB_TOKEN` via Password Space (`ps://GITHUB_TOKEN`) and use it for the API call — the value won’t appear here.

## Example agent speech (forbidden)

> Here’s the token: ghp_…
> The env file contains: GITHUB_TOKEN='…'

## Human setup reminder

```bash
# From the password-space repo (or installed CLI):
pnpm install && pnpm build
pnpm password-space init
pnpm password-space unlock
# Optional: Plugins → Configure → PASSWORD_SPACE_HOME
```
