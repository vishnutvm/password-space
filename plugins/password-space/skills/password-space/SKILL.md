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
2. Prefer **MCP approval form fields** (or `PASSWORD_SPACE_PASSPHRASE` in **Cursor → Settings → MCP → password-space → Environment**) for passphrases and secret values.
3. **Do not approve `vault_init` or `vault_unlock` with empty `{}`** — the human must fill the **passphrase** field in the approval UI.
4. Prefer **`vault_onboard`** when the human says setup is broken or confusing.
5. Prefer **`inject_secret`** over **`resolve_secret`**.
6. After `inject_secret`, consume the `env_file` in the **tooling/runtime plane** — do not `cat` or quote the file into the conversation.

## Onboarding (non-technical)

Use **`vault_onboard`** first, then follow the checklist:

```text
1. vault_onboard or vault_status  → explain next step in plain English
2. vault_init  → passphrase ONLY in MCP approval form (8+ chars)
3. vault_unlock → same passphrase in approval form
4. vault_set_secret → name + value in approval form (never chat)
5. inject_secret when a credential is needed
6. vault_lock when the human is done
```

Or run the plugin command **setup-password-space** (`/setup-password-space`).

Tell the human: *“When Cursor asks to approve the tool, fill in the passphrase box — approving without typing anything will fail.”*

## MCP tools

| Tool | Returns values? | Use |
| --- | --- | --- |
| `vault_onboard` | No | **Start here** — checklist, no secrets |
| `vault_status` | No | Initialized? Unlocked? `next_steps` |
| `vault_init` | No | Create vault (passphrase in approval form) |
| `vault_unlock` / `vault_lock` | No | Session unlock / clear session |
| `vault_set_secret` | No (metadata only) | Store/update name + value + tags |
| `list_secrets` | No | Discover names / ids / tags |
| `inject_secret` | No (writes env file) | **Preferred** agent access |

## PASSWORD_SPACE_PASSPHRASE

Optional: set in **Cursor → Settings → MCP → password-space → Environment** so unlock/init tools can run without re-entering the passphrase on every approval. Never paste the value into chat.

Vault home defaults to `~/.password-space`. Optional `PASSWORD_SPACE_HOME` only via MCP Environment or process env (real absolute path).

## Example agent speech (safe)

> I’ll open the Password Space setup checklist. Next, Cursor will show an approval window — please type your vault passphrase there (8+ characters). It won’t appear in our chat.

## Optional power-user CLI

CLI (`password-space onboard` or `password-space init`) from a repo clone. Marketplace day-1 path is **plugin → vault_onboard / setup-password-space**.
