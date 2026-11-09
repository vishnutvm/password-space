# Marketplace plugin logo

Cursor was showing a generic white box for the Password Space plugin icon because the logo field used a path relative to the plugin package only (`assets/logo.svg` in `plugin.json`), which some Cursor marketplace views do not resolve.

## Changes (2026-11-09)

| File | `logo` value |
|------|----------------|
| `plugins/password-space/.cursor-plugin/plugin.json` | Absolute URL on `main`: `https://raw.githubusercontent.com/vishnutvm/password-space/main/plugins/password-space/assets/logo.svg` |
| `.cursor-plugin/marketplace.json` (`plugins[0]`) | Repo-root relative: `plugins/password-space/assets/logo.svg` |

Asset source: `plugins/password-space/assets/logo.svg` (128×128 viewBox SVG).

## Notes

- Per [Cursor plugin docs](https://cursor.com/docs/plugins), absolute URLs for `logo` in `plugin.json` are supported and fix broken icons when relative paths fail.
- If a view still fails on SVG, add `plugins/password-space/assets/logo-512.png` (512×512) and point `logo` at that file or its raw GitHub URL.
