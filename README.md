# Password Space

**Local encrypted credential vault for humans and AI agents — secrets via MCP, never in chat.**

Store API tokens and test credentials once. You unlock the vault; agents resolve secrets through MCP (`inject_secret`) so values stay out of transcripts.

## Install via Cursor marketplace

Import this repo with **Import from GitHub** (personal marketplace, or team marketplace on a Cursor **Teams** plan):

1. Open **Cursor Settings → Customize** (or **Dashboard → Plugins & MCPs** for team marketplaces).
2. **+ Add Marketplace** → **Import from GitHub**.
3. Paste: `https://github.com/vishnutvm/password-space`
4. Install the **password-space** plugin.
5. Optional: **Plugins → Configure** → set `PASSWORD_SPACE_HOME` (leave empty for `~/.password-space`).

**Unlock CLI (required):** marketplace install registers MCP + Skill + hooks; it does **not** unlock the vault. Run `pnpm password-space unlock` each session (see quickstart below).

Official public listing (later): submit at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish) (manual review).

Layout: `.cursor-plugin/marketplace.json` → `plugins/password-space/`.

## Why it exists

| Anti-pattern | What goes wrong |
| --- | --- |
| Paste secrets into chat | Persist in transcripts, screenshots, logs |
| Commit `.env` files | Leak via git and shared workspaces |
| Plaintext MCP configs | Readable by anything with config access |

Password Space keeps **ciphertext on disk**, a **human unlock** gate, and an **agent side channel** (MCP + env inject + Skill + redaction hook).

Threat model summary: [SECURITY.md](./SECURITY.md). Architecture detail: [docs/architecture.md](./docs/architecture.md).

## Local CLI quickstart

```bash
git clone https://github.com/vishnutvm/password-space.git
cd password-space
pnpm install && pnpm build

pnpm password-space init          # create unlock passphrase
pnpm password-space unlock
pnpm password-space set GITHUB_TOKEN --tags api,github
pnpm password-space list          # names only
```

Requires **Node.js ≥ 20** (uses built-in `node:sqlite`). `pnpm build` also regenerates the marketplace MCP bundle at `plugins/password-space/dist/index.js`.

### Manual MCP (without marketplace)

```json
{
  "mcpServers": {
    "password-space": {
      "command": "node",
      "args": ["/absolute/path/to/password-space/plugins/password-space/dist/index.js"],
      "env": {
        "PASSWORD_SPACE_HOME": "/home/you/.password-space"
      }
    }
  }
}
```

Skill: `plugins/password-space/skills/password-space/` (also mirrored under `skills/` for convenience). Hooks: see `plugins/password-space/hooks/hooks.json`.

## Demo

```bash
export PASSWORD_SPACE_HOME=/tmp/ps-demo
rm -rf "$PASSWORD_SPACE_HOME"

PASSWORD_SPACE_PASSPHRASE='demo-pass-ok' pnpm password-space init
PASSWORD_SPACE_PASSPHRASE='demo-pass-ok' pnpm password-space unlock
printf 'ghp_demo_secret_value' | pnpm password-space set DEMO_TOKEN --tags demo
pnpm password-space list
pnpm password-space status
pnpm password-space lock
```

Or run `pnpm demo` for a throwaway vault under `/tmp/password-space-demo`.

Example output (names only — no values):

```text
DEMO_TOKEN [demo]  <uuid>
data dir:    /tmp/ps-demo
initialized: true
unlocked:    true
session:     true
secrets:     1
```

Agents should call MCP `inject_secret` (not CLI `get`) so chat only sees handles like `ps://DEMO_TOKEN`.

## Architecture

```mermaid
flowchart TB
  Human[Human + CLI] -->|init / unlock / set| Vault[(Encrypted SQLite vault.db)]
  Human -->|session 0600| Session[Unlock session]
  Session --> MCP[MCP server]
  Agent[Agent + Skill] -->|list / metadata / inject| MCP
  MCP -->|ciphertext decrypt| Vault
  MCP -->|env file handle| Inject[inject/*.env]
  Agent -->|consume outside chat| Inject
  Hook[redact.mjs hook] -->|strip known values| Chat[Chat transcript]
  Agent -.->|never paste values| Chat
```

**Key hierarchy:** passphrase → scrypt → unwrap vault key → AES-256-GCM per secret. See [docs/architecture.md](./docs/architecture.md).

## Repo layout

```text
.cursor-plugin/marketplace.json   # marketplace manifest
plugins/password-space/           # Cursor plugin (MCP bundle + skill + hooks + logo)
packages/vault|cli|mcp-server/    # TypeScript sources
skills/ hooks/ examples/          # convenience mirrors / docs
```

## Develop

```bash
pnpm install && pnpm build && pnpm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md). Security reports: [SECURITY.md](./SECURITY.md).

## License

MIT — see [LICENSE](./LICENSE).
