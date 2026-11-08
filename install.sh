#!/bin/sh
set -eu

commit="__VOXELLUME_COMMIT__"
archive_sha256="__VOXELLUME_TAR_SHA256__"
temp_dir=''
node_stage=''

fail() {
  printf 'Voxellume install failed: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [ -n "$node_stage" ]; then
    rm -rf -- "$node_stage"
  fi
  if [ -n "$temp_dir" ]; then
    rm -rf -- "$temp_dir"
  fi
}
trap cleanup EXIT HUP INT TERM

node_is_supported() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 9)) process.exit(1)' >/dev/null 2>&1
}

if ! node_is_supported; then
  node_home="$HOME/.local/share/voxellume/node/24.9.0"
  if [ -x "$node_home/bin/node" ] && "$node_home/bin/node" -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 9)) process.exit(1)' >/dev/null 2>&1; then
    PATH="$node_home/bin:$PATH"
    export PATH
  else
    if [ -e "$node_home" ] || [ -L "$node_home" ]; then
      fail 'Existing Node.js 24.9.0 installation is unusable; refusing to overwrite it.'
    fi

    case "$(uname -s)" in
      Darwin) node_platform=darwin ;;
      Linux) node_platform=linux ;;
      *) fail 'Unsupported operating system for automatic Node.js installation.' ;;
    esac
    case "$(uname -m)" in
      x86_64|amd64) node_arch=x64 ;;
      arm64|aarch64) node_arch=arm64 ;;
      *) fail 'Unsupported CPU architecture for automatic Node.js installation.' ;;
    esac
    command -v curl >/dev/null 2>&1 || fail 'curl is required to install Node.js.'
    command -v tar >/dev/null 2>&1 || fail 'tar is required to install Node.js.'

    temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/voxellume-node.XXXXXX")" || fail 'Could not create a temporary directory.'
    node_archive_name="node-v24.9.0-$node_platform-$node_arch.tar.xz"
    node_base_url="https://nodejs.org/dist/v24.9.0"
    node_archive="$temp_dir/$node_archive_name"
    node_checksums="$temp_dir/SHASUMS256.txt"
    curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 "$node_base_url/SHASUMS256.txt" --output "$node_checksums" || fail 'Could not download the Node.js checksums.'
    curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 "$node_base_url/$node_archive_name" --output "$node_archive" || fail 'Could not download the official Node.js archive.'

    node_expected=''
    while IFS=' ' read -r hash filename _; do
      if [ "$filename" = "$node_archive_name" ]; then
        node_expected="$hash"
        break
      fi
    done < "$node_checksums"
    case "$node_expected" in
      *[!0-9a-f]*) fail 'Invalid Node.js archive checksum.' ;;
    esac
    [ "${#node_expected}" -eq 64 ] || fail 'Node.js archive checksum was not listed.'

    if command -v sha256sum >/dev/null 2>&1; then
      node_actual="$(sha256sum "$node_archive")"
    elif command -v shasum >/dev/null 2>&1; then
      node_actual="$(shasum -a 256 "$node_archive")"
    else
      fail 'sha256sum or shasum is required to verify Node.js.'
    fi
    node_actual="${node_actual%% *}"
    [ "$node_actual" = "$node_expected" ] || fail 'Node.js archive SHA-256 mismatch.'

    node_root="${node_home%/24.9.0}"
    mkdir -p "$node_root"
    node_stage="$(mktemp -d "$node_root/.24.9.0.XXXXXX")" || fail 'Could not create the Node.js staging directory.'
    tar -xJf "$node_archive" -C "$node_stage" --strip-components 1 || fail 'Could not extract the verified Node.js archive.'
    [ -x "$node_stage/bin/node" ] && [ -x "$node_stage/bin/npx" ] || fail 'The Node.js archive has an unexpected layout.'
    [ ! -e "$node_home" ] && [ ! -L "$node_home" ] || fail 'Node.js installation appeared during setup; refusing to overwrite it.'
    mv "$node_stage" "$node_home" || fail 'Could not activate Node.js 24.9.0.'
    node_stage=''
    PATH="$node_home/bin:$PATH"
    export PATH
  fi
fi
node_is_supported || fail 'Node.js 24.9.0 or newer is required.'
command -v npx >/dev/null 2>&1 || fail 'npx is required.'

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
npx --yes corepack@0.34.5 prepare pnpm@12.18.0 --activate || fail 'Could not activate pnpm 12.18.0 through Corepack.'
npx --yes corepack@0.34.5 pnpm --version >/dev/null 2>&1 || fail 'pnpm is unavailable through Corepack.'

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

if [ -z "$temp_dir" ]; then
  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/voxellume-install.XXXXXX")" || fail 'Could not create a temporary directory.'
fi
pack_dir="$temp_dir/package"
mkdir -p "$pack_dir"

if [ "$local_mode" = true ]; then
  source_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)" || fail 'Could not locate the local source.'
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
npx --yes corepack@0.34.5 pnpm install --frozen-lockfile
npx --yes corepack@0.34.5 pnpm pack --pack-destination "$pack_dir"
set -- "$pack_dir"/*.tgz
[ "$#" -eq 1 ] && [ -f "$1" ] || fail 'Expected exactly one packed artifact.'
npx --yes corepack@0.34.5 pnpm add -g "$1"

global_bin="$(npx --yes corepack@0.34.5 pnpm bin -g)" || fail 'Could not determine the global pnpm bin directory.'
printf 'Installed. Run: voxellume-mcp\n'
if [ "${VOXELLUME_SKIP_SETUP:-0}" != "1" ]; then
  printf 'Installing desktop prerequisites and Blockbench MCP. Set VOXELLUME_SKIP_SETUP=1 to skip.\n'
  if [ "${VOXELLUME_SETUP_YES:-0}" = "1" ]; then
    voxellume setup --lang "${VOXELLUME_LANG:-en}" --yes --blockbench-mcp-root "${VOXELLUME_MODEL_ROOT:-$HOME/models}"
  else
    printf 'Desktop setup skipped. Set VOXELLUME_SETUP_YES=1 to install prerequisites and Blockbench MCP.\n'
  fi
fi
case ":$PATH:" in
  *":$global_bin:"*) ;;
  *) printf 'Add the pnpm global bin directory to PATH: %s\n' "$global_bin" ;;
esac
