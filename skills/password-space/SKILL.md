---
name: password-space
description: Password Space — local encrypted vault for Cursor. Guide setup with vault_onboard; use inject_secret for credentials; never paste secrets in chat.
---

# Password Space

Password Space is a **private vault on the user's device**. Setup takes a few tool approvals — passphrases and tokens stay **out of chat**.

## Welcome flow (preferred)

1. Call **`vault_onboard`** and explain `human_summary` + `progress.step_of` + `trust_line`.
2. Guide **2/4** `vault_init` → **3/4** `vault_unlock` → **4/4** `vault_set_secret` (approval forms only).
3. For using secrets: **`inject_secret`** (not `resolve_secret`).

Or use **`/setup-password-space`**.

> **Say to humans:** "When Cursor asks to approve the tool, type your passphrase in the form — empty approvals won't work."

## Security rules (non-negotiable)

- Never put passphrases or secret values in chat, commits, or PRs.
- Never approve `vault_init` / `vault_unlock` without a passphrase in the form (unless `PASSWORD_SPACE_PASSPHRASE` is set in MCP Environment).
- Summarize tool errors with **`howToFix`** / **`what_to_do`** — friendly tone, no JSON walls.

## Tools

| Tool | Use |
| --- | --- |
| `vault_onboard` | **Start here** — phased checklist, no secrets |
| `vault_status` | Status + `progress` + next step |
| `vault_init` / `vault_unlock` | Setup (passphrase in approval form) |
| `vault_set_secret` | Save credential (metadata only in response) |
| `inject_secret` | **Preferred** agent access |

Optional: `PASSWORD_SPACE_PASSPHRASE` in **Settings → MCP → password-space → Environment**.

## Safe phrasing

> I'll open your Password Space checklist. Next you'll see an approval window — enter your vault passphrase there. It won't appear in our chat.

## Forbidden

> Here's your token: …  
> Your passphrase is …

CLI (`password-space onboard`) is for power users; marketplace users use **`vault_onboard`**.
