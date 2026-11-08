#!/usr/bin/env bash
set -euo pipefail

bin_dir="${1:-.ci-tools/bin}"
download_dir="${2:-.ci-tools/downloads}"
mkdir -p "$bin_dir" "$download_dir"

case "$(uname -m)" in
  x86_64|amd64)
    gitleaks_arch=x64
    osv_arch=amd64
    cdx_arch=amd64
    gitleaks_sha=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
    osv_sha=160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b
    ;;
  aarch64|arm64)
    gitleaks_arch=arm64
    osv_arch=arm64
    cdx_arch=arm64
    gitleaks_sha=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080
    osv_sha=4061ef4c021ed3c47f203b818f337e351336cc5cd67c0274fc36bd1dfc728dd7
    ;;
  *)
    printf 'Unsupported CI architecture: %s\n' "$(uname -m)" >&2
    exit 1
    ;;
esac

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_${gitleaks_arch}.tar.gz" \
  --output "$download_dir/gitleaks.tar.gz"
printf '%s  %s\n' "$gitleaks_sha" "$download_dir/gitleaks.tar.gz" | sha256sum --check --status
tar -xzf "$download_dir/gitleaks.tar.gz" -C "$bin_dir" gitleaks
chmod 0755 "$bin_dir/gitleaks"

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://github.com/google/osv-scanner/releases/download/v2.7.0/osv-scanner_linux_${osv_arch}" \
  --output "$bin_dir/osv-scanner"
printf '%s  %s\n' "$osv_sha" "$bin_dir/osv-scanner" | sha256sum --check --status
chmod 0755 "$bin_dir/osv-scanner"

cdx_asset="cdxgen-linux-${cdx_arch}"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://github.com/cdxgen/cdxgen/releases/download/v12.9.1/${cdx_asset}" \
  --output "$bin_dir/cdxgen"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://github.com/cdxgen/cdxgen/releases/download/v12.9.1/${cdx_asset}.sha256" \
  --output "$download_dir/cdxgen.sha256"
expected_cdx_sha="$(cut -d ' ' -f 1 "$download_dir/cdxgen.sha256")"
printf '%s  %s\n' "$expected_cdx_sha" "$bin_dir/cdxgen" | sha256sum --check --status
chmod 0755 "$bin_dir/cdxgen"

"$bin_dir/gitleaks" version
"$bin_dir/osv-scanner" --version
"$bin_dir/cdxgen" --version
