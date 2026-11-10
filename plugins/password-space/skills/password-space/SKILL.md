---
name: password-space
description: Install · One-time Setup · Start Using. Follow vault_onboard primary_action only — MCP approval form path for newcomers; never ask users to edit mcp.json.
---

# Password Space

Encrypted vault on the user's Mac. **One obvious next step** — no competing paths, no MCP/CLI jargon.

## Newcomer path (only path to present)

1. User runs **`/setup-password-space`** (or asks to set up Password Space).
2. Call **`vault_onboard`**.
3. Follow **`primary_action.do_this` exactly** — that is the **only** next step.
4. Passphrase goes in the **MCP approval form** (or MCP Environment) — **never** in chat, **never** via elicitation.

## After vault exists

- **`vault_set_secret`** — approval form only
- **`inject_secret`** — preferred for agents
- **`vault_lock`** when done

## Never

- Passphrase or secret values in chat
- Ask the user to edit **`mcp.json`** or explain MCP
- Offer CLI and slash setup as equal choices
- Approve **`vault_init`** / **`vault_unlock`** with empty `{}`
- Call **`vault_init`** again when `setup_state` is `needs_unlock` / vault already exists

## Advanced escape hatch (only if user asks for Terminal)

`primary_action.advanced_escape_hatch` may mention `password-space setup` / `unlock`. Do **not** lead with it for newcomers.

Optional env: **Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE`.

Safe line: *"Next step: I'll call vault_init — type your passphrase in the approval form when Cursor asks. I won't ask for it in chat."*
