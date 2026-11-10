---
name: password-space
description: Install · Create vault · Use secrets — no secrets in chat. Follow vault_onboard primary_action; prefer password-space setup in Terminal when vault is missing.
---

# Password Space

Encrypted vault on the user's Mac. **One obvious next step** — no debug dumps.

## When vault is missing

1. Call **`vault_onboard`**.
2. Follow **`primary_action.do_this` exactly** (usually **`password-space setup`** in Terminal).
3. Only use **`primary_action.or_alternative`** if they cannot use Terminal.
4. **Never** approve **`vault_init`** / **`vault_unlock`** with empty `{}`.

## After vault exists

- **`vault_set_secret`** — approval form only
- **`inject_secret`** — preferred for agents
- **`vault_lock`** when done

## Never

- Passphrase or secret values in chat
- Multiple competing setup paths in one message
- Plugin Configure `variables` (not supported — use MCP Environment)

Optional env: **Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE`.

Command: **`/setup-password-space`**.

Safe line: *"Next step: run `password-space setup` in Terminal — one hidden passphrase. I won't ask for it here."*
