---
name: password-space
description: Saves, uses and removes the user's API keys, tokens and passwords by name in their local Password Space vault (OS keychain). Use when the user says "set up password space", "save this token", "store my GitHub token as GITHUB_TOKEN", "remember this API key", "remove this token", "forget my key", "what secrets do I have", "use my GitHub token", or when a task needs a key, token or password (check list_secrets before asking for one).
---

# Password Space

Named secrets on the user's machine: values in the **OS keychain**, names in `~/.password-space/secrets.json`. **You do the setup and the saving.** The user never has to paste a command into Terminal.

## Setup (the agent does it)

When the user asks to set up Password Space, runs `/password-space:setup-password-space`, or a tool says there is no store yet:

1. Call **`setup_vault`**. It creates the store (OS keychain when there is one) and is safe to call again.
2. Tell the user, in plain words: it is ready, and from now on they can just say *"save this token as GITHUB_TOKEN"*, *"use GITHUB_TOKEN to …"*, *"remove GITHUB_TOKEN"*.
3. **Never** give the user a Terminal command to paste for setup. If `setup_vault` is not available, follow the steps in the `setup-password-space` command (check `node -v`, then run the bundled CLI yourself with `setup --yes`).
4. No passphrase, no unlock, no `git clone`, no editing `mcp.json`.

`store_secret` also creates the store on first use, so "save this token" works even if setup was skipped.

### Product path

- Values live in the **OS keychain** (macOS Keychain, Windows Credential Manager, Linux Secret Service). Without one they fall back to `secrets.json` (mode 0600). `setup_vault` moves old plain-text values into the keychain when it can.
- **Lock / unlock / passphrase are not needed.**
- A user who does not want a value in the chat history can type it in Terminal instead (`terminal_fallback` from `vault_status`). Offer that only if they ask.

## When a task needs a key, token or password (agents)

1. **Check the vault first.** Call `list_secrets`. If a fitting name is there (e.g. `GITHUB_TOKEN`), use it by name (below). **Do not ask the user for it again.**
   The vault is the source of truth: do **not** read a same-named variable from the shell environment (`$GITHUB_TOKEN`) instead; it may be a different value.
2. **Not there?** Ask the user for it once, and say you will save it in their Password Space vault so they never have to give it again.
3. **The user hands you a secret** (in chat or otherwise): immediately call `store_secret` with a clear name (`GITHUB_TOKEN`, `OPENAI_API_KEY`, `NPM_TOKEN`) and a short `notes` saying what it is for. Then tell the user *"Saved as GITHUB_TOKEN"* — never repeat the value, never put it in the name, notes or tags.
4. **Name already exists** (`code: "already_exists"`): nothing was changed. Use the stored one. Only if the user says it is a new / rotated key, call `store_secret` again with `overwrite: true`.
5. **Remove** only when the user asks to delete or forget a secret: `remove_secret` with its name. If you are not sure which name they mean, call `list_secrets` and ask.
6. A value that is too long for the keychain is refused with a size message (about 1.9 KB on macOS); pass that message on to the user.

Every add / update / remove is audit-logged by name (never the value).

## Using a secret (agents)

Run the command through the CLI so the value goes straight into the process environment:

```bash
node "<plugin>/dist/cli.js" run -s GITHUB_TOKEN -- gh repo list
node "<plugin>/dist/cli.js" run -s OPENAI_API_KEY=openai-prod -- npm test
```

`vault_status` returns the exact `run_command` with the right path. Output is redacted for you. Never `cat ~/.password-space/*`, never `get`, never echo the variable. Use `inject_secret` only when a command cannot be wrapped with `run`, and then only source the file in the same command (`set -a; . FILE; set +a; <command>`). It is deleted after 60 seconds. If the user pastes a stored value, the prompt hook tells you its name: use the name, never repeat the value, and still do what they asked (saving it included). The tool hook blocks `get`, direct keychain lookups (`security`, `secret-tool`) and reads of `secrets.json` or inject files. Do not try to work around a block: use the secret by name. `resolve_secret` is off unless the user turned it on; never ask them to.

### Never do this

- Echo, print or paste secret values into chat (including ones the user just gave you)
- Ask the user to edit **`mcp.json`** or explain MCP
- Lead with Vault Manager / App forms for add or remove
- Give the user a Terminal command to paste for setup (call `setup_vault` instead)
- Tell newcomers to clone the repo or run `pnpm install` for day-1 setup
- Ask for a passphrase or an unlock step (there is none)
- Mention **Plugins → Configure** for vault home (default is `~/.password-space`)

### Vault Manager

Do **not** call **`vault_manager`** for setup or secrets. It is status-only.

## After store exists

- **`store_secret`** / **`remove_secret`** — the normal way: the user hands you a key or asks you to forget one
- **Terminal** `set` / `remove` / interactive menu — optional, for a user who prefers to type values there
- **`list_secrets`** / **`vault_status`** — MCP by name; **`run -s NAME -- <command>`** to use one

## Legacy encrypted vault

If `vault_onboard` or `setup_vault` reports `legacy_encrypted_vault`, the old `vault.db` is **left untouched**. Tell the user its secrets need to be saved again (they can hand them to you). Do not invent a destructive migrate-by-default.

## Never

- Repeat secret values in chat
- Ask the user to edit **`mcp.json`**
- Dump Vault Manager App HTML/JS / MCP resource bodies into chat
- Guide users to App forms for add / remove

Vault home defaults to **`~/.password-space`**. Optional override: a real absolute `PASSWORD_SPACE_HOME` in the process / MCP Environment (never an unresolved `${PASSWORD_SPACE_HOME}`).

Safe line after setup: *"Password Space is ready. Your secrets stay in your keychain. Just tell me \"save this token as GITHUB_TOKEN\" and I'll keep it; later sessions find it by name."*
