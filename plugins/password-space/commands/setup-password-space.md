---
description: Guided Password Space setup — local, encrypted, credentials never pasted in chat
---

Help the user complete **Password Space** setup with a calm, product-quality tone. **Never** ask for a passphrase or token in chat.

## Open

1. Call **`vault_onboard`**.
2. Share **`human_summary`**, **`progress.step_of`**, and **`trust_line`** in one short paragraph.

## Walk the four steps

| Phase | Tool | Tell the user |
| --- | --- | --- |
| 1/4 Welcome | — | "We'll set up a private vault on your Mac in a few approvals." |
| 2/4 Secure | `vault_init` | "Cursor will ask to run a tool — enter your passphrase there (8+ characters)." |
| 3/4 Unlock | `vault_unlock` | "Same passphrase in the next approval form." |
| 4/4 Save | `vault_set_secret` | "Add a label and your token in the form only — not here in chat." |

After each tool, confirm with **`vault_status`** (counts only — no secret values).

## If something failed

- Empty approval → explain gently: fill the passphrase field, run **`vault_onboard`** again.
- Use error **`howToFix`** when present; do not dump raw JSON.

## Close

Confirm initialized + unlocked. Mention **`inject_secret`** for day-to-day use and **`vault_lock`** when finished.
