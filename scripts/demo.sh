#!/usr/bin/env bash
# Non-interactive local demo (safe throwaway store under /tmp).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PASSWORD_SPACE_HOME="${PASSWORD_SPACE_DEMO_HOME:-/tmp/password-space-demo}"
rm -rf "$PASSWORD_SPACE_HOME"
cd "$ROOT"
echo "==> setup / set / list / status"
pnpm password-space setup
printf 'ghp_demo_secret_value' | pnpm password-space set DEMO_TOKEN --tags demo
pnpm password-space list
pnpm password-space status --json
echo "==> done (store at $PASSWORD_SPACE_HOME)"
