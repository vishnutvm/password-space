# password-space

A local named secret store for developers and AI agents, backed by your OS keychain.

Store a secret once by name in Terminal. Commands and agents then use it by name, so the value never has to be pasted into a chat:

```bash
npm install -g password-space

password-space setup                       # create the store
password-space set GITHUB_TOKEN            # prompts for the value (hidden)
password-space list                        # names and tags only, never values
password-space run -s GITHUB_TOKEN -- gh repo list   # value goes into the command's env only
```

Values live in the **macOS Keychain, Windows Credential Manager or Linux Secret Service**. `~/.password-space/secrets.json` keeps only names, tags and notes. On a machine with no keychain, values fall back to `secrets.json` in plain text (mode `0600`) and `password-space status` says so.

Run `password-space help` for every command and option. Requires Node.js 20 or newer.

## Using it with AI coding tools

This package is the Terminal CLI. The Cursor and Claude Code plugins add an MCP server, a Skill and a prompt hook that blocks prompts containing a stored value. See the [project README](https://github.com/vishnutvm/password-space#readme) to install them.

## Security

Password Space keeps values out of chat transcripts when the agent cooperates. It is not a barrier against malware or an agent that runs as your user and asks the keychain directly. Read the [security policy](https://github.com/vishnutvm/password-space/blob/main/SECURITY.md) before relying on it, and report vulnerabilities there, not in public issues.

## License

MIT
