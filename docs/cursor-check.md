# Check the plugin in Cursor

A short test to confirm Password Space works in a real Cursor app. It takes
about 10 minutes. Do the steps in order. If a step fails, read the
**If it fails** line under it before you go on.

You need **Node.js 20 or newer**. Check in Terminal with `node -v`.

In this guide, `CLI` means the command that runs the bundled `cli.js`, for
example:

```bash
node "/Users/you/.cursor/plugins/cache/vishnutvm-password-space/.../dist/cli.js"
```

The agent shows you the full command in step 3. Copy it from there.

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

## 3. Run setup in Terminal

1. In a new Cursor chat, type **`/setup-password-space`**.
2. The agent calls `vault_onboard` and shows one command that ends in
   `cli.js setup`. Copy it.
3. Paste it in your own Terminal (not the agent chat) and press Enter.
   Follow the questions. Choose the **keychain** when it asks.

**If it fails:**
- `/setup-password-space` is missing: the plugin is not loaded. Reload the
  window (step 1).
- The command contains `${CURSOR_PLUGIN_ROOT}` and Terminal says it cannot
  find the file: your Terminal does not know that name. Find the real path
  with
  `find ~/.cursor/plugins -name cli.js -path "*password-space*"`
  and use that path instead.
- Keychain error: run `CLI status` to see which storage is in use. The plain
  file is a fallback, not a failure.

## 4. Save a test secret

In Terminal run:

```bash
CLI set PS_TEST_KEY
```

At the hidden prompt type a fake value, for example `pstest-123456`
(at least 6 characters). Nothing shows while you type. That is normal.

**If it fails:** "Store not initialized" means step 3 did not finish. Run
`CLI setup` again.

## 5. Ask the agent to list secrets

In Cursor chat ask: **"List my Password Space secrets."**

The agent calls `list_secrets`. You should see `PS_TEST_KEY` and **no
values**.

**If it fails:**
- Empty list: the agent and Terminal use different folders. Run `CLI status`
  in Terminal and ask the agent for `vault_status`. Both should show the same
  store folder (default `~/.password-space`). If you set
  `PASSWORD_SPACE_HOME`, set the same value in both places.
- The agent says it has no such tool: go back to step 2.

## 6. Use the secret with `run`

Ask the agent:

> Use PS_TEST_KEY with `run` to check that the value reaches a command.
> Print only its length, not the value.

The agent should run something like:

```bash
CLI run -s PS_TEST_KEY -- node -e "console.log(process.env.PS_TEST_KEY.length)"
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

Remove the test secret in Terminal with `CLI remove PS_TEST_KEY`, or ask the agent to call `remove_secret` for
`PS_TEST_KEY`.

## Result

If steps 1 to 7 pass, the plugin works in Cursor. Write down your Cursor
version, your OS and the date, and add them to the pull request or issue
where you report the result.
