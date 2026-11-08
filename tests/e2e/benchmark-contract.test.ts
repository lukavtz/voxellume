import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

interface AcceptanceCriterion {
  id: string;
  check: string;
  expected: string;
}

interface BenchmarkScenario {
  id: string;
  revision: number;
  request: string;
  acceptance: AcceptanceCriterion[];
  delivery?: string[];
}

interface BenchmarkDocument {
  schemaVersion: string;
  benchmarkVersion: string;
  execution: { modelIndependent: string; modelBacked: string };
  scenarios: BenchmarkScenario[];
}

const document = JSON.parse(
  await readFile(new URL("benchmarks/v1.json", import.meta.url), "utf8"),
) as BenchmarkDocument;

const requiredAcceptance: Record<string, string[]> = {
  "simple-item": [
    "item-registered",
    "texture-lang",
    "recipe",
    "creative-tab",
    "build",
    "runtime",
  ],
  "advanced-block": [
    "block-model",
    "block-entity-persistence",
    "gui-networking",
    "drops",
    "multiplayer",
    "build-runtime",
  ],
  entity: [
    "entity-goals-attributes",
    "editable-art",
    "animations",
    "spawning-loot-sound",
    "persistence",
    "build-runtime",
  ],
  worldgen: [
    "configured-placed-feature",
    "biome-rarity",
    "reproducibility",
    "build-runtime",
  ],
  "existing-project": [
    "inspection",
    "feature-added",
    "unrelated-files-preserved",
    "regression-verification",
  ],
  "failure-recovery": [
    "original-failures-recorded",
    "source-resource-test-repaired",
    "bounded-attempts",
    "last-good-restored",
    "passing-verification",
  ],
  "unsupported-target": [
    "explicit-unsupported",
    "no-substitution",
    "zero-success-artifacts",
  ],
  "full-delivery": [
    "create",
    "verify",
    "document",
    "commit",
    "push",
    "pull-request",
    "no-credentials",
  ],
};

test("benchmark v1 versions every natural-language request and independent oracle", () => {
  assert.equal(document.schemaVersion, "voxellume-e2e-benchmarks-1.0.0");
  assert.equal(document.benchmarkVersion, "1.0.0");
  assert.deepEqual(document.execution, {
    modelIndependent: "required",
    modelBacked: "optional",
  });
  assert.deepEqual(
    document.scenarios.map((scenario) => scenario.id).sort(),
    Object.keys(requiredAcceptance).sort(),
  );

  const scenarioIds = new Set<string>();
  for (const scenario of document.scenarios) {
    assert.equal(scenarioIds.has(scenario.id), false);
    scenarioIds.add(scenario.id);
    assert.ok(Number.isInteger(scenario.revision) && scenario.revision >= 1);
    assert.ok(scenario.request.length >= 80);
    assert.equal(
      scenario.request.includes("\n"),
      false,
      "requests remain single natural-language prompts",
    );
    assert.deepEqual(
      scenario.acceptance.map((criterion) => criterion.id),
      requiredAcceptance[scenario.id],
    );
    const criterionIds = new Set<string>();
    for (const criterion of scenario.acceptance) {
      assert.equal(criterionIds.has(criterion.id), false);
      criterionIds.add(criterion.id);
      assert.ok(criterion.check.length > 0);
      assert.ok(
        criterion.expected.length >= 30,
        `${scenario.id}/${criterion.id} needs an independent expected result`,
      );
    }
  }
});

test("failure recovery and full delivery encode their non-negotiable bounds", () => {
  const recovery = document.scenarios.find(
    (scenario) => scenario.id === "failure-recovery",
  );
  assert.ok(recovery);
  assert.match(recovery.request, /three attempts|3 attempts/i);
  assert.match(recovery.request, /source, resources, and tests/i);
  assert.match(recovery.request, /last verified state/i);

  const delivery = document.scenarios.find(
    (scenario) => scenario.id === "full-delivery",
  );
  assert.ok(delivery);
  assert.deepEqual(delivery.delivery, [
    "create",
    "verify",
    "document",
    "commit",
    "push",
    "pull-request",
  ]);
  assert.match(delivery.request, /disposable test repository/i);
  assert.match(delivery.request, /trusted approval/i);
});
