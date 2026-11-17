# Releasing Password Space

One version number covers everything: the Cursor and Claude Code plugins, the
bundled MCP server and the `password-space` CLI on npm. The root
`package.json` holds it, and `pnpm version:check` fails if anything else
disagrees.

Why it matters: Claude Code and Cursor only treat a plugin as updated when the
`version` in its manifest changes. If a release leaves the version alone,
installed plugins keep running the old code.

## Cut a release

1. Start from an up-to-date `main` with green CI.
2. Pick the version. Below 1.0.0: bump the minor (`0.3.0`) for new behavior or
   anything that changes storage, the patch (`0.2.1`) for fixes only.
3. Set it everywhere:
   ```bash
   pnpm version:set 0.3.0
   ```
4. In `CHANGELOG.md`, rename `## [Unreleased]` items into a new
   `## [0.3.0] - YYYY-MM-DD` section (today's date), leave an empty
   `## [Unreleased]` above it, and update the compare links at the bottom.
5. Rebuild so the committed plugin bundles carry the new version, then test:
   ```bash
   pnpm build && pnpm test
   ```
6. Open a PR titled `release: v0.3.0` with those changes and merge it.
7. Tag the merge commit and push the tag:
   ```bash
   git checkout main && git pull
   git tag -a v0.3.0 -m "v0.3.0"
   git push origin v0.3.0
   ```

Pushing the tag runs [`.github/workflows/release.yml`](../.github/workflows/release.yml), which:

- checks the tag matches every version and that `CHANGELOG.md` has a dated
  section for it,
- builds, tests and checks the plugin bundles are fresh,
- packs the CLI, installs the tarball on its own and runs it,
- creates the GitHub release with that changelog section as notes and the npm
  tarball attached,
- publishes to npm, **only** if you have turned npm publishing on (below).

A version with a suffix such as `0.3.0-rc.1` is marked as a pre-release and,
on npm, goes to the `next` tag instead of `latest`.

To check everything without releasing, run the workflow by hand from
**Actions → Release → Run workflow**. It stops after packing.

## Plugin users

Plugins install from this repository, so a release reaches them once the
version bump is on `main`:

- Claude Code: `/plugin marketplace update password-space-marketplace`, then
  update the plugin from `/plugin`.
- Cursor: update the plugin from Settings → Plugins.

## Turn on npm publishing (one time)

The CLI publishes as the unscoped package
[`password-space`](https://www.npmjs.com/package/password-space). The name was
free when this was set up; publishing once claims it.

1. Sign in to npmjs.com and create a granular access token with
   **Read and write** on packages (an automation token also works).
2. In the repository, **Settings → Secrets and variables → Actions**:
   - add the secret `NPM_TOKEN` with that token,
   - on the **Variables** tab, add `NPM_PUBLISH` = `true`.
3. The next tag push publishes, with npm provenance linking the package to the
   workflow run.

To publish by hand instead:

```bash
pnpm build && pnpm test
cd packages/cli
npm publish --access public   # prepack rebuilds dist/password-space.js
```

Check what will ship first with `npm pack --dry-run` in `packages/cli`. Only
`dist/password-space.js`, `README.md`, `LICENSE` and `package.json` should be
listed. `@password-space/vault` and `@password-space/mcp-server` are private
workspace packages and are never published; the CLI bundles what it needs.

## Security fixes

Fix on a private fork or in a draft security advisory, release as a patch, then
publish the advisory. See [SECURITY.md](../SECURITY.md).
