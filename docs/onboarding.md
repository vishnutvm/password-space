# Getting started in 2 minutes

Password Space keeps your API keys and passwords **on your Mac**, **encrypted**, and **out of chat**.

> **Trust:** Secrets stay on your device. Your agent uses them without pasting values into the conversation.

## Install

1. **Cursor → Settings → Plugins** (or team marketplace).
2. Import `https://github.com/vishnutvm/password-space` and install **password-space**.

## Set up (four steps)

| Step | You do | Agent calls |
| --- | --- | --- |
| **1. Welcome** | Ask to get started | `vault_onboard` |
| **2. Secure** | Enter passphrase in **approval form** (8+ chars) | `vault_init` |
| **3. Unlock** | Same passphrase in approval form | `vault_unlock` |
| **4. Save** | Name + token in approval form only | `vault_set_secret` |

**Fast path in chat:** `/setup-password-space`

### The one rule people miss

When Cursor shows **Run tool**, fill in the **passphrase** field. Approving with empty fields will not work.

### Optional convenience

**Settings → MCP → password-space → Environment** → `PASSWORD_SPACE_PASSPHRASE`  
Never put that value in chat.

## Daily use

- **Status:** `vault_status`
- **Use a saved credential:** `inject_secret` (preferred — no value in chat)
- **Done for the day:** `vault_lock`

## Need help?

Say: *“Walk me through Password Space setup.”* The agent should call `vault_onboard` and explain the current step in plain language.

More detail: [plugin README](../plugins/password-space/README.md) · [Security](../SECURITY.md)
