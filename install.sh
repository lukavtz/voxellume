#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "$0")"
if [[ -n "${PNPM_HOME:-}" ]]; then
  export PATH="$PNPM_HOME/bin:$PATH"
fi
corepack pnpm install --frozen-lockfile
tarball="$(corepack pnpm pack | tail -n 1)"
corepack pnpm add -g "./$tarball"
printf 'Installed. Run: voxellume-mcp\n'
