# Check the plugin in Cursor

A short test to confirm Password Space works in a real Cursor app. It takes
about 10 minutes. Do the steps in order. If a step fails, read the
**If it fails** line under it before you go on.

You need **Node.js 20 or newer**. If you are not sure, skip ahead: the
setup command checks it and tells you how to install it.

You do not need to paste anything into Terminal. The agent does the setup.

## 1. Install the plugin

1. Open **Cursor Settings → Plugins**.
2. Click **Add marketplace → Import from GitHub** and paste
   `https://github.com/vishnutvm/password-space`.
3. Install **password-space**.
4. Run **Developer: Reload Window** from the command palette.

**If it fails:** check the URL, then reload Cursor and try again. If an old
copy gets in the way, follow
[Reinstalling cleanly](cursor.md#reinstalling-cleanly).

## 2. Confirm the MCP server is on

Open **Settings → MCP**. **password-space** should be listed, switched on,
with a green dot and its tools (`vault_onboard`, `vault_status`,
`list_secrets`, and more).

**If it fails:**
- Red dot or error: run `node -v`. If it is older than 20, install Node 20+
  from <https://nodejs.org>, then reload the window.
- Not in the list: the plugin did not install. Go back to step 1.
- Tools are off: allow them for the agent in the same screen.

## 3. Let the agent set it up

1. In a new Cursor chat, type **`/setup-password-space`** (or *"set up
   Password Space"*).
2. The agent calls `setup_vault` and says Password Space is ready, with your
   values in the keychain. You do not type or paste anything.

**If it fails:**
- `/setup-password-space` is missing: the plugin is not loaded. Reload the
  window (step 1).
- The agent says Node.js is missing or too old: install the LTS version from
  <https://nodejs.org> (Mac: the `.pkg`, or `brew install node`), reload the
  window, and run the command again.
- The agent shows you a Terminal command to paste: that is the old behaviour.
  Update the plugin and reload.
- It says "a private file in ~/.password-space": there is no usable keychain
  on this machine. That is a fallback, not a failure.

## 4. Save a test secret by handing it to the agent

In chat type: **"Save this as PS_TEST_KEY: pstest-123456"** (a fake value, at
least 6 characters).

The agent calls `store_secret` and answers *Saved as PS_TEST_KEY* **without
repeating the value**.

**If it fails:** if the agent repeats the value, that is a bug in the skill.
Write down what it said and open an issue.

## 5. Ask a new chat to list secrets

Open a **new** Cursor chat (to prove a later session finds it) and ask:
**"List my Password Space secrets."**

The agent calls `list_secrets`. You should see `PS_TEST_KEY` and **no
values**.

**If it fails:**
- Empty list: ask the agent for `vault_status` and check the store folder
  (default `~/.password-space`). If you set `PASSWORD_SPACE_HOME`, it must be
  the same everywhere you use Password Space.
- The agent says it has no such tool: go back to step 2.

## 6. Use the secret with `run`

Ask the agent:

> Use PS_TEST_KEY with `run` to check that the value reaches a command.
> Print only its length, not the value.

The agent should run something like:

```bash
node ".../dist/cli.js" run -s PS_TEST_KEY -- node -e "console.log(process.env.PS_TEST_KEY.length)"
```

You should see `13` (the length of `pstest-123456`). The value itself must
not appear in the chat.

**If it fails:**
- "Secret not found": the name is wrong. Names are exact. Check with step 5.
- The agent asks you to paste the value: say no and point it to
  `run -s PS_TEST_KEY`.
- The value shows in the output: this is a bug. Write down what the agent
  ran and open an issue.

## 7. Check that the prompt hook blocks a pasted secret

In Cursor chat, type `my key is pstest-123456` and send it.

Cursor should **block** the message with: *Password Space blocked this
prompt: it contains the value of stored secret "PS_TEST_KEY"*.

**If it fails:**
- The message goes through: check that hooks are on for the plugin, reload
  the window, and try again. Hooks come only with the plugin install, not
  with a manual MCP setup.
- Values shorter than 6 characters are never checked. Use a longer test
  value.
- If the hook has an error, it lets the prompt through on purpose, so a
  broken keychain never locks you out of chat. Look in Cursor's **Output** panel (the Hooks channel, if your
  version has one) for a `password-space prompt guard` warning.

## 8. Clean up

In chat type **"Remove PS_TEST_KEY"**. The agent calls `remove_secret`. Ask
it to list secrets again: `PS_TEST_KEY` is gone.

## Result

If steps 1 to 7 pass, the plugin works in Cursor. Write down your Cursor
version, your OS and the date, and add them to the pull request or issue
where you report the result.
