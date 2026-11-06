import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  analyzeAnimation,
  exportAnimation,
  generateAnimation,
  reviewAnimation,
  validateAnimationSpec,
} from "../../src/core/assets/animation-spec.ts";
import type {
  AnimationModel,
  AnimationReviewInput,
  AnimationSpec,
} from "../../src/core/assets/animation-spec.ts";
import {
  finalizeEvidence,
  type EvidenceCheckInput,
  type EvidenceCheckSubject,
  type FinalizeEvidenceOptions,
} from "../../src/core/verification/evidence.ts";

type JsonObject = Record<string, unknown>;
type Issue = { code: string; path?: string };
type ValidationResult = {
  status: string;
  spec?: AnimationSpec;
  issues?: Issue[];
  checks?: Array<{ checked: boolean; status: string }>;
};
type GenerationResult = {
  status: string;
  spec?: AnimationSpec;
  semanticSha256?: string;
  provenance?: {
    seed: number;
    rngAlgorithm: string;
    seedDerivationVersion: number;
  };
  issues?: Issue[];
};
type Finding = {
  code: string;
  ruleId: string;
  path?: string;
  clipId?: string;
  boneId?: string;
};
type AnalysisResult = {
  status: string;
  findings: Finding[];
  metrics?: Record<string, Record<string, number>>;
};
type ExportResult = {
  status: string;
  code?: string;
  files: Array<{ kind: string; path: string; content: string; sha256: string }>;
  roundTripDiff?: unknown[];
  roundTrip?: {
    checked: boolean;
    status: string;
    compared: {
      cubes: number;
      bones: number;
      pivots: number;
      uvFaces: number;
      materials: number;
      clipNames: string[];
    };
    normalized: {
      model: AnimationModel;
      spec: AnimationSpec;
    };
  };
  checks?: Array<{
    id: string;
    path?: string;
    checked: boolean;
    status: string;
    sha256?: string;
    schema?: string;
    surface?: string;
  }>;
};
type ReviewResult = {
  status: string;
  code?: string;
  checks?: Array<{ id: string; checked: boolean; status: string }>;
};

const sourceSha256 =
  "a23bb80f01deb0ed80dcd1168aad559e10db37be6ccf51ed19ff7d835d7df3fc";

const validSpec: AnimationSpec = {
  schemaVersion: "animation-spec-1.0.0",
  animationSetId: "ruby_golem",
  targetPackId: "java-fabric-1.21.1-r1",
  targetPackRevision: 1,
  sourceFormat: "bbmodel",
  runtimeFormat: "geckolib",
  rig: {
    type: "humanoid",
    rootBone: "root",
    bones: [
      { id: "root", parent: null, pivot: [0, 0, 0], role: "root" },
      { id: "body", parent: "root", pivot: [0, 8, 0], role: "lead" },
      {
        id: "arm_left",
        parent: "body",
        pivot: [4, 12, 0],
        role: "support",
      },
      {
        id: "arm_right",
        parent: "body",
        pivot: [-4, 12, 0],
        role: "support",
      },
      {
        id: "leg_left",
        parent: "root",
        pivot: [2, 4, 0],
        role: "support",
      },
      {
        id: "leg_right",
        parent: "root",
        pivot: [-2, 4, 0],
        role: "support",
      },
    ],
  },
  clips: [
    {
      id: "idle_loop",
      state: "idle",
      lengthTicks: 20,
      loopMode: "loop",
      rootMotion: { policy: "in_place" },
      keyframes: [
        {
          boneId: "body",
          channel: "rotation",
          timeTick: 0,
          value: [0, 0, 0],
          interpolation: "linear",
        },
        {
          boneId: "body",
          channel: "rotation",
          timeTick: 10,
          value: [0, 2, 0],
          interpolation: "linear",
        },
        {
          boneId: "body",
          channel: "rotation",
          timeTick: 20,
          value: [0, 0, 0],
          interpolation: "linear",
        },
        {
          boneId: "body",
          channel: "position",
          timeTick: 0,
          value: [0, 0, 0],
          interpolation: "linear",
        },
        {
          boneId: "body",
          channel: "position",
          timeTick: 10,
          value: [0, 0.1, 0],
          interpolation: "linear",
        },
        {
          boneId: "body",
          channel: "position",
          timeTick: 20,
          value: [0, 0, 0],
          interpolation: "linear",
        },
        {
          boneId: "body",
          channel: "scale",
          timeTick: 0,
          value: [1, 1, 1],
          interpolation: "step",
        },
        {
          boneId: "body",
          channel: "scale",
          timeTick: 20,
          value: [1, 1, 1],
          interpolation: "step",
        },
        {
          boneId: "leg_left",
          channel: "rotation",
          timeTick: 0,
          value: [5, 0, 0],
          interpolation: "linear",
        },
        {
          boneId: "leg_left",
          channel: "rotation",
          timeTick: 10,
          value: [-5, 0, 0],
          interpolation: "linear",
        },
        {
          boneId: "leg_left",
          channel: "rotation",
          timeTick: 20,
          value: [5, 0, 0],
          interpolation: "linear",
        },
        {
          boneId: "leg_right",
          channel: "rotation",
          timeTick: 0,
          value: [-5, 0, 0],
          interpolation: "linear",
        },
        {
          boneId: "leg_right",
          channel: "rotation",
          timeTick: 10,
          value: [5, 0, 0],
          interpolation: "linear",
        },
        {
          boneId: "leg_right",
          channel: "rotation",
          timeTick: 20,
          value: [-5, 0, 0],
          interpolation: "linear",
        },
      ],
      transitions: [],
      acceptanceRuleIds: [
        "VX-ANIM-001-RIG",
        "VX-ANIM-002-LOOP-SEAM",
        "VX-ANIM-005-STATES",
      ],
    },
  ],
};

const validModel: AnimationModel = {
  sourceFormat: "bbmodel",
  kind: "modded_entity",
  textureWidth: 64,
  textureHeight: 64,
  orientation: {
    front: "-Z",
    ownRight: "+X",
    mirroredBoneIds: [],
  },
  joints: {
    root: [0, 0, 0],
    body: [0, 8, 0],
    arm_left: [4, 12, 0],
    arm_right: [-4, 12, 0],
    leg_left: [2, 4, 0],
    leg_right: [-2, 4, 0],
  },
  textures: [
    {
      id: "main",
      path: "textures/entity/ruby_golem.png",
      sha256: sourceSha256,
    },
  ],
  cubes: [
    {
      id: "body_cube",
      boneId: "body",
      from: [-4, 4, -2],
      to: [4, 12, 2],
      mirrored: false,
      faces: {
        north: { uv: [0, 0, 8, 8], textureId: "main" },
        east: { uv: [8, 0, 12, 8], textureId: "main" },
        south: { uv: [12, 0, 20, 8], textureId: "main" },
        west: { uv: [20, 0, 24, 8], textureId: "main" },
        up: { uv: [0, 8, 8, 12], textureId: "main" },
        down: { uv: [8, 8, 16, 12], textureId: "main" },
      },
    },
  ],
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function atPath(document: JsonObject, path: readonly string[]): JsonObject {
  let parent = document;
  for (const segment of path.slice(0, -1))
    parent = parent[segment] as JsonObject;
  return parent;
}

function setPath(
  document: JsonObject,
  path: readonly string[],
  value: unknown,
): void {
  const parent = atPath(document, path);
  parent[path.at(-1)!] = value;
}

function deletePath(document: JsonObject, path: readonly string[]): void {
  const parent = atPath(document, path);
  delete parent[path.at(-1)!];
}

function changedSpec(path: readonly string[], value?: unknown): JsonObject {
  const document = clone(validSpec) as unknown as JsonObject;
  if (value === undefined) deletePath(document, path);
  else setPath(document, path, value);
  return document;
}

function changedModel(
  path: readonly string[],
  value?: unknown,
): AnimationModel {
  const document = clone(validModel);
  if (value === undefined) deletePath(document as unknown as JsonObject, path);
  else setPath(document as unknown as JsonObject, path, value);
  return document as unknown as AnimationModel;
}

function expectIssue(
  result: ValidationResult | GenerationResult,
  status: string,
  code: string,
): void {
  assert.equal(result.status, status);
  assert.ok(
    result.issues?.some((issue) => issue.code === code),
    `expected ${code}, received ${JSON.stringify(result)}`,
  );
}

function expectFinding(
  result: AnalysisResult,
  code: string,
  ruleId: string,
): Finding {
  assert.equal(result.status, "failed");
  const finding = result.findings.find(
    (candidate) => candidate.code === code && candidate.ruleId === ruleId,
  );
  assert.ok(finding, `expected ${code}, received ${JSON.stringify(result)}`);
  return finding;
}

function lastKeyframe(
  document: JsonObject,
  channel: string,
  boneId = "body",
): JsonObject {
  const clip = (document.clips as JsonObject[])[0]!;
  const keyframes = clip.keyframes as JsonObject[];
  const matches = keyframes.filter(
    (keyframe) => keyframe.boneId === boneId && keyframe.channel === channel,
  );
  return matches.at(-1)!;
}

function generationSpec(): AnimationSpec {
  const spec = clone(validSpec);
  spec.clips[0]!.state = "walk";
  spec.clips[0]!.id = "walk_cycle";
  spec.clips[0]!.keyframes = [];
  spec.clips[0]!.transitions = [{ toState: "attack", durationTicks: 2 }];
  spec.clips.push({
    id: "attack_once",
    state: "attack",
    lengthTicks: 17,
    loopMode: "once",
    rootMotion: { policy: "in_place" },
    keyframes: [],
    transitions: [{ toState: "walk", durationTicks: 2 }],
    acceptanceRuleIds: ["VX-ANIM-003-TRAVEL", "VX-ANIM-004-TRANSITIONS"],
  });
  return spec;
}

async function makeWritableTree(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await makeWritableTree(child);
    await chmod(child, entry.isDirectory() ? 0o755 : 0o644);
  }
  await chmod(path, 0o755);
}

function passedCheck(
  id: string,
  subject: EvidenceCheckSubject,
): EvidenceCheckInput {
  return {
    id,
    requested: true,
    executed: true,
    status: "passed",
    requestedArgv: ["review", id],
    executedArgv: ["review", id],
    exitCode: 0,
    subject,
    logs: [],
  };
}

function markUnexecuted(check: EvidenceCheckInput): void {
  check.executed = false;
  check.status = "unavailable";
  check.executedArgv = null;
  check.exitCode = null;
}

interface ReviewFixture {
  input: AnimationReviewInput;
  options: FinalizeEvidenceOptions;
  directory: string;
}

async function reviewFixture(
  t: TestContext,
  mutate?: (
    options: FinalizeEvidenceOptions,
    input: AnimationReviewInput,
  ) => void,
  overrides: {
    spec?: AnimationSpec;
    model?: AnimationModel;
    requirements?: AnimationReviewInput["requirements"];
  } = {},
): Promise<ReviewFixture> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-animation-review-"));
  t.after(async () => {
    await makeWritableTree(root);
    await rm(root, { recursive: true, force: true });
  });
  const inputRoot = join(root, "input");
  const projectRoot = join(root, "project");
  const evidenceRoot = join(root, "supervisor", "evidence");
  await Promise.all([
    mkdir(inputRoot, { recursive: true }),
    mkdir(projectRoot, { recursive: true }),
  ]);

  const spec = overrides.spec ?? validSpec;
  const model = overrides.model ?? validModel;
  const documents = {
    spec: JSON.stringify(spec),
    source: JSON.stringify(model),
    export: JSON.stringify({
      runtime: spec.runtimeFormat,
      animationSetId: spec.animationSetId,
    }),
    productionJar: "production jar bytes\n",
    baseline: "baseline capture bytes\n",
  };
  const hashes = Object.fromEntries(
    Object.entries(documents).map(([name, content]) => [
      name,
      createHash("sha256").update(content).digest("hex"),
    ]),
  ) as Record<keyof typeof documents, string>;
  await Promise.all(
    Object.entries(documents).map(([name, content]) =>
      writeFile(join(inputRoot, name), content),
    ),
  );

  const checks: EvidenceCheckInput[] = [
    passedCheck("model-source", {
      class: "source",
      surface: "blockbench",
      sourceSha256: hashes.source,
      exportSha256: hashes.export,
    }),
    ...(spec.clips.length === 0
      ? [
          { id: "static-production", state: "static", kind: "state" as const },
          {
            id: "static-multiplayer",
            state: "static",
            kind: "multiplayer" as const,
          },
          {
            id: "static-after-restart",
            state: "static",
            kind: "restart" as const,
          },
        ]
      : [
          { id: "idle-production", state: "idle", kind: "state" as const },
          {
            id: "idle-multiplayer",
            state: "idle",
            kind: "multiplayer" as const,
          },
          { id: "idle-after-restart", state: "idle", kind: "restart" as const },
        ]
    ).map((scenario) =>
      passedCheck(scenario.id, {
        class: "browser",
        surface: "minecraft_client",
        productionJarSha256: hashes.productionJar,
        baselineSha256: hashes.baseline,
        scenario,
      }),
    ),
    passedCheck("design-human", {
      class: "design_review",
      sourceSha256: hashes.source,
      exportSha256: hashes.export,
      reviewer: {
        id: "human-reviewer",
        revision: 1,
        rubric: "silhouette,uv,animation,clipping",
        decision: "approved",
        kind: "human",
      },
    }),
  ];
  const transactionId = "animation-review-01";
  const input: AnimationReviewInput = {
    evidenceRoot,
    transactionId,
    artifacts: {
      spec: hashes.spec,
      source: hashes.source,
      export: hashes.export,
      productionJar: hashes.productionJar,
    },
    requirements: overrides.requirements ?? {
      multiplayer: true,
      persistence: true,
    },
  };
  const options: FinalizeEvidenceOptions = {
    evidenceRoot,
    agentWritableRoots: [projectRoot],
    sourceRoots: [inputRoot],
    transactionId,
    baseProjectSha256: "a".repeat(64),
    modSpecSha256: "b".repeat(64),
    targetPackSha256: "c".repeat(64),
    finalTreeSha256: "d".repeat(64),
    environment: {
      os: "linux",
      arch: "x64",
      productionJar: true,
      cleanInstance: true,
    },
    checks,
    artifacts: Object.keys(documents).map((name) => ({
      name,
      path: join(inputRoot, name),
    })),
    secretValues: [],
  };
  mutate?.(options, input);
  await finalizeEvidence(options);
  return { input, options, directory: join(evidenceRoot, transactionId) };
}

test("accepts the complete AnimationSpec without mutating it", () => {
  const document = clone(validSpec) as unknown as JsonObject;
  const before = clone(document);

  const result = validateAnimationSpec(document) as ValidationResult;

  assert.equal(result.status, "valid");
  assert.deepEqual(result.spec, before);
  assert.deepEqual(document, before);
});

test("requires every typed AnimationSpec, rig, bone, clip, and keyframe field", () => {
  const paths = [
    ["schemaVersion"],
    ["animationSetId"],
    ["targetPackId"],
    ["targetPackRevision"],
    ["sourceFormat"],
    ["runtimeFormat"],
    ["rig"],
    ["clips"],
    ["rig", "type"],
    ["rig", "rootBone"],
    ["rig", "bones"],
    ["rig", "bones", "0", "id"],
    ["rig", "bones", "0", "parent"],
    ["rig", "bones", "0", "pivot"],
    ["rig", "bones", "0", "role"],
    ["clips", "0", "id"],
    ["clips", "0", "state"],
    ["clips", "0", "lengthTicks"],
    ["clips", "0", "loopMode"],
    ["clips", "0", "rootMotion"],
    ["clips", "0", "keyframes"],
    ["clips", "0", "transitions"],
    ["clips", "0", "acceptanceRuleIds"],
    ["clips", "0", "keyframes", "0", "boneId"],
    ["clips", "0", "keyframes", "0", "channel"],
    ["clips", "0", "keyframes", "0", "timeTick"],
    ["clips", "0", "keyframes", "0", "value"],
    ["clips", "0", "keyframes", "0", "interpolation"],
  ];

  for (const path of paths)
    expectIssue(
      validateAnimationSpec(changedSpec(path)),
      "invalid",
      "required",
    );
});

test("rejects unknown fields, script snippets, and exporter command lines", () => {
  const paths = [
    ["unexpected"],
    ["rig", "bones", "0", "unexpected"],
    ["clips", "0", "script"],
    ["clips", "0", "exportCommand"],
    ["clips", "0", "keyframes", "0", "expression"],
  ];

  for (const path of paths) {
    expectIssue(
      validateAnimationSpec(changedSpec(path, "return maliciousValue")),
      "invalid",
      "additional_properties",
    );
  }
});

test("validates identifiers, revisions, tick timing, and finite vectors", () => {
  const cases: Array<{ path: string[]; value: unknown; code: string }> = [
    { path: ["animationSetId"], value: "Ruby Golem", code: "pattern" },
    { path: ["targetPackRevision"], value: 0, code: "minimum" },
    { path: ["targetPackRevision"], value: 1.5, code: "type" },
    { path: ["clips", "0", "lengthTicks"], value: 0, code: "minimum" },
    { path: ["clips", "0", "lengthTicks"], value: 1.5, code: "type" },
    {
      path: ["clips", "0", "keyframes", "0", "timeTick"],
      value: -1,
      code: "minimum",
    },
    {
      path: ["clips", "0", "keyframes", "0", "timeTick"],
      value: 21,
      code: "keyframe_after_clip",
    },
    {
      path: ["clips", "0", "keyframes", "0", "value"],
      value: [0, 0],
      code: "vector_length",
    },
    {
      path: ["clips", "0", "keyframes", "0", "value"],
      value: [0, Number.NaN, 0],
      code: "finite",
    },
    {
      path: ["rig", "bones", "0", "pivot"],
      value: [0, Number.POSITIVE_INFINITY, 0],
      code: "finite",
    },
  ];

  for (const { path, value, code } of cases)
    expectIssue(
      validateAnimationSpec(changedSpec(path, value)),
      "invalid",
      code,
    );
});

test("accepts only the declared source, runtime, rig, role, state, loop, and channel enums", () => {
  const validCases: Array<{ path: string[]; values: readonly unknown[] }> = [
    { path: ["runtimeFormat"], values: ["geckolib", "target_specific"] },
    { path: ["rig", "type"], values: ["humanoid", "quadruped", "custom"] },
    {
      path: ["clips", "0", "state"],
      values: [
        "idle",
        "walk",
        "run",
        "attack",
        "cast",
        "jump",
        "hurt",
        "death",
        "fly",
        "custom",
      ],
    },
    {
      path: ["clips", "0", "keyframes", "0", "channel"],
      values: ["rotation", "position", "scale"],
    },
  ];
  for (const { path, values } of validCases) {
    for (const value of values) {
      const document = changedSpec(path, value);
      if (path.at(-1) === "state" && value === "death")
        setPath(document, ["clips", "0", "loopMode"], "hold_last");
      assert.equal(validateAnimationSpec(document).status, "valid");
    }
  }

  for (const [path, value] of [
    [["rig", "bones", "0", "role"], "root"],
    [["rig", "bones", "1", "role"], "lead"],
    [["rig", "bones", "2", "role"], "support"],
    [["rig", "bones", "2", "role"], "decoration"],
    [["rig", "bones", "2", "role"], "static"],
  ] as const)
    assert.equal(
      validateAnimationSpec(changedSpec(path, value)).status,
      "valid",
    );

  const invalidCases = [
    [["sourceFormat"], "gltf", "unsupported_source_format"],
    [["runtimeFormat"], "java_block", "unsupported_runtime_format"],
    [["rig", "type"], "dragon", "unsupported_rig_type"],
    [["clips", "0", "loopMode"], "ping_pong", "unsupported_loop_mode"],
    [
      ["clips", "0", "keyframes", "0", "channel"],
      "molang",
      "unsupported_channel",
    ],
  ] as const;
  for (const [path, value, code] of invalidCases) {
    expectIssue(
      validateAnimationSpec(changedSpec(path, value)),
      "unsupported_request",
      code,
    );
  }
});

test("accepts all typed interpolation modes but rejects an unknown mode", () => {
  for (const interpolation of ["linear", "step", "catmullrom", "bezier"]) {
    assert.equal(
      validateAnimationSpec(
        changedSpec(
          ["clips", "0", "keyframes", "0", "interpolation"],
          interpolation,
        ),
      ).status,
      "valid",
    );
  }
  expectIssue(
    validateAnimationSpec(
      changedSpec(["clips", "0", "keyframes", "0", "interpolation"], "spring"),
    ),
    "unsupported_request",
    "unsupported_interpolation",
  );
});

test("enforces unique stable bone and clip IDs", () => {
  expectIssue(
    validateAnimationSpec(changedSpec(["rig", "bones", "1", "id"], "root")),
    "invalid",
    "duplicate_id",
  );

  const duplicateClip = clone(validSpec) as unknown as JsonObject;
  const clips = duplicateClip.clips as JsonObject[];
  clips.push(clone(clips[0]!));
  expectIssue(validateAnimationSpec(duplicateClip), "invalid", "duplicate_id");
});

test("resolves the root, parents, keyframes, transitions, and acceptance IDs", () => {
  const cases: Array<{ path: string[]; value: unknown; code: string }> = [
    { path: ["rig", "rootBone"], value: "missing", code: "unknown_bone" },
    {
      path: ["rig", "bones", "1", "parent"],
      value: "missing",
      code: "unknown_bone",
    },
    {
      path: ["clips", "0", "keyframes", "0", "boneId"],
      value: "invented_bone",
      code: "unknown_bone",
    },
    {
      path: ["clips", "0", "acceptanceRuleIds", "0"],
      value: "VX-UNKNOWN",
      code: "unknown_acceptance_rule",
    },
  ];
  for (const { path, value, code } of cases)
    expectIssue(
      validateAnimationSpec(changedSpec(path, value)),
      "invalid",
      code,
    );

  expectIssue(
    validateAnimationSpec(
      changedSpec(
        ["clips", "0", "transitions"],
        [{ toState: "dance", durationTicks: 2 }],
      ),
    ),
    "invalid",
    "unknown_state",
  );
});

test("rejects multiple roots, parent cycles, and multiple lead bones", () => {
  expectIssue(
    validateAnimationSpec(changedSpec(["rig", "bones", "1", "parent"], null)),
    "invalid",
    "root_count",
  );

  const cycle = clone(validSpec) as unknown as JsonObject;
  setPath(cycle, ["rig", "bones", "0", "parent"], "body");
  setPath(cycle, ["rig", "bones", "0", "role"], "support");
  expectIssue(validateAnimationSpec(cycle), "invalid", "parent_cycle");

  expectIssue(
    validateAnimationSpec(changedSpec(["rig", "bones", "2", "role"], "lead")),
    "invalid",
    "lead_count",
  );
});

test("requires terminal state behavior for once and death clips", () => {
  const once = changedSpec(["clips", "0", "loopMode"], "once");
  expectIssue(validateAnimationSpec(once), "invalid", "missing_terminal_state");

  const death = changedSpec(["clips", "0", "state"], "death");
  expectIssue(
    validateAnimationSpec(death),
    "invalid",
    "invalid_death_loop_mode",
  );
  setPath(death, ["clips", "0", "loopMode"], "hold_last");
  assert.equal(validateAnimationSpec(death).status, "valid");
});

test("generation requires an explicit valid seed", () => {
  for (const seed of [Number.NaN, -1, 1.5, "42"] as unknown[]) {
    const request = { spec: generationSpec(), seed } as unknown as Parameters<
      typeof generateAnimation
    >[0];
    expectIssue(
      generateAnimation(request) as GenerationResult,
      "invalid",
      "invalid_seed",
    );
  }
  const missing = { spec: generationSpec() } as unknown as Parameters<
    typeof generateAnimation
  >[0];
  expectIssue(
    generateAnimation(missing) as GenerationResult,
    "invalid",
    "required",
  );
});

test("seeded generation reproduces semantic transforms and records its RNG", () => {
  const spec = generationSpec();
  const before = clone(spec);

  const first = generateAnimation({ spec, seed: 42 }) as GenerationResult;
  const second = generateAnimation({ spec, seed: 42 }) as GenerationResult;
  const different = generateAnimation({ spec, seed: 43 }) as GenerationResult;

  for (const result of [first, second, different]) {
    assert.equal(result.status, "generated");
    assert.match(result.semanticSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.ok((result.spec?.clips[0]?.keyframes.length ?? 0) > 0);
    assert.equal(validateAnimationSpec(result.spec).status, "valid");
    assert.equal(result.provenance?.seedDerivationVersion, 1);
    assert.ok(result.provenance?.rngAlgorithm);
  }
  assert.deepEqual(first.spec, second.spec);
  assert.equal(first.semanticSha256, second.semanticSha256);
  assert.equal(first.provenance?.seed, 42);
  assert.notEqual(first.semanticSha256, different.semanticSha256);
  assert.deepEqual(spec, before);
});

test("loop analysis accepts independently closed position, rotation, and scale poses", () => {
  const result = analyzeAnimation({
    spec: validSpec,
    model: validModel,
  }) as AnalysisResult;

  assert.equal(result.status, "passed", JSON.stringify(result.findings));
  assert.deepEqual(result.findings, []);
  assert.equal(result.metrics?.idle_loop?.rotationDeltaDegrees, 0);
  assert.equal(result.metrics?.idle_loop?.translationDelta, 0);
  assert.equal(result.metrics?.idle_loop?.scaleDelta, 0);
});

test("loop analysis detects planted rotation, translation, and scale seams", () => {
  const cases = [
    {
      channel: "rotation",
      value: [0, 0, 2],
      code: "loop_rotation_delta",
      metric: "rotationDeltaDegrees",
      expected: 2,
    },
    {
      channel: "position",
      value: [0.002, 0, 0],
      code: "loop_translation_delta",
      metric: "translationDelta",
      expected: 0.002,
    },
    {
      channel: "scale",
      value: [1.0002, 1, 1],
      code: "loop_scale_delta",
      metric: "scaleDelta",
      expected: 0.0002,
    },
  ] as const;

  for (const { channel, value, code, metric, expected } of cases) {
    const document = clone(validSpec) as unknown as JsonObject;
    lastKeyframe(document, channel).value = value;
    const result = analyzeAnimation({
      spec: document,
      model: validModel,
    }) as AnalysisResult;

    expectFinding(result, code, "VX-ANIM-002-LOOP-SEAM");
    assert.ok(
      Math.abs((result.metrics?.idle_loop?.[metric] ?? 0) - expected) < 1e-9,
    );
  }
});

test("loop thresholds are inclusive rather than tuned to failing assets", () => {
  for (const [channel, value] of [
    ["rotation", [0.5, 0, 0]],
    ["position", [0.001, 0, 0]],
    ["scale", [1.0001, 1, 1]],
  ] as const) {
    const document = clone(validSpec) as unknown as JsonObject;
    lastKeyframe(document, channel).value = value;
    const result = analyzeAnimation({
      spec: document,
      model: validModel,
    }) as AnalysisResult;
    assert.equal(result.status, "passed", JSON.stringify(result.findings));
  }
});

test("ground travel excludes only the root when its policy explicitly allows it", () => {
  const movingRoot = clone(validSpec) as unknown as JsonObject;
  const clip = (movingRoot.clips as JsonObject[])[0]!;
  (clip.keyframes as JsonObject[]).push(
    {
      boneId: "root",
      channel: "position",
      timeTick: 0,
      value: [0, 0, 0],
      interpolation: "linear",
    },
    {
      boneId: "root",
      channel: "position",
      timeTick: 20,
      value: [1, 0, 0],
      interpolation: "linear",
    },
  );

  const inPlace = analyzeAnimation({
    spec: movingRoot,
    model: validModel,
  }) as AnalysisResult;
  expectFinding(inPlace, "loop_translation_delta", "VX-ANIM-002-LOOP-SEAM");

  setPath(movingRoot, ["clips", "0", "rootMotion", "policy"], "ground_travel");
  const traveling = analyzeAnimation({
    spec: movingRoot,
    model: validModel,
  }) as AnalysisResult;
  assert.equal(traveling.status, "passed", JSON.stringify(traveling.findings));

  lastKeyframe(movingRoot, "position").value = [0.002, 0, 0];
  const movedBody = analyzeAnimation({
    spec: movingRoot,
    model: validModel,
  }) as AnalysisResult;
  expectFinding(movedBody, "loop_translation_delta", "VX-ANIM-002-LOOP-SEAM");
});

test("UV checks reject out-of-bounds, fractional, zero-area, and missing texture faces", () => {
  const cases = [
    { uv: [0, 0, 65, 8], code: "uv_out_of_bounds" },
    { uv: [0.5, 0, 8.5, 8], code: "uv_off_texel_grid" },
    { uv: [0, 0, 0, 8], code: "zero_area_face" },
  ] as const;
  for (const { uv, code } of cases) {
    const result = analyzeAnimation({
      spec: validSpec,
      model: changedModel(["cubes", "0", "faces", "north", "uv"], uv),
    }) as AnalysisResult;
    expectFinding(result, code, "VX-UV-001-BOUNDS");
  }

  const missing = analyzeAnimation({
    spec: validSpec,
    model: changedModel(
      ["cubes", "0", "faces", "north", "textureId"],
      "missing",
    ),
  }) as AnalysisResult;
  expectFinding(missing, "missing_texture", "VX-UV-001-BOUNDS");
});

test("orientation checks require front -Z, own-right +X, and explicit mirroring", () => {
  for (const [path, code] of [
    [["orientation", "front"], "wrong_front_axis"],
    [["orientation", "ownRight"], "wrong_own_right_axis"],
  ] as const) {
    const value = path.at(-1) === "front" ? "+Z" : "-X";
    const result = analyzeAnimation({
      spec: validSpec,
      model: changedModel(path, value),
    }) as AnalysisResult;
    expectFinding(result, code, "VX-UV-002-ORIENTATION");
  }

  const mirrored = changedModel(["cubes", "0", "mirrored"], true);
  const result = analyzeAnimation({
    spec: validSpec,
    model: mirrored,
  }) as AnalysisResult;
  expectFinding(result, "unmarked_mirrored_geometry", "VX-UV-002-ORIENTATION");
});

test("model analysis detects off-joint pivots and detached cube parentage", () => {
  const pivot = analyzeAnimation({
    spec: validSpec,
    model: changedModel(["joints", "arm_left"], [5, 12, 0]),
  }) as AnalysisResult;
  assert.equal(
    expectFinding(pivot, "off_joint_pivot", "VX-ANIM-001-RIG").boneId,
    "arm_left",
  );

  const detached = analyzeAnimation({
    spec: validSpec,
    model: changedModel(["cubes", "0", "boneId"], "missing"),
  }) as AnalysisResult;
  expectFinding(detached, "unknown_cube_bone", "VX-MDL-002-DEGENERATE");
});

test("model analysis rejects zero-size cubes and unapproved coplanar faces", () => {
  const degenerate = analyzeAnimation({
    spec: validSpec,
    model: changedModel(["cubes", "0", "to"], [-4, 12, 2]),
  }) as AnalysisResult;
  expectFinding(degenerate, "zero_size_cube", "VX-MDL-002-DEGENERATE");

  const zFight = clone(validModel);
  const cubes: AnimationModel["cubes"] = zFight.cubes;
  const duplicate = clone(cubes[0]!);
  duplicate.id = "zfight_cube";
  cubes.push(duplicate);
  const result = analyzeAnimation({
    spec: validSpec,
    model: zFight,
  }) as AnalysisResult;
  expectFinding(result, "coplanar_overlap", "VX-ZF-001-COPLANAR");
});

test("malformed nested cubes and textures return invalid findings without throwing", () => {
  for (const field of ["cubes", "textures"] as const) {
    const model = clone(validModel) as unknown as JsonObject;
    model[field] = [null];
    let result: AnalysisResult | undefined;

    assert.doesNotThrow(() => {
      result = analyzeAnimation({
        spec: validSpec,
        model: model as unknown as AnimationModel,
      }) as AnalysisResult;
    });

    assert.ok(result);
    assert.equal(result.status, "failed");
    const finding = result.findings.find(
      (candidate) => candidate.path === `$.${field}.0`,
    );
    assert.ok(finding, JSON.stringify(result));
    assert.match(finding.code, /^invalid_/);
    assert.equal(finding.ruleId, "VX-MDL-002-DEGENERATE");
  }
});

test("capability limitations are unavailable and unchecked, never passes", () => {
  for (const feature of ["particles", "molang"] as const) {
    const result = validateAnimationSpec(validSpec, {
      requestedFeatures: [feature],
      capabilities:
        feature === "particles" ? { particles: false } : { molang: false },
    }) as ValidationResult;

    expectIssue(result, "unavailable", `${feature}_unavailable`);
    assert.deepEqual(result.checks, [
      { checked: false, status: "unavailable" },
    ]);
  }

  const bezier = changedSpec(
    ["clips", "0", "keyframes", "0", "interpolation"],
    "bezier",
  );
  const result = validateAnimationSpec(bezier, {
    capabilities: { bezier: false },
  }) as ValidationResult;
  expectIssue(result, "unavailable", "bezier_unavailable");
  assert.deepEqual(result.checks, [{ checked: false, status: "unavailable" }]);
});

function javaSpec(): AnimationSpec {
  const spec = clone(validSpec);
  spec.runtimeFormat = "target_specific";
  spec.clips = [];
  return spec;
}

function javaModel(kind: "java_block" | "java_item"): AnimationModel {
  const model = clone(validModel);
  return {
    sourceFormat: "bbmodel",
    kind,
    textureWidth: model.textureWidth,
    textureHeight: model.textureHeight,
    orientation: model.orientation,
    joints: model.joints,
    textures: model.textures,
    cubes: model.cubes,
  };
}

for (const kind of ["java_block", "java_item"] as const) {
  test(`exports static ${kind} JSON without inventing bone animation`, () => {
    const result = exportAnimation({
      spec: javaSpec(),
      model: javaModel(kind),
      format: kind,
    }) as ExportResult;

    assert.equal(result.status, "exported");
    const modelFile = result.files.find((file) => file.kind === "java_model");
    assert.ok(modelFile);
    assert.ok(result.files.some((file) => file.kind === "editable_source"));
    assert.ok(!result.files.some((file) => file.kind === "animation"));

    const runtime = JSON.parse(modelFile.content) as {
      textures: Record<string, string>;
      elements: Array<{
        from: number[];
        to: number[];
        faces: Record<string, { texture: string; uv: number[] }>;
      }>;
    };
    assert.ok(!Array.isArray(runtime.textures));
    assert.deepEqual(Object.keys(runtime.textures), ["main"]);
    for (const reference of Object.values(runtime.textures)) {
      assert.equal(typeof reference, "string");
      assert.ok(reference.length > 0);
    }
    assert.equal(runtime.elements.length, 1);
    const element = runtime.elements[0]!;
    assert.deepEqual(element.from, validModel.cubes[0]!.from);
    assert.deepEqual(element.to, validModel.cubes[0]!.to);
    assert.ok(!("boneId" in element));
    assert.ok(!("mirrored" in element));
    assert.ok(!("textures" in element));
    assert.ok(!("boneId" in runtime));
    assert.ok(!("mirrored" in runtime));
    for (const [faceName, face] of Object.entries(element.faces)) {
      assert.match(face.texture, /^#[a-z][a-z0-9_]*$/);
      const textureId = face.texture.slice(1);
      assert.ok(textureId in runtime.textures);
      assert.equal(face.texture, "#main");
      assert.deepEqual(face.uv, validModel.cubes[0]!.faces[faceName]!.uv);
    }

    const reimportFaces = (value: typeof runtime) =>
      Object.fromEntries(
        Object.entries(value.elements[0]!.faces).map(([name, face]) => [
          name,
          { texture: face.texture, uv: face.uv },
        ]),
      );
    const expectedFaces = Object.fromEntries(
      Object.entries(validModel.cubes[0]!.faces).map(([name, face]) => [
        name,
        { texture: "#main", uv: face.uv },
      ]),
    );
    assert.deepEqual(reimportFaces(runtime), expectedFaces);
    const alteredRuntime = structuredClone(runtime);
    alteredRuntime.elements[0]!.faces.north!.uv[0] =
      alteredRuntime.elements[0]!.faces.north!.uv[0]! + 1;
    assert.notDeepEqual(reimportFaces(alteredRuntime), expectedFaces);
    assert.deepEqual(result.roundTripDiff, []);
  });
}

test("Java texture lookup rejects prototype names unless explicitly declared", () => {
  for (const textureId of ["constructor", "toString"]) {
    const missing = javaModel("java_block");
    missing.cubes[0]!.faces.north!.textureId = textureId;
    const rejected = exportAnimation({
      spec: javaSpec(),
      model: missing,
      format: "java_block",
    }) as ExportResult;
    assert.notEqual(rejected.status, "exported");
    assert.deepEqual(rejected.files, []);

    const declared = javaModel("java_block");
    declared.textures.push({
      id: textureId,
      path: `textures/${textureId}.png`,
      sha256: sourceSha256,
    });
    declared.cubes[0]!.faces.north!.textureId = textureId;
    const accepted = exportAnimation({
      spec: javaSpec(),
      model: declared,
      format: "java_block",
    }) as ExportResult;
    assert.equal(accepted.status, "exported");
    const file = accepted.files.find(
      (candidate) => candidate.kind === "java_model",
    );
    assert.ok(file);
    const runtime = JSON.parse(file.content) as {
      textures: Record<string, string>;
      elements: Array<{ faces: Record<string, { texture: string }> }>;
    };
    assert.ok(Object.hasOwn(runtime.textures, textureId));
    assert.equal(runtime.elements[0]?.faces.north?.texture, `#${textureId}`);
  }
});

test("exports Modded Entity geometry and clips with a clean editable round trip", () => {
  const result = exportAnimation({
    spec: validSpec,
    model: validModel,
    format: "modded_entity",
  }) as ExportResult;

  assert.equal(result.status, "exported");
  assert.ok(result.files.some((file) => file.kind === "geometry"));
  assert.ok(result.files.some((file) => file.kind === "animation"));
  assert.ok(result.files.some((file) => file.kind === "editable_source"));
  assert.deepEqual(result.roundTripDiff, []);
});

test("round-trip evidence reparses runtime bytes and compares semantic content", () => {
  const result = exportAnimation({
    spec: validSpec,
    model: validModel,
    format: "modded_entity",
  }) as ExportResult;

  assert.equal(result.status, "exported");
  const geometryFile = result.files.find((file) => file.kind === "geometry");
  const animationFile = result.files.find((file) => file.kind === "animation");
  const editableFile = result.files.find(
    (file) => file.kind === "editable_source",
  );
  assert.ok(geometryFile);
  assert.ok(animationFile);
  assert.ok(editableFile);

  const geometry = JSON.parse(geometryFile.content) as {
    format_version: string;
    "minecraft:geometry": Array<{
      description: {
        identifier: string;
        texture_width: number;
        texture_height: number;
      };
      bones: Array<{
        name: string;
        parent?: string;
        pivot: number[];
        cubes?: Array<{
          origin: number[];
          size: number[];
          uv: Record<string, { uv: number[]; uv_size: number[] }>;
        }>;
      }>;
    }>;
  };
  const animation = JSON.parse(animationFile.content) as {
    format_version: string;
    animations: Record<
      string,
      {
        animation_length: number;
        loop: boolean | "hold_on_last_frame";
        bones: Record<string, Record<string, Record<string, number[]>>>;
      }
    >;
  };
  const editable = JSON.parse(editableFile.content) as {
    model: AnimationModel;
    spec: AnimationSpec;
  };

  assert.equal(geometry.format_version, "1.12.0");
  assert.ok(!("model" in geometry));
  assert.equal(geometry["minecraft:geometry"].length, 1);
  const runtimeGeometry = geometry["minecraft:geometry"][0]!;
  assert.equal(runtimeGeometry.description.texture_width, 64);
  assert.equal(runtimeGeometry.description.texture_height, 64);
  assert.ok(runtimeGeometry.description.identifier.length > 0);
  assert.equal(runtimeGeometry.bones.length, validSpec.rig.bones.length);
  const runtimeBones = new Map(
    runtimeGeometry.bones.map((bone) => [bone.name, bone]),
  );
  for (const bone of validSpec.rig.bones) {
    const runtimeBone = runtimeBones.get(bone.id);
    assert.ok(runtimeBone, `missing runtime bone ${bone.id}`);
    assert.deepEqual(runtimeBone.pivot, bone.pivot);
    if (bone.parent === null) assert.equal(runtimeBone.parent, undefined);
    else assert.equal(runtimeBone.parent, bone.parent);
  }
  const bodyCube = runtimeBones.get("body")?.cubes?.[0];
  assert.ok(bodyCube);
  assert.deepEqual(bodyCube.origin, validModel.cubes[0]!.from);
  assert.deepEqual(bodyCube.size, [8, 8, 4]);
  for (const [faceName, face] of Object.entries(bodyCube.uv)) {
    const sourceUv = validModel.cubes[0]!.faces[faceName]!.uv;
    assert.deepEqual(face.uv, sourceUv.slice(0, 2));
    assert.deepEqual(face.uv_size, [
      sourceUv[2] - sourceUv[0],
      sourceUv[3] - sourceUv[1],
    ]);
  }

  assert.equal(animation.format_version, "1.8.0");
  assert.deepEqual(Object.keys(animation.animations), ["idle_loop"]);
  const runtimeClip = animation.animations.idle_loop!;
  assert.equal(runtimeClip.animation_length, 1);
  assert.equal(runtimeClip.loop, true);
  const bodyChannels = runtimeClip.bones.body;
  assert.ok(bodyChannels);
  const bodyRotation = bodyChannels.rotation;
  const bodyPosition = bodyChannels.position;
  assert.ok(bodyRotation);
  assert.ok(bodyPosition);
  assert.deepEqual(bodyRotation["0"], [0, 0, 0]);
  assert.deepEqual(bodyRotation["0.5"], [0, 2, 0]);
  assert.deepEqual(bodyRotation["1"], [0, 0, 0]);
  assert.deepEqual(bodyPosition["0.5"], [0, 0.1, 0]);
  assert.equal(bodyRotation["20"], undefined);
  assert.deepEqual(editable.model, validModel);
  assert.deepEqual(editable.spec, validSpec);
  assert.deepEqual(result.roundTripDiff, []);
  assert.deepEqual(result.roundTrip, {
    checked: true,
    status: "passed",
    compared: {
      cubes: 1,
      bones: 6,
      pivots: 6,
      uvFaces: 6,
      materials: 1,
      clipNames: ["idle_loop"],
    },
    normalized: {
      model: validModel,
      spec: validSpec,
    },
  });
  assert.deepEqual(result.checks, [
    {
      id: "file_serialization",
      path: geometryFile.path,
      checked: true,
      status: "passed",
      sha256: geometryFile.sha256,
    },
    {
      id: "file_serialization",
      path: animationFile.path,
      checked: true,
      status: "passed",
      sha256: animationFile.sha256,
    },
    {
      id: "file_serialization",
      path: editableFile.path,
      checked: true,
      status: "passed",
      sha256: editableFile.sha256,
    },
    {
      id: "schema_validation",
      path: geometryFile.path,
      checked: true,
      status: "passed",
      schema: "geckolib.geometry.1.12.0",
    },
    {
      id: "schema_validation",
      path: animationFile.path,
      checked: true,
      status: "passed",
      schema: "geckolib.animation.1.8.0",
    },
    {
      id: "round_trip_reimport",
      path: geometryFile.path,
      checked: true,
      status: "passed",
    },
    {
      id: "round_trip_reimport",
      path: animationFile.path,
      checked: true,
      status: "passed",
    },
    {
      id: "round_trip_reimport",
      path: editableFile.path,
      checked: true,
      status: "passed",
    },
    {
      id: "runtime_honesty",
      checked: true,
      status: "passed",
      surface: "target_runtime_json",
    },
  ]);
});

test("exports GeckoLib loop policies without confusing ticks and seconds", () => {
  for (const [loopMode, expected] of [
    ["loop", true],
    ["once", false],
    ["hold_last", "hold_on_last_frame"],
  ] as const) {
    const spec = clone(validSpec);
    spec.clips[0]!.loopMode = loopMode;
    if (loopMode === "once")
      spec.clips[0]!.transitions = [{ toState: "idle", durationTicks: 1 }];

    const result = exportAnimation({
      spec,
      model: validModel,
      format: "modded_entity",
    }) as ExportResult;
    assert.equal(result.status, "exported");
    const file = result.files.find(
      (candidate) => candidate.kind === "animation",
    );
    assert.ok(file);
    const runtime = JSON.parse(file.content) as {
      animations: Record<
        string,
        { animation_length: number; loop: boolean | "hold_on_last_frame" }
      >;
    };
    assert.equal(runtime.animations.idle_loop?.animation_length, 1);
    assert.equal(runtime.animations.idle_loop?.loop, expected);
  }
});

test("rejects malformed model dimensions, UVs, and keyframe timestamps without honesty passes", () => {
  const cases = [
    {
      name: "missing texture dimensions",
      spec: validSpec,
      model: changedModel(["textureWidth"]),
    },
    {
      name: "invalid UV shape",
      spec: validSpec,
      model: changedModel(["cubes", "0", "faces", "north", "uv"], [0, 0, 8]),
    },
    {
      name: "invalid keyframe timestamp",
      spec: changedSpec(["clips", "0", "keyframes", "0", "timeTick"], 1.5),
      model: validModel,
    },
  ];

  for (const { name, spec, model } of cases) {
    const result = exportAnimation({
      spec,
      model,
      format: "modded_entity",
    }) as ExportResult;
    assert.notEqual(result.status, "exported", name);
    assert.deepEqual(result.files, [], name);
    assert.notEqual(result.roundTrip?.status, "passed", name);
    assert.ok(
      !result.checks?.some(
        (check) => check.id === "runtime_honesty" && check.status === "passed",
      ),
      name,
    );
  }
});

test("refuses Bezier export without real control points", () => {
  const spec = changedSpec(
    ["clips", "0", "keyframes", "0", "interpolation"],
    "bezier",
  );
  const result = exportAnimation({
    spec,
    model: validModel,
    format: "modded_entity",
  }) as ExportResult;

  assert.notEqual(result.status, "exported");
  assert.equal(result.code, "bezier_control_points_required");
  assert.deepEqual(result.files, []);
  assert.notEqual(result.roundTrip?.status, "passed");
  assert.ok(
    !result.checks?.some(
      (check) => check.id === "runtime_honesty" && check.status === "passed",
    ),
  );
});

test("never substitutes Java Block/Item and Modded Entity exports", () => {
  for (const format of ["java_block", "java_item"] as const) {
    const result = exportAnimation({
      spec: validSpec,
      model: javaModel(format),
      format,
    }) as ExportResult;
    assert.equal(result.status, "unsupported");
    assert.equal(result.code, "java_bone_animation_unsupported");
    assert.deepEqual(result.files, []);
  }

  const mismatch = exportAnimation({
    spec: javaSpec(),
    model: javaModel("java_block"),
    format: "modded_entity",
  }) as ExportResult;
  assert.equal(mismatch.status, "unsupported");
  assert.equal(mismatch.code, "model_format_mismatch");
  assert.deepEqual(mismatch.files, []);
});

test("authenticated model, production-client, and human evidence closes acceptance", async (t) => {
  const fixture = await reviewFixture(t);
  const result = (await reviewAnimation(fixture.input)) as ReviewResult;

  assert.equal(result.status, "passed");
  assert.ok(
    result.checks?.every((check) => check.checked && check.status === "passed"),
  );
});

test("Blockbench or Blender evidence cannot replace the real Minecraft client", async (t) => {
  for (const surface of ["blockbench", "blender"] as const) {
    const fixture = await reviewFixture(t, (options, input) => {
      for (const check of options.checks) {
        if (check.subject.class !== "browser") continue;
        check.subject.surface = surface;
        check.subject.sourceSha256 = input.artifacts.source;
        check.subject.exportSha256 = input.artifacts.export;
      }
    });
    const result = (await reviewAnimation(fixture.input)) as ReviewResult;

    assert.equal(result.status, "unavailable");
    assert.equal(result.code, "minecraft_client_required");
    assert.notEqual(result.status, "passed");
  }
});

test("Blockbench and Blender source surfaces satisfy actual model review", async (t) => {
  for (const surface of ["blockbench", "blender"] as const) {
    const fixture = await reviewFixture(t, (options) => {
      const check = options.checks.find(
        (candidate) => candidate.id === "model-source",
      );
      assert.ok(check);
      check.subject.surface = surface;
    });
    const result = (await reviewAnimation(fixture.input)) as ReviewResult;
    assert.equal(result.status, "passed");
  }
});

test("source-only or non-preview surfaces cannot satisfy actual model review", async (t) => {
  for (const surface of [undefined, "minecraft_client"] as const) {
    const fixture = await reviewFixture(t, (options) => {
      const check = options.checks.find(
        (candidate) => candidate.id === "model-source",
      );
      assert.ok(check);
      if (surface === undefined) delete check.subject.surface;
      else check.subject.surface = surface;
    });
    const result = (await reviewAnimation(fixture.input)) as ReviewResult;

    assert.equal(result.status, "unavailable");
    assert.equal(result.code, "model_review_required");
  }
});

test("an executed editable-model review is required before approval", async (t) => {
  const fixture = await reviewFixture(t, (options) => {
    const check = options.checks.find(
      (candidate) => candidate.id === "model-source",
    );
    assert.ok(check);
    markUnexecuted(check);
  });
  const result = (await reviewAnimation(fixture.input)) as ReviewResult;

  assert.equal(result.status, "unavailable");
  assert.equal(result.code, "model_review_required");
});

test("the exact production JAR and clean instance are mandatory", async (t) => {
  const wrongJar = await reviewFixture(t);
  wrongJar.input.artifacts.productionJar = "0".repeat(64);
  const mismatched = (await reviewAnimation(wrongJar.input)) as ReviewResult;
  assert.equal(mismatched.status, "unavailable");
  assert.equal(mismatched.code, "artifact_required");

  const wrongClientDigest = await reviewFixture(t, (options) => {
    for (const check of options.checks) {
      if (check.subject.class === "browser")
        check.subject.productionJarSha256 = "0".repeat(64);
    }
  });
  const rejectedDigest = (await reviewAnimation(
    wrongClientDigest.input,
  )) as ReviewResult;
  assert.equal(rejectedDigest.status, "unavailable");
  assert.equal(rejectedDigest.code, "production_jar_required");

  const dirty = await reviewFixture(t, (options) => {
    options.environment.cleanInstance = false;
  });
  const result = (await reviewAnimation(dirty.input)) as ReviewResult;
  assert.equal(result.status, "unavailable");
  assert.equal(result.code, "production_jar_required");
});

test("empty-clip Java specs require executed static, multiplayer, and restart evidence", async (t) => {
  const overrides = {
    spec: javaSpec(),
    model: javaModel("java_block"),
  };
  const valid = await reviewFixture(t, undefined, overrides);
  assert.equal(
    ((await reviewAnimation(valid.input)) as ReviewResult).status,
    "passed",
  );

  for (const removedId of [
    "static-production",
    "static-multiplayer",
    "static-after-restart",
  ]) {
    const fixture = await reviewFixture(
      t,
      (options) => {
        options.checks = options.checks.filter(
          (check) => check.id !== removedId,
        );
      },
      overrides,
    );
    const result = (await reviewAnimation(fixture.input)) as ReviewResult;
    assert.equal(result.status, "failed");
    assert.equal(result.code, "missing_state_evidence");
  }

  const unexecuted = await reviewFixture(
    t,
    (options) => {
      const check = options.checks.find(
        (candidate) => candidate.id === "static-production",
      );
      assert.ok(check);
      markUnexecuted(check);
    },
    overrides,
  );
  const result = (await reviewAnimation(unexecuted.input)) as ReviewResult;
  assert.notEqual(result.status, "passed");
  assert.equal(result.status, "failed");
  assert.equal(result.code, "invalid_evidence_status");
});

test("every declared state, multiplayer observer, and restart requires client evidence", async (t) => {
  for (const removedId of [
    "idle-production",
    "idle-multiplayer",
    "idle-after-restart",
  ]) {
    const fixture = await reviewFixture(t, (options) => {
      options.checks = options.checks.filter((check) => check.id !== removedId);
    });
    const result = (await reviewAnimation(fixture.input)) as ReviewResult;

    assert.equal(result.status, "failed");
    assert.equal(result.code, "missing_state_evidence");
  }
});

test("an unexecuted scenario cannot satisfy a required state", async (t) => {
  const fixture = await reviewFixture(t, (options) => {
    const check = options.checks.find(
      (candidate) => candidate.id === "idle-production",
    );
    assert.ok(check);
    markUnexecuted(check);
  });
  const result = (await reviewAnimation(fixture.input)) as ReviewResult;

  assert.equal(result.status, "failed");
  assert.equal(result.code, "invalid_evidence_status");
});

test("a stand-in reviewer cannot approve design evidence", async (t) => {
  const fixture = await reviewFixture(t, (options) => {
    const check = options.checks.find(
      (candidate) => candidate.id === "design-human",
    );
    assert.ok(check);
    check.status = "failed";
    check.exitCode = 1;
    assert.ok(check.subject.reviewer);
    check.subject.reviewer.kind = "stand_in";
  });
  const result = (await reviewAnimation(fixture.input)) as ReviewResult;

  assert.equal(result.status, "unavailable");
  assert.equal(result.code, "design_review_required");
});

test("an unexecuted numeric diff cannot replace independent human design review", async (t) => {
  const fixture = await reviewFixture(t, (options) => {
    const check = options.checks.find(
      (candidate) => candidate.id === "design-human",
    );
    assert.ok(check);
    markUnexecuted(check);
    (check.subject as unknown as JsonObject).pixelmatch = {
      differentPixels: 0,
    };
  });
  const result = (await reviewAnimation(fixture.input)) as ReviewResult;

  assert.equal(result.status, "unavailable");
  assert.equal(result.code, "design_review_required");
});

test("source or export changes invalidate authenticated approvals", async (t) => {
  for (const checkId of ["model-source", "design-human"]) {
    const fixture = await reviewFixture(t, (options) => {
      const check = options.checks.find(
        (candidate) => candidate.id === checkId,
      );
      assert.ok(check);
      check.subject.exportSha256 = sourceSha256;
    });
    const result = (await reviewAnimation(fixture.input)) as ReviewResult;

    assert.equal(result.status, "failed");
    assert.equal(result.code, "stale_review");
  }
});

test("tampered finalized evidence is rejected before review", async (t) => {
  const fixture = await reviewFixture(t);
  const resultPath = join(fixture.directory, "result.json");
  await chmod(resultPath, 0o644);
  const manifest = JSON.parse(await readFile(resultPath, "utf8")) as JsonObject;
  manifest.environment = { cleanInstance: false };
  await writeFile(resultPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(reviewAnimation(fixture.input), {
    code: "evidence_integrity",
  });
});
