#!/bin/sh
set -eu

if [ -z "${COREPACK_HOME:-}" ]; then
  if [ -n "${XDG_CACHE_HOME:-}" ]; then
    COREPACK_HOME="$XDG_CACHE_HOME/node/corepack"
  else
    COREPACK_HOME="$HOME/.cache/node/corepack"
  fi
  export COREPACK_HOME
fi
if [ -z "${COREPACK_ENABLE_DOWNLOAD_PROMPT:-}" ]; then
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  export COREPACK_ENABLE_DOWNLOAD_PROMPT
fi

commit="__VOXELLUME_COMMIT__"
archive_sha256="__VOXELLUME_TAR_SHA256__"
temp_dir=''

fail() {
  printf 'Voxellume install failed: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [ -n "$temp_dir" ]; then
    rm -rf -- "$temp_dir"
  fi
}
trap cleanup EXIT HUP INT TERM

command -v node >/dev/null 2>&1 || fail 'Node.js 24.9.0 or newer is required.'
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 9)) process.exit(1)' || fail 'Node.js 24.9.0 or newer is required.'
command -v corepack >/dev/null 2>&1 || fail 'Corepack is required.'
corepack prepare pnpm@12.18.0 --activate || fail 'Could not activate pnpm 12.18.0 through Corepack.'
corepack pnpm --version >/dev/null 2>&1 || fail 'pnpm is unavailable through Corepack.'

if [ -n "${PNPM_HOME:-}" ]; then
  PATH="$PNPM_HOME:$PNPM_HOME/bin:$PATH"
  export PATH
fi

commit_placeholder='__VOXELLUME_''COMMIT__'
archive_placeholder='__VOXELLUME_''TAR_SHA256__'
local_mode=false
if [ "$commit" = "$commit_placeholder" ] && [ "$archive_sha256" = "$archive_placeholder" ]; then
  local_mode=true
elif [ "$commit" = "$commit_placeholder" ] || [ "$archive_sha256" = "$archive_placeholder" ]; then
  fail 'Installer pins were not rendered consistently.'
else
  case "$commit" in
    *[!0-9a-f]*) fail 'Invalid installer commit pin.' ;;
  esac
  case "$archive_sha256" in
    *[!0-9a-f]*) fail 'Invalid installer archive hash.' ;;
  esac
  [ "${#commit}" -eq 40 ] && [ "${#archive_sha256}" -eq 64 ] || fail 'Invalid installer pins.'
fi

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/voxellume-install.XXXXXX")" || fail 'Could not create a temporary directory.'
pack_dir="$temp_dir/package"
mkdir -p "$pack_dir"

if [ "$local_mode" = true ]; then
  source_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)" || fail 'Could not locate the local source.'
  [ -f "$source_dir/package.json" ] && [ -f "$source_dir/pnpm-lock.yaml" ] || fail 'Local install must run from a Voxellume source checkout.'
else
  command -v curl >/dev/null 2>&1 || fail 'curl is required for remote installation.'
  command -v tar >/dev/null 2>&1 || fail 'tar is required for remote installation.'
  archive="$temp_dir/voxellume.tar.gz"
  archive_url="https://codeload.github.com/lukavtz/voxellume/tar.gz/__VOXELLUME_COMMIT__"
  curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 "$archive_url" --output "$archive" || fail 'Could not download the pinned source archive.'

  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$archive")"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$archive")"
  else
    fail 'sha256sum or shasum is required to verify the archive.'
  fi
  actual="${actual%% *}"
  [ "$actual" = "$archive_sha256" ] || fail 'Source archive SHA-256 mismatch.'
  source_dir="$temp_dir/source"
  mkdir "$source_dir"
  tar -xzf "$archive" -C "$source_dir" --strip-components 1 || fail 'Could not extract the verified source archive.'
fi

cd "$source_dir"
corepack pnpm install --frozen-lockfile
corepack pnpm pack --pack-destination "$pack_dir"
set -- "$pack_dir"/*.tgz
[ "$#" -eq 1 ] && [ -f "$1" ] || fail 'Expected exactly one packed artifact.'
corepack pnpm add -g "$1"

global_bin="$(corepack pnpm bin -g)" || fail 'Could not determine the global pnpm bin directory.'
printf 'Installed. Run: voxellume-mcp\n'
case ":$PATH:" in
  *":$global_bin:"*) ;;
  *) printf 'Add the pnpm global bin directory to PATH: %s\n' "$global_bin" ;;
esac
