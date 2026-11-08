import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const workflowRoot = new URL(".github/workflows/", root);
const required = new Set([
  "quality.yml",
  "host-contract.yml",
  "security.yml",
  "target-matrix.yml",
  "runtime-visual.yml",
  "release.yml",
  "pages.yml",
]);
const files = (await readdir(workflowRoot)).filter((name) =>
  name.endsWith(".yml"),
);
assert.deepEqual(files.toSorted(), [...required].toSorted());

const workflows = new Map();
for (const name of required) {
  const source = await readFile(new URL(name, workflowRoot), "utf8");
  workflows.set(name, source);
  assert.doesNotMatch(
    source,
    /pull_request_target\s*:/,
    `${name}: forbidden trigger`,
  );
  assert.doesNotMatch(
    source,
    /runs-on:\s*self-hosted\b/,
    `${name}: persistent self-hosted runner`,
  );
  assert.doesNotMatch(
    source,
    /\bsecrets\./,
    `${name}: secrets are not granted`,
  );
  assert.match(
    source,
    /^permissions:\n  contents: read$/m,
    `${name}: contents:read required`,
  );
  assert.doesNotMatch(
    source,
    /^\s+(?:contents|actions|checks|deployments|issues|packages|pull-requests|security-events|statuses|attestations):\s+write$/m,
    `${name}: write permission`,
  );
  if (name === "pages.yml") {
    assert.match(source, /^\s+pages:\s+write$/m, "pages:write required");
    assert.match(
      source,
      /^\s+id-token:\s+write$/m,
      "pages id-token:write required",
    );
  } else {
    assert.doesNotMatch(
      source,
      /^\s+(?:pages|id-token):\s+write$/m,
      `${name}: deployment permission`,
    );
  }
  assert.match(
    source,
    /actions\/upload(?:-pages)?-artifact@[0-9a-f]{40}/,
    `${name}: evidence upload required`,
  );

  const uses = source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)@([^\s#]+)/gm);
  let actionCount = 0;
  for (const match of uses) {
    actionCount += 1;
    assert.match(match[2], /^[0-9a-f]{40}$/, `${name}: unpinned ${match[1]}`);
  }
  assert.ok(actionCount > 0, `${name}: no actions found`);
}

assert.match(workflows.get("quality.yml"), /pnpm format:check/);
assert.match(workflows.get("quality.yml"), /pnpm lint/);
assert.match(workflows.get("quality.yml"), /pnpm typecheck/);
assert.match(workflows.get("quality.yml"), /pnpm test:unit/);
assert.match(workflows.get("quality.yml"), /pnpm test:integration/);
assert.match(workflows.get("host-contract.yml"), /pnpm test:host/);
assert.match(workflows.get("host-contract.yml"), /verify-host-install\.mjs/);
assert.match(workflows.get("security.yml"), /pnpm test:security/);
const securityContract =
  workflows.get("security.yml") +
  (await readFile(new URL("scripts/ci/security-scan.sh", root), "utf8"));
assert.match(securityContract, /gitleaks(?:"|\s)+git/);
assert.match(securityContract, /--metrics=off/);
assert.match(securityContract, /osv-scanner(?:"|\s)+scan source/);
assert.match(securityContract, /cdxgen/);
assert.match(securityContract, /licenses list --json/);
assert.match(workflows.get("target-matrix.yml"), /cron:/);
assert.match(workflows.get("target-matrix.yml"), /target-cell\.mjs/);
assert.match(workflows.get("runtime-visual.yml"), /VOXELLUME_GPU_RUNNER/);
assert.match(workflows.get("runtime-visual.yml"), /runner\.environment/);
assert.match(workflows.get("runtime-visual.yml"), /nvidia-smi/);
assert.match(workflows.get("release.yml"), /release-artifact\.mjs/);
assert.match(workflows.get("release.yml"), /--require-supported/);
assert.match(workflows.get("release.yml"), /verify-host-install\.mjs/);
assert.match(
  workflows.get("pages.yml"),
  /actions\/configure-pages@[0-9a-f]{40}/,
);
assert.match(workflows.get("pages.yml"), /actions\/deploy-pages@[0-9a-f]{40}/);
assert.match(workflows.get("pages.yml"), /build-site\.mjs/);

console.log(
  "Validated seven workflows: full-SHA actions, least-privilege permissions, forbidden triggers absent, required gates present.",
);
