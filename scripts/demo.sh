#!/usr/bin/env bash
# Non-interactive local demo (safe throwaway vault under /tmp).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PASSWORD_SPACE_HOME="${PASSWORD_SPACE_DEMO_HOME:-/tmp/password-space-demo}"
rm -rf "$PASSWORD_SPACE_HOME"
cd "$ROOT"
echo "==> init / unlock / set / list / status / lock"
PASSWORD_SPACE_PASSPHRASE='demo-pass-ok' pnpm password-space init
PASSWORD_SPACE_PASSPHRASE='demo-pass-ok' pnpm password-space unlock
printf 'ghp_demo_secret_value' | pnpm password-space set DEMO_TOKEN --tags demo
pnpm password-space list
pnpm password-space status --json
pnpm password-space lock
echo "==> done (vault at $PASSWORD_SPACE_HOME)"
