#!/usr/bin/env bash
set -euo pipefail

out="${1:-.artifacts/security}"
bin="${2:-.ci-tools/bin}"
venv="${3:-.ci-tools/venv}"
mkdir -p "$out"

"$bin/gitleaks" git \
  --redact=100 \
  --max-archive-depth=0 \
  --max-target-megabytes=16 \
  --timeout=300 \
  --report-format=json \
  --report-path="$out/gitleaks.json" \
  . 2>&1 | tee "$out/gitleaks.log"

"$venv/bin/semgrep" scan \
  --config=scripts/ci/semgrep-rules.yml \
  --metrics=off \
  --error \
  --exclude=tests \
  --exclude=node_modules \
  --exclude=.artifacts \
  --json \
  --output="$out/semgrep.json" \
  . 2>&1 | tee "$out/semgrep.log"

"$bin/osv-scanner" scan source \
  --lockfile=pnpm-lock.yaml \
  --format=json \
  --output-file="$out/osv.json" \
  . 2>&1 | tee "$out/osv.log"

"$bin/cdxgen" -t js -o "$out/cyclonedx.json" . 2>&1 | tee "$out/cyclonedx.log"
corepack pnpm licenses list --json --long > "$out/licenses.json"
node --input-type=module --eval '
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  const bom = JSON.parse(readFileSync(process.argv[1], "utf8"));
  assert.equal(bom.bomFormat, "CycloneDX");
  assert.ok(Array.isArray(bom.components));
  assert.ok(bom.components.length > 0);
  const licenses = JSON.parse(readFileSync(process.argv[2], "utf8"));
  assert.ok(Object.keys(licenses).length > 0);
' "$out/cyclonedx.json" "$out/licenses.json"

sha256sum "$out/gitleaks.json" "$out/semgrep.json" "$out/osv.json" \
  "$out/cyclonedx.json" "$out/licenses.json" > "$out/SHA256SUMS"
