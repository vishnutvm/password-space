## What and why

<!-- What this changes and the problem it solves. Link an issue if there is one. -->

## How it was tested

<!-- Commands you ran, platforms and storage backend (keychain or file). -->

## Checklist

- [ ] `pnpm build && pnpm test` pass, and the rebuilt `plugins/password-space/dist` is committed
- [ ] No real secrets, `~/.password-space` data or `.demo-data/` in the diff
- [ ] Tool results, logs and errors still never include secret values
- [ ] User-facing change noted under `## [Unreleased]` in `CHANGELOG.md`
- [ ] README / SECURITY.md updated if behavior or the threat model changed
