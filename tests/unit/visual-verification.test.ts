import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { PNG } from "pngjs";

import {
  grantAuthorizedRoot,
  releaseAuthorizedRoot,
  type AuthorizedRoot,
} from "../../src/core/execution/paths.ts";
import type { EvidenceCheckInput } from "../../src/core/verification/evidence.ts";
import {
  reviewVisualScenarios,
  type VisualVerificationInput,
  type VisualVerificationResult,
} from "../../src/core/verification/visual-verification.ts";

const coverage = [
  "inventory",
  "first_person_hand",
  "third_person_hand",
  "dropped_item",
  "placed_block",
  "north",
  "east",
  "south",
  "west",
  "top",
  "bottom",
  "gui_open",
  "gui_close",
  "animation_idle",
  "animation_walk",
  "animation_attack",
] as const;

interface VisualFixture {
  readonly root: AuthorizedRoot;
  readonly baselineSha256: string;
  readonly changedSha256: string;
  readonly productionJarSha256: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function png(red: number): Buffer {
  const image = new PNG({ width: 2, height: 2 });
  for (let pixel = 0; pixel < 4; pixel += 1) {
    image.data.set([red, 20, 40, 255], pixel * 4);
  }
  return PNG.sync.write(image);
}

async function visualFixture(t: TestContext): Promise<VisualFixture> {
  const directory = await mkdtemp(join(tmpdir(), "voxellume-visual-unit-"));
  const baseline = png(10);
  const changed = png(200);
  await Promise.all([
    writeFile(join(directory, "baseline.png"), baseline),
    writeFile(join(directory, "actual.png"), baseline),
    writeFile(join(directory, "changed.png"), changed),
  ]);
  const root = await grantAuthorizedRoot({ path: directory, kind: "project" });
  t.after(async () => {
    await releaseAuthorizedRoot(root);
    await rm(directory, { recursive: true, force: true });
  });
  return {
    root,
    baselineSha256: sha256(baseline),
    changedSha256: sha256(changed),
    productionJarSha256: "a".repeat(64),
  };
}

function passedCheck(
  id: string,
  subject: EvidenceCheckInput["subject"],
): EvidenceCheckInput {
  return {
    id,
    requested: true,
    executed: true,
    status: "passed",
    requestedArgv: ["synthetic-review", id],
    executedArgv: ["synthetic-review", id],
    exitCode: 0,
    subject,
    logs: [],
  };
}

function inputFor(fixture: VisualFixture): VisualVerificationInput {
  return {
    root: fixture.root,
    production: {
      jarSha256: fixture.productionJarSha256,
      cleanInstance: true,
    },
    changeKind: "product",
    requiredCoverage: [...coverage],
    scenarios: coverage.map((kind) => {
      const id = `scene_${kind}`;
      const scenario = { id, state: kind, kind: "state" as const };
      return {
        id,
        coverage: kind,
        resolution: { width: 2, height: 2 },
        guiScale: 1,
        camera: {
          fov: 70,
          position: [0, 64, 0],
          yaw: 0,
          pitch: 0,
        },
        world: { seed: "424242", state: "pristine-ruby-tools-world" },
        timeTicks: 1_000,
        weather: "clear",
        deterministicTicks: 20,
        inputs: [
          { tick: 0, action: "join_world" },
          { tick: 20, action: "capture" },
        ],
        environment: {
          os: "linux-x64",
          renderer: "OpenGL 4.6",
          gpu: "synthetic-test-renderer",
        },
        baseline: {
          path: "baseline.png",
          sha256: fixture.baselineSha256,
          version: "ruby-tools-baseline-v3",
          tolerance: { threshold: 0.1, maxDifferentPixels: 0 },
        },
        capture: { path: "actual.png", sha256: fixture.baselineSha256 },
        evidence: {
          runtime: passedCheck(`${id}-runtime`, {
            class: "runtime",
            surface: "minecraft_client",
            productionJarSha256: fixture.productionJarSha256,
            scenario,
          }),
          capture: passedCheck(`${id}-capture`, {
            class: "browser",
            surface: "minecraft_client",
            productionJarSha256: fixture.productionJarSha256,
            baselineSha256: fixture.baselineSha256,
            scenario,
          }),
          designReview: passedCheck(`${id}-design`, {
            class: "design_review",
            productionJarSha256: fixture.productionJarSha256,
            baselineSha256: fixture.baselineSha256,
            scenario,
            reviewer: {
              id: "synthetic-human-review",
              revision: 1,
              rubric:
                "style,materials,silhouette,uv,clipping,z-fighting,animation,gui",
              decision: "approved",
              kind: "human",
            },
          }),
        },
      };
    }),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function removePath(value: unknown, path: readonly string[]): void {
  let parent = record(value);
  for (const part of path.slice(0, -1)) parent = record(parent[part]);
  delete parent[path.at(-1)!];
}

function setPath(
  value: unknown,
  path: readonly string[],
  replacement: unknown,
): void {
  let parent = record(value);
  for (const part of path.slice(0, -1)) parent = record(parent[part]);
  parent[path.at(-1)!] = replacement;
}

function assertCode(
  result: VisualVerificationResult,
  status: VisualVerificationResult["status"],
  code: string,
): void {
  assert.equal(result.status, status);
  assert.equal(result.code, code);
}

// Synthetic checks exercise the contract; they are not real-Minecraft or human claims.
test("requires the complete deterministic scenario contract and full visual coverage", async (t) => {
  const fixture = await visualFixture(t);
  const result = await reviewVisualScenarios(inputFor(fixture));

  assert.equal(result.status, "passed");
  assert.equal(result.code, undefined);
  assert.deepEqual(
    result.scenarios.map((scenario) => ({
      id: scenario.id,
      status: scenario.status,
      differentPixels: scenario.differentPixels,
    })),
    coverage.map((kind) => ({
      id: `scene_${kind}`,
      status: "passed",
      differentPixels: 0,
    })),
  );
});

test("rejects every missing fixed scene, environment, and baseline field", async (t) => {
  const fixture = await visualFixture(t);
  const requiredPaths = [
    ["scenarios", "0", "resolution"],
    ["scenarios", "0", "guiScale"],
    ["scenarios", "0", "camera"],
    ["scenarios", "0", "camera", "fov"],
    ["scenarios", "0", "world", "seed"],
    ["scenarios", "0", "world", "state"],
    ["scenarios", "0", "timeTicks"],
    ["scenarios", "0", "weather"],
    ["scenarios", "0", "deterministicTicks"],
    ["scenarios", "0", "inputs"],
    ["scenarios", "0", "environment", "os"],
    ["scenarios", "0", "environment", "renderer"],
    ["scenarios", "0", "environment", "gpu"],
    ["scenarios", "0", "baseline", "version"],
    ["scenarios", "0", "baseline", "tolerance"],
  ];
  for (const path of requiredPaths) {
    const input = inputFor(fixture);
    removePath(input, path);
    assertCode(
      await reviewVisualScenarios(input),
      "failed",
      "invalid_visual_scenario",
    );
  }
});

test("reports each absent inventory, hand, block, direction, GUI, and animation scene", async (t) => {
  const fixture = await visualFixture(t);
  for (const required of coverage) {
    const input = inputFor(fixture);
    record(input).scenarios = input.scenarios.filter(
      (scenario) => scenario.coverage !== required,
    );
    const result = await reviewVisualScenarios(input);
    assertCode(result, "failed", "missing_visual_coverage");
    assert.deepEqual(result.missingCoverage, [required]);
  }
});

test("requires the exact production JAR in a clean instance", async (t) => {
  const fixture = await visualFixture(t);
  for (const path of [
    ["production", "jarSha256"],
    ["production", "cleanInstance"],
  ] as const) {
    const input = inputFor(fixture);
    setPath(input, path, path.at(-1) === "jarSha256" ? "0".repeat(64) : false);
    assertCode(
      await reviewVisualScenarios(input),
      "unavailable",
      "production_jar_required",
    );
  }

  const staleCapture = inputFor(fixture);
  setPath(
    staleCapture,
    ["scenarios", "0", "evidence", "capture", "subject", "productionJarSha256"],
    "0".repeat(64),
  );
  assertCode(
    await reviewVisualScenarios(staleCapture),
    "unavailable",
    "production_jar_required",
  );
});

test("malformed evidence members return structured gate results", async (t) => {
  const fixture = await visualFixture(t);
  for (const testCase of [
    {
      path: ["scenarios", "0", "evidence", "runtime"],
      replacement: null,
      code: "runtime_behavior_required",
    },
    {
      path: ["scenarios", "0", "evidence", "capture", "subject"],
      replacement: null,
      code: "minecraft_client_required",
    },
    {
      path: ["scenarios", "0", "evidence", "designReview"],
      replacement: "not-evidence",
      code: "design_review_required",
    },
  ] as const) {
    const input = inputFor(fixture);
    setPath(input, testCase.path, testCase.replacement);
    assertCode(
      await reviewVisualScenarios(input),
      "unavailable",
      testCase.code,
    );
  }
});

test("a zero pixel diff never replaces executed runtime behavior evidence", async (t) => {
  const fixture = await visualFixture(t);
  for (const mode of ["missing", "unexecuted"] as const) {
    const input = inputFor(fixture);
    if (mode === "missing") {
      removePath(input, ["scenarios", "0", "evidence", "runtime"]);
    } else {
      const runtime = record(
        record(record(input.scenarios[0]).evidence).runtime,
      );
      runtime.executed = false;
      runtime.status = "unavailable";
      runtime.executedArgv = null;
      runtime.exitCode = null;
    }
    assertCode(
      await reviewVisualScenarios(input),
      "unavailable",
      "runtime_behavior_required",
    );
  }
});

test("only an executed minecraft_client browser subject closes the rendered-surface gate", async (t) => {
  const fixture = await visualFixture(t);
  for (const surface of [
    "blockbench",
    "blender",
    "minecraft_server",
  ] as const) {
    const input = inputFor(fixture);
    setPath(
      input,
      ["scenarios", "0", "evidence", "capture", "subject", "surface"],
      surface,
    );
    assertCode(
      await reviewVisualScenarios(input),
      "unavailable",
      "minecraft_client_required",
    );
  }

  const wrongClass = inputFor(fixture);
  setPath(
    wrongClass,
    ["scenarios", "0", "evidence", "capture", "subject", "class"],
    "runtime",
  );
  assertCode(
    await reviewVisualScenarios(wrongClass),
    "unavailable",
    "minecraft_client_required",
  );
});

test("a zero pixel diff is unavailable without a current approved human rubric", async (t) => {
  const fixture = await visualFixture(t);
  for (const mode of [
    "missing",
    "missing_rubric",
    "stand_in",
    "unexecuted",
  ] as const) {
    const input = inputFor(fixture);
    if (mode === "missing") {
      removePath(input, ["scenarios", "0", "evidence", "designReview"]);
    } else if (mode === "missing_rubric") {
      removePath(input, [
        "scenarios",
        "0",
        "evidence",
        "designReview",
        "subject",
        "reviewer",
        "rubric",
      ]);
    } else if (mode === "stand_in") {
      setPath(
        input,
        [
          "scenarios",
          "0",
          "evidence",
          "designReview",
          "subject",
          "reviewer",
          "kind",
        ],
        "stand_in",
      );
    } else {
      const review = record(
        record(record(input.scenarios[0]).evidence).designReview,
      );
      review.executed = false;
      review.status = "unavailable";
      review.executedArgv = null;
      review.exitCode = null;
    }
    assertCode(
      await reviewVisualScenarios(input),
      "unavailable",
      "design_review_required",
    );
  }
});

test("human approval cannot hide a numeric baseline regression", async (t) => {
  const fixture = await visualFixture(t);
  const input = inputFor(fixture);
  setPath(input, ["scenarios", "0", "capture"], {
    path: "changed.png",
    sha256: fixture.changedSha256,
  });

  const result = await reviewVisualScenarios(input);
  assertCode(result, "failed", "visual_baseline_mismatch");
  assert.equal(result.scenarios[0]?.differentPixels, 4);
});

test("baseline updates need separate approval in addition to scenario design review", async (t) => {
  const fixture = await visualFixture(t);
  const unreviewed = inputFor(fixture);
  record(unreviewed).changeKind = "baseline_update";
  assertCode(
    await reviewVisualScenarios(unreviewed),
    "unavailable",
    "baseline_update_review_required",
  );

  const reviewed = inputFor(fixture);
  record(reviewed).changeKind = "baseline_update";
  record(reviewed).baselineUpdateReview = passedCheck(
    "baseline-update-design",
    {
      class: "design_review",
      baselineSha256: fixture.baselineSha256,
      reviewer: {
        id: "separate-baseline-review",
        revision: 4,
        rubric: "intentional-baseline-change",
        decision: "approved",
        kind: "human",
      },
    },
  );
  assert.equal((await reviewVisualScenarios(reviewed)).status, "passed");

  const productApprovalOnly = inputFor(fixture);
  record(productApprovalOnly).changeKind = "baseline_update";
  removePath(productApprovalOnly, [
    "scenarios",
    "0",
    "evidence",
    "designReview",
  ]);
  assertCode(
    await reviewVisualScenarios(productApprovalOnly),
    "unavailable",
    "baseline_update_review_required",
  );
});

test("capture hash and bounded PNG read failures cannot become visual passes", async (t) => {
  const fixture = await visualFixture(t);
  const wrongHash = inputFor(fixture);
  setPath(wrongHash, ["scenarios", "0", "capture", "sha256"], "0".repeat(64));
  assertCode(
    await reviewVisualScenarios(wrongHash),
    "failed",
    "visual_capture_mismatch",
  );

  const missing = inputFor(fixture);
  setPath(missing, ["scenarios", "0", "capture", "path"], "missing.png");
  assertCode(
    await reviewVisualScenarios(missing),
    "unavailable",
    "visual_capture_unavailable",
  );
});
