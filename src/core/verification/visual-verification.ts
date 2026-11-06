import type { AuthorizedRoot } from "../execution/paths.ts";
import { readPngBounded } from "../assets/png.ts";
import { compareVisualBaseline } from "../assets/visual-diff.ts";
import type { EvidenceCheckInput } from "./evidence.ts";

const SHA256 = /^[a-f0-9]{64}$/;
const VISUAL_COVERAGE = [
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

export type VisualCoverage = (typeof VISUAL_COVERAGE)[number];

export interface VisualScenario {
  readonly id: string;
  readonly coverage: VisualCoverage;
  readonly resolution: { readonly width: number; readonly height: number };
  readonly guiScale: number;
  readonly camera: {
    readonly fov: number;
    readonly position: readonly [number, number, number];
    readonly yaw: number;
    readonly pitch: number;
  };
  readonly world: { readonly seed: string; readonly state: string };
  readonly timeTicks: number;
  readonly weather: "clear" | "rain" | "thunder";
  readonly deterministicTicks: number;
  readonly inputs: readonly {
    readonly tick: number;
    readonly action: string;
  }[];
  readonly environment: {
    readonly os: string;
    readonly renderer: string;
    readonly gpu: string;
  };
  readonly baseline: {
    readonly path: string;
    readonly sha256: string;
    readonly version: string;
    readonly tolerance: {
      readonly threshold: number;
      readonly maxDifferentPixels: number;
    };
  };
  readonly capture: { readonly path: string; readonly sha256: string };
  readonly evidence: {
    readonly runtime: EvidenceCheckInput;
    readonly capture: EvidenceCheckInput;
    readonly designReview: EvidenceCheckInput;
  };
}

export interface VisualVerificationInput {
  readonly root: AuthorizedRoot;
  readonly production: {
    readonly jarSha256: string;
    readonly cleanInstance: boolean;
  };
  readonly changeKind: "product" | "baseline_update";
  readonly baselineUpdateReview?: EvidenceCheckInput;
  readonly requiredCoverage: readonly VisualCoverage[];
  readonly scenarios: readonly VisualScenario[];
}

export interface VisualScenarioResult {
  readonly id: string;
  readonly status: "passed" | "failed";
  readonly differentPixels: number | null;
}

export interface VisualVerificationResult {
  readonly status: "passed" | "failed" | "unavailable";
  readonly code?: string;
  readonly scenarios: readonly VisualScenarioResult[];
  readonly missingCoverage?: readonly VisualCoverage[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function digest(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function isCoverage(value: unknown): value is VisualCoverage {
  return VISUAL_COVERAGE.includes(value as VisualCoverage);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validScenario(value: unknown): value is VisualScenario {
  if (!record(value) || !text(value.id) || !isCoverage(value.coverage)) {
    return false;
  }
  const { resolution, camera, world, environment, baseline, capture, inputs } =
    value;
  if (
    !record(resolution) ||
    !Number.isSafeInteger(resolution.width) ||
    (resolution.width as number) <= 0 ||
    !Number.isSafeInteger(resolution.height) ||
    (resolution.height as number) <= 0 ||
    !finiteNumber(value.guiScale) ||
    value.guiScale <= 0 ||
    !record(camera) ||
    !finiteNumber(camera.fov) ||
    camera.fov <= 0 ||
    camera.fov >= 180 ||
    !Array.isArray(camera.position) ||
    camera.position.length !== 3 ||
    !camera.position.every(finiteNumber) ||
    !finiteNumber(camera.yaw) ||
    !finiteNumber(camera.pitch) ||
    !record(world) ||
    !text(world.seed) ||
    !text(world.state) ||
    !nonNegativeInteger(value.timeTicks) ||
    !["clear", "rain", "thunder"].includes(value.weather as string) ||
    !nonNegativeInteger(value.deterministicTicks) ||
    !Array.isArray(inputs) ||
    !inputs.every(
      (input) =>
        record(input) && nonNegativeInteger(input.tick) && text(input.action),
    ) ||
    !record(environment) ||
    !text(environment.os) ||
    !text(environment.renderer) ||
    !text(environment.gpu) ||
    !record(baseline) ||
    !text(baseline.path) ||
    !digest(baseline.sha256) ||
    !text(baseline.version) ||
    !record(baseline.tolerance) ||
    !finiteNumber(baseline.tolerance.threshold) ||
    baseline.tolerance.threshold < 0 ||
    baseline.tolerance.threshold > 1 ||
    !nonNegativeInteger(baseline.tolerance.maxDifferentPixels) ||
    !record(capture) ||
    !text(capture.path) ||
    !digest(capture.sha256)
  ) {
    return false;
  }
  return true;
}

function executedPass(
  check: EvidenceCheckInput | undefined,
): check is EvidenceCheckInput {
  return (
    record(check) &&
    record(check.subject) &&
    check.requested === true &&
    check.executed === true &&
    check.status === "passed" &&
    check.exitCode === 0 &&
    Array.isArray(check.requestedArgv) &&
    check.requestedArgv.length > 0 &&
    Array.isArray(check.executedArgv) &&
    check.executedArgv.length > 0
  );
}

function sameScenario(
  check: EvidenceCheckInput,
  scenario: VisualScenario,
): boolean {
  const actual = check.subject?.scenario;
  return (
    actual?.id === scenario.id &&
    actual.state === scenario.coverage &&
    actual.kind === "state"
  );
}

function approvedHuman(
  check: EvidenceCheckInput | undefined,
): check is EvidenceCheckInput {
  const reviewer = check?.subject?.reviewer;
  return (
    executedPass(check) &&
    check.subject.class === "design_review" &&
    reviewer?.kind === "human" &&
    reviewer.decision === "approved" &&
    text(reviewer.rubric) &&
    Number.isInteger(reviewer.revision) &&
    reviewer.revision > 0 &&
    text(reviewer.id)
  );
}

function result(
  status: VisualVerificationResult["status"],
  code: string | undefined,
  scenarios: readonly VisualScenarioResult[] = [],
  missingCoverage?: readonly VisualCoverage[],
): VisualVerificationResult {
  return {
    status,
    ...(code === undefined ? {} : { code }),
    scenarios,
    ...(missingCoverage === undefined ? {} : { missingCoverage }),
  };
}

export async function reviewVisualScenarios(
  input: VisualVerificationInput,
): Promise<VisualVerificationResult> {
  if (
    !record(input) ||
    !record(input.production) ||
    !Array.isArray(input.requiredCoverage) ||
    !input.requiredCoverage.every(isCoverage) ||
    !Array.isArray(input.scenarios) ||
    !input.scenarios.every(validScenario) ||
    new Set(input.scenarios.map((scenario) => scenario.id)).size !==
      input.scenarios.length ||
    !["product", "baseline_update"].includes(input.changeKind)
  ) {
    return result("failed", "invalid_visual_scenario");
  }

  const covered = new Set(input.scenarios.map((scenario) => scenario.coverage));
  const missingCoverage = input.requiredCoverage.filter(
    (coverage) => !covered.has(coverage),
  );
  if (missingCoverage.length > 0) {
    return result("failed", "missing_visual_coverage", [], missingCoverage);
  }

  const productionValid =
    digest(input.production.jarSha256) &&
    input.production.cleanInstance === true;
  const evidence = input.scenarios.flatMap((scenario) => [
    scenario.evidence?.runtime,
    scenario.evidence?.capture,
    scenario.evidence?.designReview,
  ]);
  if (
    !productionValid ||
    evidence.some(
      (check) =>
        record(check) &&
        record(check.subject) &&
        check.subject.productionJarSha256 !== undefined &&
        check.subject.productionJarSha256 !== input.production.jarSha256,
    )
  ) {
    return result("unavailable", "production_jar_required");
  }

  if (input.changeKind === "baseline_update") {
    const review = input.baselineUpdateReview;
    const baselineDigests = new Set(
      input.scenarios.map((scenario) => scenario.baseline.sha256),
    );
    if (
      !approvedHuman(review) ||
      !digest(review.subject.baselineSha256) ||
      !baselineDigests.has(review.subject.baselineSha256)
    ) {
      return result("unavailable", "baseline_update_review_required");
    }
  }

  const results: VisualScenarioResult[] = [];
  for (const scenario of input.scenarios) {
    const { runtime, capture, designReview } = scenario.evidence ?? {};
    if (
      !executedPass(runtime) ||
      runtime.subject.class !== "runtime" ||
      runtime.subject.surface !== "minecraft_client" ||
      runtime.subject.productionJarSha256 !== input.production.jarSha256 ||
      !sameScenario(runtime, scenario)
    ) {
      return result("unavailable", "runtime_behavior_required", results);
    }
    if (
      !executedPass(capture) ||
      capture.subject.class !== "browser" ||
      capture.subject.surface !== "minecraft_client"
    ) {
      return result("unavailable", "minecraft_client_required", results);
    }
    if (
      capture.subject.productionJarSha256 !== input.production.jarSha256 ||
      capture.subject.baselineSha256 !== scenario.baseline.sha256 ||
      !sameScenario(capture, scenario)
    ) {
      return result("failed", "visual_capture_mismatch", results);
    }
    if (!approvedHuman(designReview)) {
      return result("unavailable", "design_review_required", results);
    }
    if (
      designReview.subject.productionJarSha256 !== input.production.jarSha256 ||
      designReview.subject.baselineSha256 !== scenario.baseline.sha256 ||
      !sameScenario(designReview, scenario)
    ) {
      return result("failed", "design_review_required", results);
    }

    let baseline;
    try {
      baseline = await readPngBounded(input.root, scenario.baseline.path);
    } catch {
      return result("unavailable", "visual_baseline_unavailable", results);
    }
    if (baseline.sha256 !== scenario.baseline.sha256) {
      return result("failed", "visual_baseline_mismatch", results);
    }

    let actual;
    try {
      actual = await readPngBounded(input.root, scenario.capture.path);
    } catch {
      return result("unavailable", "visual_capture_unavailable", results);
    }
    if (actual.sha256 !== scenario.capture.sha256) {
      return result("failed", "visual_capture_mismatch", results);
    }
    if (
      actual.width !== scenario.resolution.width ||
      actual.height !== scenario.resolution.height ||
      baseline.width !== scenario.resolution.width ||
      baseline.height !== scenario.resolution.height
    ) {
      return result("failed", "invalid_visual_scenario", results);
    }

    let differentPixels: number;
    try {
      differentPixels = compareVisualBaseline({
        baseline,
        actual,
        threshold: scenario.baseline.tolerance.threshold,
      }).differentPixels;
    } catch {
      results.push({
        id: scenario.id,
        status: "failed",
        differentPixels: null,
      });
      return result("failed", "visual_baseline_mismatch", results);
    }
    const passed =
      differentPixels <= scenario.baseline.tolerance.maxDifferentPixels;
    results.push({
      id: scenario.id,
      status: passed ? "passed" : "failed",
      differentPixels,
    });
    if (!passed) {
      return result("failed", "visual_baseline_mismatch", results);
    }
  }

  return result("passed", undefined, results);
}
