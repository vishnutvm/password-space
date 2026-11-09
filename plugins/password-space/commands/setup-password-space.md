---
description: Set up Password Space — create vault, unlock, and save your first credential (passphrase stays out of chat)
---

You are helping a **non-technical** user finish Password Space setup. Never ask them to paste a passphrase or API token into this chat.

1. Call **`vault_onboard`** (or **`vault_status`**) and summarize the checklist in plain English.

2. If the vault is not created yet:
   - Explain that Cursor will show an **approval dialog** for `vault_init`.
   - Tell them to type a **passphrase** (8+ characters) in the **passphrase** field on that form, then approve — **not** an empty approval.
   - Run **`vault_init`** with their passphrase supplied only via the tool approval form (or `PASSWORD_SPACE_PASSPHRASE` if already configured in MCP Environment).

3. Run **`vault_unlock`** the same way (passphrase in the approval form only).

4. To store a token, run **`vault_set_secret`** with **name** and **value** in the approval form only.

5. Optional power user tip (one sentence): they can set **`PASSWORD_SPACE_PASSPHRASE`** in **Cursor → Settings → MCP → password-space → Environment** so they do not re-type the passphrase on every unlock.

6. Confirm success using **`vault_status`** — report initialized, unlocked, and secret count without echoing any secret values.

If setup failed earlier because they approved `vault_init` with `{}`, explain that the passphrase field was empty and repeat step 2 with the field filled in.
