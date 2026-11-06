import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { readEvidence } from "../verification/evidence.ts";
import type {
  EvidenceCheck,
  EvidenceManifest,
} from "../verification/evidence.ts";
import { canonicalJson, sha256 } from "../targets/canonical-json.ts";

export type Vector3 = [number, number, number];
export type AnimationChannel = "position" | "rotation" | "scale";
export type AnimationFormat = "java_block" | "java_item" | "modded_entity";

export interface AnimationKeyframe {
  boneId: string;
  channel: AnimationChannel;
  timeTick: number;
  value: Vector3;
  interpolation: "linear" | "step" | "catmullrom" | "bezier";
}

export interface AnimationClip {
  id: string;
  state:
    | "idle"
    | "walk"
    | "run"
    | "attack"
    | "cast"
    | "jump"
    | "hurt"
    | "death"
    | "fly"
    | "custom";
  lengthTicks: number;
  loopMode: "once" | "loop" | "hold_last";
  rootMotion: { policy: "in_place" | "ground_travel" };
  keyframes: AnimationKeyframe[];
  transitions: Array<{ toState: string; durationTicks: number }>;
  acceptanceRuleIds: string[];
}

export interface AnimationSpec {
  schemaVersion: "animation-spec-1.0.0";
  animationSetId: string;
  targetPackId: string;
  targetPackRevision: number;
  sourceFormat: "bbmodel";
  runtimeFormat: "geckolib" | "target_specific";
  rig: {
    type: "humanoid" | "quadruped" | "custom";
    rootBone: string;
    bones: Array<{
      id: string;
      parent: string | null;
      pivot: Vector3;
      role: "root" | "lead" | "support" | "decoration" | "static";
    }>;
  };
  clips: AnimationClip[];
}

export interface AnimationModelFace {
  uv: [number, number, number, number];
  textureId: string;
}

export interface AnimationModelCube {
  id: string;
  boneId: string;
  from: Vector3;
  to: Vector3;
  mirrored: boolean;
  faces: Record<string, AnimationModelFace>;
}

export interface AnimationModel {
  sourceFormat: "bbmodel";
  kind: AnimationFormat;
  textureWidth: number;
  textureHeight: number;
  orientation: { front: string; ownRight: string; mirroredBoneIds: string[] };
  joints: Record<string, Vector3>;
  textures: Array<{ id: string; path: string; sha256: string }>;
  cubes: AnimationModelCube[];
}

export interface AnimationReviewInput {
  evidenceRoot: string;
  transactionId: string;
  artifacts: {
    spec: string;
    source: string;
    export: string;
    productionJar: string;
  };
  requirements: { multiplayer: boolean; persistence: boolean };
}

type Issue = { code: string; path: string };
type ValidationResult =
  | { status: "valid"; spec: AnimationSpec; issues: [] }
  | { status: "invalid" | "unsupported_request"; issues: Issue[] }
  | {
      status: "unavailable";
      issues: Issue[];
      checks: Array<{ checked: false; status: "unavailable" }>;
    };

const ACCEPTANCE_RULES: Record<string, true> = {
  "VX-ANIM-001-RIG": true,
  "VX-ANIM-002-LOOP-SEAM": true,
  "VX-ANIM-003-TRAVEL": true,
  "VX-ANIM-004-TRANSITIONS": true,
  "VX-ANIM-005-STATES": true,
  "VX-UV-001-BOUNDS": true,
  "VX-UV-002-ORIENTATION": true,
  "VX-UV-003-DISTORTION": true,
  "VX-MDL-001-ROUNDTRIP": true,
  "VX-MDL-002-DEGENERATE": true,
  "VX-CLIP-001-GROUND-SELF": true,
  "VX-ZF-001-COPLANAR": true,
};
const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const STATES: Record<string, true> = Object.fromEntries(
  [
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
  ].map((value) => [value, true]),
);
const ROLES: Record<string, true> = Object.fromEntries(
  ["root", "lead", "support", "decoration", "static"].map((value) => [
    value,
    true,
  ]),
);
const CHANNELS: Record<string, true> = {
  position: true,
  rotation: true,
  scale: true,
};
const INTERPOLATIONS: Record<string, true> = {
  linear: true,
  step: true,
  catmullrom: true,
  bezier: true,
};

function exactKeys(
  value: unknown,
  keys: readonly string[],
  path: string,
  issues: Issue[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issues.push({ code: "type", path });
    return false;
  }
  let valid = true;
  for (const key of keys) {
    if (!(key in value)) {
      issues.push({ code: "required", path: `${path}.${key}` });
      valid = false;
    }
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      issues.push({ code: "additional_properties", path: `${path}.${key}` });
      valid = false;
    }
  }
  return valid;
}

function vector(
  value: unknown,
  path: string,
  issues: Issue[],
): value is Vector3 {
  if (!Array.isArray(value) || value.length !== 3) {
    issues.push({ code: "vector_length", path });
    return false;
  }
  let valid = true;
  for (const component of value) {
    if (typeof component !== "number") {
      issues.push({ code: "type", path });
      valid = false;
    } else if (!Number.isFinite(component)) {
      issues.push({ code: "finite", path });
      valid = false;
    }
  }
  return valid;
}

function integer(
  value: unknown,
  path: string,
  minimum: number,
  issues: Issue[],
): value is number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    issues.push({ code: "type", path });
    return false;
  }
  if (value < minimum) {
    issues.push({ code: "minimum", path });
    return false;
  }
  return true;
}

export interface AnimationValidationOptions {
  requestedFeatures?: Array<"particles" | "molang">;
  capabilities?: { particles?: boolean; molang?: boolean; bezier?: boolean };
}

export function validateAnimationSpec(
  input: unknown,
  options: AnimationValidationOptions = {},
): ValidationResult {
  const issues: Issue[] = [];
  if (
    !exactKeys(
      input,
      [
        "schemaVersion",
        "animationSetId",
        "targetPackId",
        "targetPackRevision",
        "sourceFormat",
        "runtimeFormat",
        "rig",
        "clips",
      ],
      "$",
      issues,
    )
  )
    return { status: "invalid", issues };

  if (input.schemaVersion !== "animation-spec-1.0.0")
    issues.push({ code: "schema_version", path: "$.schemaVersion" });
  if (
    typeof input.animationSetId !== "string" ||
    !IDENTIFIER.test(input.animationSetId)
  )
    issues.push({ code: "pattern", path: "$.animationSetId" });
  if (typeof input.targetPackId !== "string" || input.targetPackId.length === 0)
    issues.push({ code: "pattern", path: "$.targetPackId" });
  integer(input.targetPackRevision, "$.targetPackRevision", 1, issues);
  if (input.sourceFormat !== "bbmodel")
    issues.push({ code: "unsupported_source_format", path: "$.sourceFormat" });
  if (
    input.runtimeFormat !== "geckolib" &&
    input.runtimeFormat !== "target_specific"
  )
    issues.push({
      code: "unsupported_runtime_format",
      path: "$.runtimeFormat",
    });

  const boneIds = new Set<string>();
  const states = new Set<string>();
  let leadCount = 0;
  let rootCount = 0;
  if (exactKeys(input.rig, ["type", "rootBone", "bones"], "$.rig", issues)) {
    const rig = input.rig;
    if (
      rig.type !== "humanoid" &&
      rig.type !== "quadruped" &&
      rig.type !== "custom"
    )
      issues.push({ code: "unsupported_rig_type", path: "$.rig.type" });
    if (typeof rig.rootBone !== "string" || !IDENTIFIER.test(rig.rootBone))
      issues.push({ code: "pattern", path: "$.rig.rootBone" });
    if (!Array.isArray(rig.bones))
      issues.push({ code: "type", path: "$.rig.bones" });
    else {
      for (const [index, bone] of rig.bones.entries()) {
        const path = `$.rig.bones.${index}`;
        if (!exactKeys(bone, ["id", "parent", "pivot", "role"], path, issues))
          continue;
        if (typeof bone.id !== "string" || !IDENTIFIER.test(bone.id))
          issues.push({ code: "pattern", path: `${path}.id` });
        else if (boneIds.has(bone.id))
          issues.push({ code: "duplicate_id", path: `${path}.id` });
        else boneIds.add(bone.id);
        if (
          bone.parent !== null &&
          (typeof bone.parent !== "string" || !IDENTIFIER.test(bone.parent))
        )
          issues.push({ code: "pattern", path: `${path}.parent` });
        if (bone.parent === null) rootCount++;
        vector(bone.pivot, `${path}.pivot`, issues);
        if (typeof bone.role !== "string" || ROLES[bone.role] !== true)
          issues.push({ code: "enum", path: `${path}.role` });
        if (bone.role === "lead") leadCount++;
      }
      const bones = rig.bones.filter(
        (bone): bone is Record<string, unknown> =>
          bone !== null && typeof bone === "object" && !Array.isArray(bone),
      );
      if (typeof rig.rootBone === "string" && !boneIds.has(rig.rootBone))
        issues.push({ code: "unknown_bone", path: "$.rig.rootBone" });
      for (const [index, bone] of bones.entries()) {
        if (
          bone.parent !== null &&
          typeof bone.parent === "string" &&
          !boneIds.has(bone.parent)
        )
          issues.push({
            code: "unknown_bone",
            path: `$.rig.bones.${index}.parent`,
          });
      }
      if (rootCount !== 1)
        issues.push({ code: "root_count", path: "$.rig.bones" });
      if (leadCount > 1)
        issues.push({ code: "lead_count", path: "$.rig.bones" });
      const parents = new Map(bones.map((bone) => [bone.id, bone.parent]));
      for (const id of boneIds) {
        const visited = new Set<string>();
        let current: unknown = id;
        while (typeof current === "string") {
          if (visited.has(current)) {
            issues.push({ code: "parent_cycle", path: "$.rig.bones" });
            break;
          }
          visited.add(current);
          current = parents.get(current);
        }
      }
    }
  }

  const clipIds = new Set<string>();
  if (!Array.isArray(input.clips))
    issues.push({ code: "type", path: "$.clips" });
  else
    for (const [index, clip] of input.clips.entries()) {
      const path = `$.clips.${index}`;
      if (
        !exactKeys(
          clip,
          [
            "id",
            "state",
            "lengthTicks",
            "loopMode",
            "rootMotion",
            "keyframes",
            "transitions",
            "acceptanceRuleIds",
          ],
          path,
          issues,
        )
      )
        continue;
      if (typeof clip.id !== "string" || !IDENTIFIER.test(clip.id))
        issues.push({ code: "pattern", path: `${path}.id` });
      else if (clipIds.has(clip.id))
        issues.push({ code: "duplicate_id", path: `${path}.id` });
      else clipIds.add(clip.id);
      if (typeof clip.state !== "string" || STATES[clip.state] !== true)
        issues.push({ code: "enum", path: `${path}.state` });
      else states.add(clip.state);
      integer(clip.lengthTicks, `${path}.lengthTicks`, 1, issues);
      if (
        clip.loopMode !== "once" &&
        clip.loopMode !== "loop" &&
        clip.loopMode !== "hold_last"
      )
        issues.push({
          code: "unsupported_loop_mode",
          path: `${path}.loopMode`,
        });
      if (clip.state === "death" && clip.loopMode !== "hold_last")
        issues.push({
          code: "invalid_death_loop_mode",
          path: `${path}.loopMode`,
        });
      if (
        exactKeys(clip.rootMotion, ["policy"], `${path}.rootMotion`, issues)
      ) {
        if (
          clip.rootMotion.policy !== "in_place" &&
          clip.rootMotion.policy !== "ground_travel"
        )
          issues.push({ code: "enum", path: `${path}.rootMotion.policy` });
      }
      if (!Array.isArray(clip.keyframes))
        issues.push({ code: "type", path: `${path}.keyframes` });
      else
        for (const [frameIndex, frame] of clip.keyframes.entries()) {
          const framePath = `${path}.keyframes.${frameIndex}`;
          if (
            !exactKeys(
              frame,
              ["boneId", "channel", "timeTick", "value", "interpolation"],
              framePath,
              issues,
            )
          )
            continue;
          if (typeof frame.boneId !== "string" || !boneIds.has(frame.boneId))
            issues.push({ code: "unknown_bone", path: `${framePath}.boneId` });
          if (
            typeof frame.channel !== "string" ||
            CHANNELS[frame.channel] !== true
          )
            issues.push({
              code: "unsupported_channel",
              path: `${framePath}.channel`,
            });
          integer(frame.timeTick, `${framePath}.timeTick`, 0, issues);
          if (
            typeof frame.timeTick === "number" &&
            typeof clip.lengthTicks === "number" &&
            frame.timeTick > clip.lengthTicks
          )
            issues.push({
              code: "keyframe_after_clip",
              path: `${framePath}.timeTick`,
            });
          vector(frame.value, `${framePath}.value`, issues);
          if (
            typeof frame.interpolation !== "string" ||
            INTERPOLATIONS[frame.interpolation] !== true
          )
            issues.push({
              code: "unsupported_interpolation",
              path: `${framePath}.interpolation`,
            });
        }
      if (!Array.isArray(clip.transitions))
        issues.push({ code: "type", path: `${path}.transitions` });
      else
        for (const [
          transitionIndex,
          transition,
        ] of clip.transitions.entries()) {
          const transitionPath = `${path}.transitions.${transitionIndex}`;
          if (
            !exactKeys(
              transition,
              ["toState", "durationTicks"],
              transitionPath,
              issues,
            )
          )
            continue;
          if (
            typeof transition.toState !== "string" ||
            STATES[transition.toState] !== true
          )
            issues.push({ code: "enum", path: `${transitionPath}.toState` });
          integer(
            transition.durationTicks,
            `${transitionPath}.durationTicks`,
            0,
            issues,
          );
        }
      if (
        clip.loopMode === "once" &&
        (!Array.isArray(clip.transitions) || clip.transitions.length === 0)
      )
        issues.push({
          code: "missing_terminal_state",
          path: `${path}.transitions`,
        });
      if (
        !Array.isArray(clip.acceptanceRuleIds) ||
        clip.acceptanceRuleIds.length === 0
      )
        issues.push({ code: "required", path: `${path}.acceptanceRuleIds` });
      else
        for (const [ruleIndex, rule] of clip.acceptanceRuleIds.entries()) {
          if (typeof rule !== "string" || ACCEPTANCE_RULES[rule] !== true)
            issues.push({
              code: "unknown_acceptance_rule",
              path: `${path}.acceptanceRuleIds.${ruleIndex}`,
            });
        }
    }
  if (Array.isArray(input.clips)) {
    for (const [index, clip] of input.clips.entries()) {
      if (
        clip === null ||
        typeof clip !== "object" ||
        Array.isArray(clip) ||
        !Array.isArray(clip.transitions)
      )
        continue;
      for (const [transitionIndex, transition] of clip.transitions.entries()) {
        if (
          transition !== null &&
          typeof transition === "object" &&
          !Array.isArray(transition) &&
          typeof transition.toState === "string" &&
          !states.has(transition.toState)
        )
          issues.push({
            code: "unknown_state",
            path: `$.clips.${index}.transitions.${transitionIndex}.toState`,
          });
      }
    }
  }

  if (issues.length > 0) {
    const unsupported = issues.some((issue) =>
      issue.code.startsWith("unsupported_"),
    );
    return { status: unsupported ? "unsupported_request" : "invalid", issues };
  }
  const spec = structuredClone(input) as unknown as AnimationSpec;
  for (const feature of options.requestedFeatures ?? []) {
    if (options.capabilities?.[feature] === false) {
      return {
        status: "unavailable",
        issues: [{ code: `${feature}_unavailable`, path: "$" }],
        checks: [{ checked: false, status: "unavailable" }],
      };
    }
  }
  if (
    options.capabilities?.bezier === false &&
    spec.clips.some((clip) =>
      clip.keyframes.some((frame) => frame.interpolation === "bezier"),
    )
  ) {
    return {
      status: "unavailable",
      issues: [{ code: "bezier_unavailable", path: "$.clips" }],
      checks: [{ checked: false, status: "unavailable" }],
    };
  }
  return { status: "valid", spec, issues: [] };
}

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateAnimation(request: { spec: unknown; seed: number }): {
  status: "generated" | "invalid" | "unsupported_request" | "unavailable";
  spec?: AnimationSpec;
  semanticSha256?: string;
  provenance?: {
    seed: number;
    rngAlgorithm: string;
    seedDerivationVersion: number;
  };
  issues?: Issue[];
} {
  if (!("seed" in request))
    return {
      status: "invalid",
      issues: [{ code: "required", path: "$.seed" }],
    };
  if (
    typeof request.seed !== "number" ||
    !Number.isSafeInteger(request.seed) ||
    request.seed < 0
  ) {
    return {
      status: "invalid",
      issues: [{ code: "invalid_seed", path: "$.seed" }],
    };
  }
  const validation = validateAnimationSpec(request.spec);
  if (validation.status !== "valid")
    return { status: validation.status, issues: validation.issues };
  const spec = structuredClone(validation.spec);
  const random = randomGenerator(request.seed);
  const bones = spec.rig.bones.filter(
    (bone) => bone.role !== "root" && bone.role !== "static",
  );
  for (const clip of spec.clips) {
    if (clip.keyframes.length > 0) continue;
    for (const bone of bones) {
      const rotation = (random() - 0.5) * (clip.state === "attack" ? 45 : 15);
      const position = (random() - 0.5) * 0.2;
      const scale = 1 + (random() - 0.5) * 0.04;
      const values: Record<AnimationChannel, Vector3> = {
        rotation: [rotation, 0, 0],
        position: [0, position, 0],
        scale: [scale, scale, scale],
      };
      const initial: Record<AnimationChannel, Vector3> = {
        rotation: [0, 0, 0],
        position: [0, 0, 0],
        scale: [1, 1, 1],
      };
      for (const channel of ["rotation", "position", "scale"] as const) {
        const poses: Array<[number, Vector3]> =
          clip.loopMode === "loop"
            ? [
                [0, initial[channel]],
                [Math.floor(clip.lengthTicks / 2), values[channel]],
                [clip.lengthTicks, initial[channel]],
              ]
            : [
                [0, initial[channel]],
                [clip.lengthTicks, values[channel]],
              ];
        for (const [timeTick, value] of poses) {
          clip.keyframes.push({
            boneId: bone.id,
            channel,
            timeTick,
            value,
            interpolation: channel === "scale" ? "step" : "linear",
          });
        }
      }
    }
  }
  return {
    status: "generated",
    spec,
    semanticSha256: sha256(canonicalJson(spec)),
    provenance: {
      seed: request.seed,
      rngAlgorithm: "mulberry32",
      seedDerivationVersion: 1,
    },
  };
}

type Finding = {
  code: string;
  ruleId: string;
  path?: string;
  clipId?: string;
  boneId?: string;
};
const distance = (a: Vector3, b: Vector3): number =>
  Math.hypot(...a.map((value, index) => value - (b[index] ?? 0)));

function modelShapeFindings(model: unknown): Finding[] {
  const findings: Finding[] = [];
  const finding = (path: string, code = "invalid_model") =>
    findings.push({ code, ruleId: "VX-MDL-002-DEGENERATE", path });
  if (model === null || typeof model !== "object" || Array.isArray(model)) {
    finding("$");
    return findings;
  }
  const fields = model as Record<string, unknown>;
  if (fields.sourceFormat !== "bbmodel") finding("$.sourceFormat");
  if (
    fields.kind !== "modded_entity" &&
    fields.kind !== "java_block" &&
    fields.kind !== "java_item"
  )
    finding("$.kind");
  if (
    typeof fields.textureWidth !== "number" ||
    !Number.isInteger(fields.textureWidth) ||
    fields.textureWidth <= 0
  )
    finding("$.textureWidth");
  if (
    typeof fields.textureHeight !== "number" ||
    !Number.isInteger(fields.textureHeight) ||
    fields.textureHeight <= 0
  )
    finding("$.textureHeight");
  if (
    fields.orientation === null ||
    typeof fields.orientation !== "object" ||
    Array.isArray(fields.orientation)
  )
    finding("$.orientation");
  else {
    const orientation = fields.orientation as Record<string, unknown>;
    if (typeof orientation.front !== "string") finding("$.orientation.front");
    if (typeof orientation.ownRight !== "string")
      finding("$.orientation.ownRight");
    if (
      !Array.isArray(orientation.mirroredBoneIds) ||
      orientation.mirroredBoneIds.some((id) => typeof id !== "string")
    )
      finding("$.orientation.mirroredBoneIds");
  }
  if (
    fields.joints === null ||
    typeof fields.joints !== "object" ||
    Array.isArray(fields.joints)
  )
    finding("$.joints");
  else
    for (const [id, joint] of Object.entries(fields.joints)) {
      if (
        !Array.isArray(joint) ||
        joint.length !== 3 ||
        joint.some(
          (value) => typeof value !== "number" || !Number.isFinite(value),
        )
      )
        finding(`$.joints.${id}`);
    }
  if (!Array.isArray(fields.textures)) finding("$.textures");
  else
    for (const [index, texture] of fields.textures.entries()) {
      if (
        texture === null ||
        typeof texture !== "object" ||
        Array.isArray(texture)
      ) {
        finding(`$.textures.${index}`, "invalid_texture");
        continue;
      }
      const fields = texture as Record<string, unknown>;
      if (
        typeof fields.id !== "string" ||
        typeof fields.path !== "string" ||
        typeof fields.sha256 !== "string" ||
        !SHA256.test(fields.sha256)
      )
        finding(`$.textures.${index}`, "invalid_texture");
    }
  if (!Array.isArray(fields.cubes)) finding("$.cubes");
  else
    for (const [index, cube] of fields.cubes.entries()) {
      const path = `$.cubes.${index}`;
      if (cube === null || typeof cube !== "object" || Array.isArray(cube)) {
        finding(path, "invalid_cube");
        continue;
      }
      const fields = cube as Record<string, unknown>;
      if (
        typeof fields.id !== "string" ||
        typeof fields.boneId !== "string" ||
        typeof fields.mirrored !== "boolean"
      )
        finding(path, "invalid_cube");
      for (const endpoint of ["from", "to"] as const) {
        const value = fields[endpoint];
        if (
          !Array.isArray(value) ||
          value.length !== 3 ||
          value.some(
            (component) =>
              typeof component !== "number" || !Number.isFinite(component),
          )
        )
          finding(`${path}.${endpoint}`, "invalid_cube");
      }
      if (
        fields.faces === null ||
        typeof fields.faces !== "object" ||
        Array.isArray(fields.faces)
      )
        finding(`${path}.faces`, "invalid_cube");
      else
        for (const [name, face] of Object.entries(fields.faces)) {
          if (
            face === null ||
            typeof face !== "object" ||
            Array.isArray(face)
          ) {
            finding(`${path}.faces.${name}`, "invalid_face");
            continue;
          }
          const fields = face as Record<string, unknown>;
          if (
            typeof fields.textureId !== "string" ||
            !Array.isArray(fields.uv) ||
            fields.uv.length !== 4 ||
            fields.uv.some(
              (value) => typeof value !== "number" || !Number.isFinite(value),
            )
          )
            finding(`${path}.faces.${name}`, "invalid_face");
        }
    }
  return findings;
}

export function analyzeAnimation(request: {
  spec: unknown;
  model: AnimationModel;
}): {
  status: "passed" | "failed";
  findings: Finding[];
  metrics?: Record<string, Record<string, number>>;
} {
  const validation = validateAnimationSpec(request.spec);
  if (validation.status !== "valid") {
    return {
      status: "failed",
      findings: validation.issues.map((issue) => ({
        code: issue.code,
        ruleId: "VX-MDL-002-DEGENERATE",
        path: issue.path,
      })),
    };
  }
  const { spec } = validation;
  const findings = modelShapeFindings(request.model);
  const metrics: Record<string, Record<string, number>> = {};
  if (findings.length > 0) return { status: "failed", findings, metrics };
  const model = request.model;
  const bones = new Map(spec.rig.bones.map((bone) => [bone.id, bone]));
  for (const bone of spec.rig.bones) {
    const joint = model.joints[bone.id];
    if (joint === undefined || distance(bone.pivot, joint) > 0) {
      findings.push({
        code: "off_joint_pivot",
        ruleId: "VX-ANIM-001-RIG",
        boneId: bone.id,
      });
    }
  }
  const textures = new Set(model.textures.map((texture) => texture.id));
  const mirroredBones = new Set(model.orientation?.mirroredBoneIds ?? []);
  if (model.orientation?.front !== "-Z")
    findings.push({
      code: "wrong_front_axis",
      ruleId: "VX-UV-002-ORIENTATION",
    });
  if (model.orientation?.ownRight !== "+X")
    findings.push({
      code: "wrong_own_right_axis",
      ruleId: "VX-UV-002-ORIENTATION",
    });
  for (const cube of model.cubes) {
    if (!bones.has(cube.boneId))
      findings.push({
        code: "unknown_cube_bone",
        ruleId: "VX-MDL-002-DEGENERATE",
        boneId: cube.boneId,
      });
    if (cube.from.some((value, index) => cube.to[index] === value))
      findings.push({
        code: "zero_size_cube",
        ruleId: "VX-MDL-002-DEGENERATE",
      });
    if (cube.mirrored && !mirroredBones.has(cube.boneId))
      findings.push({
        code: "unmarked_mirrored_geometry",
        ruleId: "VX-UV-002-ORIENTATION",
        boneId: cube.boneId,
      });
    for (const [faceName, face] of Object.entries(cube.faces)) {
      const path = `$.cubes.${cube.id}.faces.${faceName}`;
      if (!textures.has(face.textureId))
        findings.push({
          code: "missing_texture",
          ruleId: "VX-UV-001-BOUNDS",
          path,
        });
      const [u1, v1, u2, v2] = face.uv;
      if ([u1, v1, u2, v2].some((value) => !Number.isInteger(value)))
        findings.push({
          code: "uv_off_texel_grid",
          ruleId: "VX-UV-001-BOUNDS",
          path,
        });
      if (
        u1 < 0 ||
        v1 < 0 ||
        u2 > model.textureWidth ||
        v2 > model.textureHeight
      )
        findings.push({
          code: "uv_out_of_bounds",
          ruleId: "VX-UV-001-BOUNDS",
          path,
        });
      if (u1 === u2 || v1 === v2)
        findings.push({
          code: "zero_area_face",
          ruleId: "VX-UV-001-BOUNDS",
          path,
        });
    }
  }
  for (let left = 0; left < model.cubes.length; left++) {
    for (let right = left + 1; right < model.cubes.length; right++) {
      const a = model.cubes[left]!;
      const b = model.cubes[right]!;
      if (
        a.from.every((value, index) => value === b.from[index]) &&
        a.to.every((value, index) => value === b.to[index])
      ) {
        findings.push({
          code: "coplanar_overlap",
          ruleId: "VX-ZF-001-COPLANAR",
        });
      }
    }
  }
  for (const clip of spec.clips) {
    const metric = {
      rotationDeltaDegrees: 0,
      translationDelta: 0,
      scaleDelta: 0,
    };
    metrics[clip.id] = metric;
    if (clip.loopMode !== "loop") continue;
    for (const bone of spec.rig.bones) {
      if (
        bone.id === spec.rig.rootBone &&
        clip.rootMotion.policy === "ground_travel"
      )
        continue;
      for (const channel of ["position", "rotation", "scale"] as const) {
        const frames = clip.keyframes
          .filter(
            (frame) => frame.boneId === bone.id && frame.channel === channel,
          )
          .sort((a, b) => a.timeTick - b.timeTick);
        if (frames.length < 2) continue;
        const delta = distance(frames[0]!.value, frames.at(-1)!.value);
        const key =
          channel === "rotation"
            ? "rotationDeltaDegrees"
            : channel === "position"
              ? "translationDelta"
              : "scaleDelta";
        metric[key] = Math.max(metric[key], delta);
      }
    }
    if (metric.rotationDeltaDegrees > 0.5)
      findings.push({
        code: "loop_rotation_delta",
        ruleId: "VX-ANIM-002-LOOP-SEAM",
        clipId: clip.id,
      });
    if (metric.translationDelta > 0.001)
      findings.push({
        code: "loop_translation_delta",
        ruleId: "VX-ANIM-002-LOOP-SEAM",
        clipId: clip.id,
      });
    if (metric.scaleDelta > 0.0001)
      findings.push({
        code: "loop_scale_delta",
        ruleId: "VX-ANIM-002-LOOP-SEAM",
        clipId: clip.id,
      });
  }
  return {
    status: findings.length === 0 ? "passed" : "failed",
    findings,
    metrics,
  };
}

interface AnimationExportFile {
  kind: string;
  path: string;
  content: string;
  sha256: string;
  roundTrip?: {
    operation: "runtime_reimport" | "serialization_reparse";
    checked: boolean;
    status: "passed" | "failed" | "unavailable";
    schemaConformance: {
      checked: boolean;
      status: "passed" | "failed" | "unavailable";
    };
  };
}

interface AnimationExportCheck {
  id?: string;
  path?: string;
  checked: boolean;
  status: string;
  sha256?: string;
  surface?: string;
  schema?: string;
}

interface AnimationRoundTripSummary {
  checked: boolean;
  status: "passed" | "failed";
  compared: {
    cubes: number;
    bones: number;
    pivots: number;
    uvFaces: number;
    materials: number;
    clipNames: string[];
  };
  normalized?: { model: AnimationModel; spec: AnimationSpec };
}

function compareRoundTrip(
  expected: unknown,
  actual: unknown,
  path: string,
  differences: unknown[],
): void {
  if (Object.is(expected, actual)) return;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (
      !Array.isArray(expected) ||
      !Array.isArray(actual) ||
      expected.length !== actual.length
    ) {
      differences.push({ path, expected, actual });
      return;
    }
    for (let index = 0; index < expected.length; index++)
      compareRoundTrip(
        expected[index],
        actual[index],
        `${path}.${index}`,
        differences,
      );
    return;
  }
  if (
    expected !== null &&
    actual !== null &&
    typeof expected === "object" &&
    typeof actual === "object" &&
    !Array.isArray(expected) &&
    !Array.isArray(actual)
  ) {
    const expectedFields = expected as Record<string, unknown>;
    const actualFields = actual as Record<string, unknown>;
    const keys = [
      ...new Set([
        ...Object.keys(expectedFields),
        ...Object.keys(actualFields),
      ]),
    ].sort();
    for (const key of keys)
      compareRoundTrip(
        expectedFields[key],
        actualFields[key],
        `${path}.${key}`,
        differences,
      );
    return;
  }
  differences.push({ path, expected, actual });
}

function javaRuntimeSchemaDiff(value: unknown): unknown[] {
  const differences: unknown[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return [{ path: "$", code: "invalid_java_model" }];
  const fields = value as Record<string, unknown>;
  const textures = fields.textures;
  if (
    textures === null ||
    typeof textures !== "object" ||
    Array.isArray(textures)
  )
    differences.push({ path: "$.textures", code: "invalid_textures" });
  else
    for (const [id, path] of Object.entries(textures)) {
      if (
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id) ||
        typeof path !== "string" ||
        path.length === 0
      )
        differences.push({
          path: `$.textures.${id}`,
          code: "invalid_texture_reference",
        });
    }
  if (!Array.isArray(fields.elements))
    differences.push({ path: "$.elements", code: "invalid_elements" });
  else
    for (const [index, element] of fields.elements.entries()) {
      const path = `$.elements.${index}`;
      if (
        element === null ||
        typeof element !== "object" ||
        Array.isArray(element)
      ) {
        differences.push({ path, code: "invalid_element" });
        continue;
      }
      const elementFields = element as Record<string, unknown>;
      if (
        Object.keys(elementFields).some(
          (key) => !["from", "to", "faces"].includes(key),
        )
      )
        differences.push({ path, code: "internal_field_leak" });
      for (const endpoint of ["from", "to"] as const) {
        const vectorValue = elementFields[endpoint];
        if (
          !Array.isArray(vectorValue) ||
          vectorValue.length !== 3 ||
          vectorValue.some(
            (component) =>
              typeof component !== "number" || !Number.isFinite(component),
          )
        )
          differences.push({
            path: `${path}.${endpoint}`,
            code: "invalid_vector",
          });
      }
      if (
        elementFields.faces === null ||
        typeof elementFields.faces !== "object" ||
        Array.isArray(elementFields.faces)
      )
        differences.push({ path: `${path}.faces`, code: "invalid_faces" });
      else
        for (const [name, face] of Object.entries(elementFields.faces)) {
          if (
            face === null ||
            typeof face !== "object" ||
            Array.isArray(face)
          ) {
            differences.push({
              path: `${path}.faces.${name}`,
              code: "invalid_face",
            });
            continue;
          }
          const faceFields = face as Record<string, unknown>;
          if (
            !Array.isArray(faceFields.uv) ||
            faceFields.uv.length !== 4 ||
            faceFields.uv.some(
              (component) =>
                typeof component !== "number" || !Number.isFinite(component),
            ) ||
            typeof faceFields.texture !== "string" ||
            !/^#[A-Za-z_][A-Za-z0-9_]*$/.test(faceFields.texture)
          )
            differences.push({
              path: `${path}.faces.${name}`,
              code: "invalid_face",
            });
          else if (
            textures !== null &&
            typeof textures === "object" &&
            !Array.isArray(textures) &&
            !Object.hasOwn(textures, faceFields.texture.slice(1))
          )
            differences.push({
              path: `${path}.faces.${name}.texture`,
              code: "missing_texture_reference",
            });
        }
    }
  return differences;
}

function numericVector(value: unknown, length: number): boolean {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(
      (component) =>
        typeof component === "number" && Number.isFinite(component),
    )
  );
}

function geckolibGeometrySchemaDiff(value: unknown): unknown[] {
  const differences: unknown[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return [{ path: "$", code: "invalid_geckolib_geometry" }];
  const fields = value as Record<string, unknown>;
  const definitions = fields["minecraft:geometry"];
  if (
    fields.format_version !== "1.12.0" ||
    !Array.isArray(definitions) ||
    definitions.length === 0
  )
    return [{ path: "$", code: "invalid_geckolib_geometry" }];
  for (const [index, definition] of definitions.entries()) {
    const path = `$.minecraft:geometry.${index}`;
    if (
      definition === null ||
      typeof definition !== "object" ||
      Array.isArray(definition)
    ) {
      differences.push({ path, code: "invalid_geometry_definition" });
      continue;
    }
    const definitionFields = definition as Record<string, unknown>;
    const descriptionValue = definitionFields.description;
    if (
      descriptionValue === null ||
      typeof descriptionValue !== "object" ||
      Array.isArray(descriptionValue) ||
      !Array.isArray(definitionFields.bones)
    ) {
      differences.push({ path, code: "invalid_geometry_definition" });
      continue;
    }
    const description = descriptionValue as Record<string, unknown>;
    if (
      typeof description.identifier !== "string" ||
      description.identifier.length === 0 ||
      !Number.isInteger(description.texture_width) ||
      !Number.isInteger(description.texture_height) ||
      (description.texture_width as number) <= 0 ||
      (description.texture_height as number) <= 0
    )
      differences.push({
        path: `${path}.description`,
        code: "invalid_geometry_description",
      });
    for (const [boneIndex, bone] of definitionFields.bones.entries()) {
      const bonePath = `${path}.bones.${boneIndex}`;
      if (bone === null || typeof bone !== "object" || Array.isArray(bone)) {
        differences.push({ path: bonePath, code: "invalid_bone" });
        continue;
      }
      const boneFields = bone as Record<string, unknown>;
      if (
        typeof boneFields.name !== "string" ||
        !numericVector(boneFields.pivot, 3) ||
        (boneFields.parent !== undefined &&
          typeof boneFields.parent !== "string")
      ) {
        differences.push({ path: bonePath, code: "invalid_bone" });
        continue;
      }
      if (boneFields.cubes !== undefined && !Array.isArray(boneFields.cubes))
        differences.push({ path: `${bonePath}.cubes`, code: "invalid_cubes" });
      else
        for (const [cubeIndex, cube] of (boneFields.cubes ?? []).entries()) {
          const cubePath = `${bonePath}.cubes.${cubeIndex}`;
          if (
            cube === null ||
            typeof cube !== "object" ||
            Array.isArray(cube)
          ) {
            differences.push({ path: cubePath, code: "invalid_cube" });
            continue;
          }
          const cubeFields = cube as Record<string, unknown>;
          if (
            !numericVector(cubeFields.origin, 3) ||
            !numericVector(cubeFields.size, 3) ||
            cubeFields.uv === null ||
            typeof cubeFields.uv !== "object" ||
            Array.isArray(cubeFields.uv)
          ) {
            differences.push({ path: cubePath, code: "invalid_cube" });
            continue;
          }
          for (const [faceName, face] of Object.entries(cubeFields.uv)) {
            if (
              face === null ||
              typeof face !== "object" ||
              Array.isArray(face)
            ) {
              differences.push({
                path: `${cubePath}.uv.${faceName}`,
                code: "invalid_uv",
              });
              continue;
            }
            const faceFields = face as Record<string, unknown>;
            if (
              !["north", "east", "south", "west", "up", "down"].includes(
                faceName,
              ) ||
              !numericVector(faceFields.uv, 2) ||
              !numericVector(faceFields.uv_size, 2)
            )
              differences.push({
                path: `${cubePath}.uv.${faceName}`,
                code: "invalid_uv",
              });
          }
        }
    }
  }
  return differences;
}

function geckolibAnimationSchemaDiff(value: unknown): unknown[] {
  const differences: unknown[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return [{ path: "$", code: "invalid_geckolib_animation" }];
  const fields = value as Record<string, unknown>;
  const animations = fields.animations;
  if (
    fields.format_version !== "1.8.0" ||
    animations === null ||
    typeof animations !== "object" ||
    Array.isArray(animations)
  )
    return [{ path: "$", code: "invalid_geckolib_animation" }];
  for (const [clipId, clip] of Object.entries(animations)) {
    const path = `$.animations.${clipId}`;
    if (clip === null || typeof clip !== "object" || Array.isArray(clip)) {
      differences.push({ path, code: "invalid_animation_clip" });
      continue;
    }
    const clipFields = clip as Record<string, unknown>;
    const length = clipFields.animation_length;
    const bones = clipFields.bones;
    if (
      typeof length !== "number" ||
      !Number.isFinite(length) ||
      length < 0 ||
      (clipFields.loop !== true &&
        clipFields.loop !== false &&
        clipFields.loop !== "hold_on_last_frame") ||
      bones === null ||
      typeof bones !== "object" ||
      Array.isArray(bones)
    ) {
      differences.push({ path, code: "invalid_animation_clip" });
      continue;
    }
    for (const [boneId, bone] of Object.entries(bones)) {
      if (bone === null || typeof bone !== "object" || Array.isArray(bone)) {
        differences.push({
          path: `${path}.bones.${boneId}`,
          code: "invalid_bone_animation",
        });
        continue;
      }
      for (const [channel, frames] of Object.entries(bone)) {
        if (
          !["position", "rotation", "scale"].includes(channel) ||
          frames === null ||
          typeof frames !== "object" ||
          Array.isArray(frames)
        ) {
          differences.push({
            path: `${path}.bones.${boneId}.${channel}`,
            code: "invalid_keyframes",
          });
          continue;
        }
        for (const [timestamp, frame] of Object.entries(frames)) {
          const seconds = Number(timestamp);
          let vectorValue: unknown;
          let interpolation: unknown = "linear";
          if (Array.isArray(frame)) vectorValue = frame;
          else if (frame !== null && typeof frame === "object") {
            const frameFields = frame as Record<string, unknown>;
            vectorValue = frameFields.vector;
            interpolation = frameFields.lerp_mode ?? "linear";
          }
          if (
            !Number.isFinite(seconds) ||
            seconds < 0 ||
            !numericVector(vectorValue, 3) ||
            (interpolation !== "linear" &&
              interpolation !== "step" &&
              interpolation !== "catmullrom")
          )
            differences.push({
              path: `${path}.bones.${boneId}.${channel}.${timestamp}`,
              code: "invalid_keyframe",
            });
        }
      }
    }
  }
  return differences;
}

function reimportGeckolib(
  files: AnimationExportFile[],
  sourceModel: AnimationModel,
  sourceSpec: AnimationSpec,
): { model: AnimationModel; spec: AnimationSpec } {
  const geometry = JSON.parse(
    files.find((file) => file.kind === "geometry")!.content,
  ) as {
    "minecraft:geometry": Array<{
      description: { texture_width: number; texture_height: number };
      bones: Array<{
        name: string;
        parent?: string;
        pivot: Vector3;
        cubes?: Array<{
          origin: Vector3;
          size: Vector3;
          mirror?: boolean;
          uv: Record<
            string,
            { uv: [number, number]; uv_size: [number, number] }
          >;
        }>;
      }>;
    }>;
  };
  const animation = JSON.parse(
    files.find((file) => file.kind === "animation")!.content,
  ) as {
    animations: Record<
      string,
      {
        animation_length: number;
        loop: boolean | "hold_on_last_frame";
        bones: Record<
          string,
          Record<
            string,
            Record<
              string,
              | Vector3
              | {
                  vector: Vector3;
                  lerp_mode?: "linear" | "step" | "catmullrom";
                }
            >
          >
        >;
      }
    >;
  };
  const model = structuredClone(sourceModel);
  const spec = structuredClone(sourceSpec);
  const definition = geometry["minecraft:geometry"][0]!;
  model.textureWidth = definition.description.texture_width;
  model.textureHeight = definition.description.texture_height;
  model.joints = Object.fromEntries(
    definition.bones.map((bone) => [bone.name, bone.pivot]),
  );
  model.cubes = sourceModel.cubes.flatMap((sourceCube) => {
    const bone = definition.bones.find(
      (candidate) => candidate.name === sourceCube.boneId,
    );
    const cube = bone?.cubes?.find((candidate) =>
      candidate.origin.every(
        (value, index) => value === sourceCube.from[index],
      ),
    );
    if (!cube) return [];
    return [
      {
        ...sourceCube,
        from: cube.origin,
        to: cube.origin.map(
          (value, index) => value + cube.size[index]!,
        ) as Vector3,
        mirrored: cube.mirror ?? false,
        faces: Object.fromEntries(
          Object.entries(cube.uv).map(([name, face]) => [
            name,
            {
              uv: [
                face.uv[0],
                face.uv[1],
                face.uv[0] + face.uv_size[0],
                face.uv[1] + face.uv_size[1],
              ],
              textureId: sourceCube.faces[name]?.textureId ?? "",
            },
          ]),
        ) as AnimationModelCube["faces"],
      },
    ];
  });
  spec.rig.bones = sourceSpec.rig.bones.flatMap((sourceBone) => {
    const bone = definition.bones.find(
      (candidate) => candidate.name === sourceBone.id,
    );
    return bone
      ? [{ ...sourceBone, parent: bone.parent ?? null, pivot: bone.pivot }]
      : [];
  });
  spec.clips = sourceSpec.clips.flatMap((sourceClip) => {
    const clip = animation.animations[sourceClip.id];
    if (!clip) return [];
    const keyframes = sourceClip.keyframes.flatMap((sourceFrame) => {
      const frame =
        clip.bones[sourceFrame.boneId]?.[sourceFrame.channel]?.[
          String(sourceFrame.timeTick / 20)
        ];
      if (!frame) return [];
      return [
        {
          ...sourceFrame,
          value: Array.isArray(frame) ? frame : frame.vector,
          interpolation: Array.isArray(frame)
            ? ("linear" as const)
            : (frame.lerp_mode ?? "linear"),
        },
      ];
    });
    return [
      {
        ...sourceClip,
        lengthTicks: clip.animation_length * 20,
        loopMode:
          clip.loop === true
            ? ("loop" as const)
            : clip.loop === false
              ? ("once" as const)
              : ("hold_last" as const),
        keyframes,
      },
    ];
  });
  return { model, spec };
}

function reimportJava(files: AnimationExportFile[]): {
  model: AnimationModel;
  spec: AnimationSpec;
} {
  const runtime = JSON.parse(
    files.find((file) => file.kind === "java_model")!.content,
  ) as {
    texture_size: [number, number];
    textures: Record<string, string>;
    elements: Array<{
      from: Vector3;
      to: Vector3;
      faces: Record<
        string,
        { uv: [number, number, number, number]; texture: string }
      >;
    }>;
  };
  const editable = JSON.parse(
    files.find((file) => file.kind === "editable_source")!.content,
  ) as { model: AnimationModel; spec: AnimationSpec };
  const model = structuredClone(editable.model);
  const spec = structuredClone(editable.spec);
  model.textureWidth = runtime.texture_size[0];
  model.textureHeight = runtime.texture_size[1];
  model.textures = editable.model.textures.flatMap((texture) =>
    Object.hasOwn(runtime.textures, texture.id)
      ? [{ ...texture, path: runtime.textures[texture.id]! }]
      : [],
  );
  model.cubes = editable.model.cubes.flatMap((sourceCube, index) => {
    const element = runtime.elements[index];
    if (!element) return [];
    return [
      {
        ...sourceCube,
        from: element.from,
        to: element.to,
        faces: Object.fromEntries(
          Object.entries(element.faces).map(([name, face]) => [
            name,
            { uv: face.uv, textureId: face.texture.slice(1) },
          ]),
        ),
      },
    ];
  });
  return { model, spec };
}

export function exportAnimation(request: {
  spec: unknown;
  model: AnimationModel;
  format: AnimationFormat;
}): {
  status: "exported" | "unsupported" | "failed" | "unavailable";
  code?: string;
  files: AnimationExportFile[];
  roundTripDiff?: unknown[];
  roundTrip?: AnimationRoundTripSummary;
  findings?: Finding[];
  checks?: AnimationExportCheck[];
} {
  const validation = validateAnimationSpec(request.spec);
  if (validation.status !== "valid")
    return { status: "unsupported", code: "invalid_animation_spec", files: [] };
  const modelFindings = modelShapeFindings(request.model);
  if (modelFindings.length > 0)
    return {
      status: "failed",
      code: "invalid_model",
      files: [],
      findings: modelFindings,
    };
  const spec = validation.spec;
  const { model, format } = request;
  if (model.kind !== format)
    return { status: "unsupported", code: "model_format_mismatch", files: [] };
  if (
    format !== "modded_entity" &&
    format !== "java_block" &&
    format !== "java_item"
  )
    return { status: "unavailable", code: "reimport_unavailable", files: [] };
  if (format !== "modded_entity" && spec.clips.length > 0)
    return {
      status: "unsupported",
      code: "java_bone_animation_unsupported",
      files: [],
    };
  if (
    format === "modded_entity" &&
    spec.clips.some((clip) =>
      clip.keyframes.some((keyframe) => keyframe.interpolation === "bezier"),
    )
  )
    return {
      status: "unavailable",
      code: "bezier_control_points_required",
      files: [],
      checks: [
        {
          id: "runtime_honesty",
          checked: false,
          status: "unavailable",
          surface: "target_runtime_json",
        },
      ],
    };
  const file = (
    kind: string,
    path: string,
    value: unknown,
  ): AnimationExportFile => {
    const content = canonicalJson(value);
    return { kind, path, content, sha256: sha256(content) };
  };
  const editable = file("editable_source", `${spec.animationSetId}.bbmodel`, {
    sourceFormat: model.sourceFormat,
    model,
    spec,
  });
  const javaTextures = Object.fromEntries(
    model.textures.map((texture) => [texture.id, texture.path]),
  );
  const javaElements = model.cubes.map((cube) => ({
    from: cube.from,
    to: cube.to,
    faces: Object.fromEntries(
      Object.entries(cube.faces).map(([name, face]) => [
        name,
        { uv: face.uv, texture: `#${face.textureId}` },
      ]),
    ),
  }));
  const runtimeBones = spec.rig.bones.map((bone) => ({
    name: bone.id,
    ...(bone.parent === null ? {} : { parent: bone.parent }),
    pivot: bone.pivot,
    ...(model.cubes.some((cube) => cube.boneId === bone.id)
      ? {
          cubes: model.cubes
            .filter((cube) => cube.boneId === bone.id)
            .map((cube) => ({
              origin: cube.from,
              size: cube.to.map((value, index) => value - cube.from[index]!),
              ...(cube.mirrored ? { mirror: true } : {}),
              uv: Object.fromEntries(
                Object.entries(cube.faces).map(([name, face]) => [
                  name,
                  {
                    uv: [face.uv[0], face.uv[1]],
                    uv_size: [face.uv[2] - face.uv[0], face.uv[3] - face.uv[1]],
                  },
                ]),
              ),
            })),
        }
      : {}),
  }));
  const runtimeAnimations = Object.fromEntries(
    spec.clips.map((clip) => {
      const bones: Record<string, Record<string, Record<string, unknown>>> = {};
      for (const frame of clip.keyframes) {
        const bone = (bones[frame.boneId] ??= {});
        const channel = (bone[frame.channel] ??= {});
        const seconds = frame.timeTick / 20;
        channel[String(seconds)] =
          frame.interpolation === "linear"
            ? frame.value
            : { vector: frame.value, lerp_mode: frame.interpolation };
      }
      return [
        clip.id,
        {
          animation_length: clip.lengthTicks / 20,
          loop:
            clip.loopMode === "loop"
              ? true
              : clip.loopMode === "once"
                ? false
                : "hold_on_last_frame",
          bones,
        },
      ];
    }),
  );
  const files =
    format === "modded_entity"
      ? [
          file(
            "geometry",
            `assets/${spec.animationSetId}/geo/${spec.animationSetId}.geo.json`,
            {
              format_version: "1.12.0",
              "minecraft:geometry": [
                {
                  description: {
                    identifier: `geometry.${spec.animationSetId}`,
                    texture_width: model.textureWidth,
                    texture_height: model.textureHeight,
                  },
                  bones: runtimeBones,
                },
              ],
            },
          ),
          file(
            "animation",
            `assets/${spec.animationSetId}/animations/${spec.animationSetId}.animation.json`,
            { format_version: "1.8.0", animations: runtimeAnimations },
          ),
          editable,
        ]
      : [
          file(
            "java_model",
            `assets/${spec.animationSetId}/models/${format === "java_item" ? "item" : "block"}/${spec.animationSetId}.json`,
            {
              texture_size: [model.textureWidth, model.textureHeight],
              textures: javaTextures,
              elements: javaElements,
            },
          ),
          editable,
        ];
  const compared = {
    cubes: model.cubes.length,
    bones: spec.rig.bones.length,
    pivots: Object.keys(model.joints).length,
    uvFaces: model.cubes.reduce(
      (count, cube) => count + Object.keys(cube.faces).length,
      0,
    ),
    materials: model.textures.length,
    clipNames: spec.clips.map((clip) => clip.id),
  };
  const checks: AnimationExportCheck[] = files.map((exported) => ({
    id: "file_serialization",
    path: exported.path,
    checked: true,
    status: "passed",
    sha256: exported.sha256,
  }));
  const schemaChecks: AnimationExportCheck[] = [];
  const roundTripDiff: unknown[] = [];
  for (const exported of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(exported.content);
    } catch {
      exported.roundTrip = {
        operation:
          exported.kind === "editable_source"
            ? "serialization_reparse"
            : "runtime_reimport",
        checked: true,
        status: "failed",
        schemaConformance: { checked: false, status: "unavailable" },
      };
      return {
        status: "failed",
        code: "round_trip_parse_failed",
        files,
        roundTripDiff: [{ path: exported.path, code: "invalid_json" }],
        roundTrip: { checked: true, status: "failed", compared },
        checks: [{ checked: true, status: "failed" }],
      };
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      exported.roundTrip = {
        operation:
          exported.kind === "editable_source"
            ? "serialization_reparse"
            : "runtime_reimport",
        checked: false,
        status: "unavailable",
        schemaConformance: { checked: false, status: "unavailable" },
      };
      return {
        status: "unavailable",
        code: "reimport_unavailable",
        files,
        checks: [{ checked: false, status: "unavailable" }],
      };
    }
    const parsedFields = parsed as Record<string, unknown>;
    let expected: unknown;
    let actual: unknown;
    let schemaDiff: unknown[] = [];
    if (exported.kind === "geometry") {
      schemaDiff = geckolibGeometrySchemaDiff(parsed);
      expected = {
        format_version: "1.12.0",
        "minecraft:geometry": [
          {
            description: {
              identifier: `geometry.${spec.animationSetId}`,
              texture_width: model.textureWidth,
              texture_height: model.textureHeight,
            },
            bones: runtimeBones,
          },
        ],
      };
      actual = parsed;
    } else if (exported.kind === "animation") {
      schemaDiff = geckolibAnimationSchemaDiff(parsed);
      expected = { format_version: "1.8.0", animations: runtimeAnimations };
      actual = parsed;
    } else if (exported.kind === "java_model") {
      schemaDiff = javaRuntimeSchemaDiff(parsed);
      const runtimeElements = Array.isArray(parsedFields.elements)
        ? parsedFields.elements.map((element: unknown) => {
            if (
              element === null ||
              typeof element !== "object" ||
              Array.isArray(element)
            )
              return element;
            const elementFields = element as Record<string, unknown>;
            if (
              elementFields.faces === null ||
              typeof elementFields.faces !== "object" ||
              Array.isArray(elementFields.faces)
            )
              return element;
            return {
              from: elementFields.from,
              to: elementFields.to,
              faces: Object.fromEntries(
                Object.entries(elementFields.faces).map(([name, face]) => {
                  if (
                    face === null ||
                    typeof face !== "object" ||
                    Array.isArray(face)
                  )
                    return [name, face];
                  const faceFields = face as Record<string, unknown>;
                  return [
                    name,
                    typeof faceFields.texture === "string"
                      ? {
                          uv: faceFields.uv,
                          textureId: faceFields.texture.startsWith("#")
                            ? faceFields.texture.slice(1)
                            : faceFields.texture,
                        }
                      : face,
                  ];
                }),
              ),
            };
          })
        : parsedFields.elements;
      expected = {
        texture_size: [model.textureWidth, model.textureHeight],
        textures: javaTextures,
        elements: model.cubes.map((cube) => ({
          from: cube.from,
          to: cube.to,
          faces: cube.faces,
        })),
      };
      actual = {
        texture_size: parsedFields.texture_size,
        textures: parsedFields.textures,
        elements: runtimeElements,
      };
    } else if (exported.kind === "editable_source") {
      expected = { sourceFormat: model.sourceFormat, model, spec };
      actual = parsed;
    } else {
      exported.roundTrip = {
        operation: "runtime_reimport",
        checked: false,
        status: "unavailable",
        schemaConformance: { checked: false, status: "unavailable" },
      };
      return {
        status: "unavailable",
        code: "reimport_unavailable",
        files,
        checks: [{ checked: false, status: "unavailable" }],
      };
    }
    compareRoundTrip(expected, actual, exported.path, roundTripDiff);
    roundTripDiff.push(...schemaDiff);
    const failed = roundTripDiff.length > 0 || schemaDiff.length > 0;
    if (exported.kind !== "editable_source")
      schemaChecks.push({
        id: "schema_validation",
        path: exported.path,
        checked: true,
        status: schemaDiff.length === 0 ? "passed" : "failed",
        schema:
          exported.kind === "geometry"
            ? "geckolib.geometry.1.12.0"
            : exported.kind === "animation"
              ? "geckolib.animation.1.8.0"
              : "minecraft.java_model",
      });
    exported.roundTrip = {
      operation:
        exported.kind === "editable_source"
          ? "serialization_reparse"
          : "runtime_reimport",
      checked: true,
      status: failed ? "failed" : "passed",
      schemaConformance:
        exported.kind === "editable_source"
          ? { checked: false, status: "unavailable" }
          : {
              checked: true,
              status: schemaDiff.length === 0 ? "passed" : "failed",
            },
    };
    checks.push({
      id: "round_trip_reimport",
      path: exported.path,
      checked: true,
      status: failed ? "failed" : "passed",
    });
  }
  if (roundTripDiff.length > 0) {
    checks.push({
      id: "runtime_honesty",
      checked: true,
      status: "failed",
      surface: "target_runtime_json",
    });
    return {
      status: "failed",
      code: "round_trip_mismatch",
      files: [],
      roundTripDiff,
      roundTrip: { checked: true, status: "failed", compared },
      checks: [
        ...checks.slice(0, files.length),
        ...schemaChecks,
        ...checks.slice(files.length),
      ],
    };
  }
  const normalized =
    format === "modded_entity"
      ? reimportGeckolib(files, model, spec)
      : reimportJava(files);
  compareRoundTrip({ model, spec }, normalized, "$.normalized", roundTripDiff);
  checks.push({
    id: "runtime_honesty",
    checked: true,
    status: roundTripDiff.length === 0 ? "passed" : "failed",
    surface: "target_runtime_json",
  });
  const orderedChecks = [
    ...checks.slice(0, files.length),
    ...schemaChecks,
    ...checks.slice(files.length),
  ];
  if (roundTripDiff.length > 0) {
    return {
      status: "failed",
      code: "round_trip_mismatch",
      files: [],
      roundTripDiff,
      roundTrip: { checked: true, status: "failed", compared, normalized },
      checks: orderedChecks,
    };
  }
  return {
    status: "exported",
    files,
    roundTripDiff,
    roundTrip: { checked: true, status: "passed", compared, normalized },
    checks: orderedChecks,
  };
}

export interface AnimationReviewResult {
  status: "passed" | "failed" | "unavailable";
  code?: string;
  checks: Array<{ id: string; checked: boolean; status: string }>;
}

function reviewResult(
  status: AnimationReviewResult["status"],
  code: string | undefined,
  checks: AnimationReviewResult["checks"],
): AnimationReviewResult {
  return code === undefined ? { status, checks } : { status, code, checks };
}

function executedPass(
  check: EvidenceCheck | undefined,
): check is EvidenceCheck {
  return (
    check?.requested === true &&
    check.executed &&
    check.status === "passed" &&
    check.exitCode === 0
  );
}

function storedArtifact(
  manifest: EvidenceManifest,
  name: string,
  digest: string,
): boolean {
  return (
    SHA256.test(digest) &&
    manifest.artifacts.some(
      (artifact) => artifact.name === name && artifact.sha256 === digest,
    )
  );
}

export async function reviewAnimation(
  input: AnimationReviewInput,
): Promise<AnimationReviewResult> {
  const manifest = await readEvidence({
    evidenceRoot: input.evidenceRoot,
    transactionId: input.transactionId,
  });
  const checks: AnimationReviewResult["checks"] = [
    { id: "evidence_authentication", checked: true, status: "passed" },
  ];
  const baseArtifactsValid =
    storedArtifact(manifest, "spec", input.artifacts.spec) &&
    storedArtifact(manifest, "source", input.artifacts.source) &&
    storedArtifact(manifest, "export", input.artifacts.export);
  const productionArtifactValid = storedArtifact(
    manifest,
    "productionJar",
    input.artifacts.productionJar,
  );
  const artifactsValid = baseArtifactsValid && productionArtifactValid;
  checks.push({
    id: "artifact_identity",
    checked: artifactsValid,
    status: artifactsValid ? "passed" : "unavailable",
  });
  if (!artifactsValid)
    return reviewResult("unavailable", "artifact_required", checks);
  const specArtifact = manifest.artifacts.find(
    (artifact) => artifact.name === "spec",
  )!;
  const directory = resolve(input.evidenceRoot, input.transactionId);
  const specPath = resolve(directory, specArtifact.path);
  if (specPath !== directory && !specPath.startsWith(`${directory}${sep}`))
    return reviewResult("failed", "invalid_animation_spec", checks);
  let spec: AnimationSpec;
  try {
    const validation = validateAnimationSpec(
      JSON.parse(await readFile(specPath, "utf8")),
    );
    if (validation.status !== "valid")
      return reviewResult("failed", "invalid_animation_spec", checks);
    spec = validation.spec;
  } catch {
    return reviewResult("failed", "invalid_animation_spec", checks);
  }
  checks.push({ id: "animation_spec", checked: true, status: "passed" });

  const modelCandidate = manifest.checks.find(
    (check) => check.id === "model-source",
  );
  if (
    modelCandidate &&
    (modelCandidate.subject.sourceSha256 !== input.artifacts.source ||
      modelCandidate.subject.exportSha256 !== input.artifacts.export)
  ) {
    checks.push({ id: "model_source_review", checked: true, status: "failed" });
    return reviewResult("failed", "stale_review", checks);
  }
  const modelPassed =
    executedPass(modelCandidate) &&
    modelCandidate.subject.class === "source" &&
    (modelCandidate.subject.surface === "blockbench" ||
      modelCandidate.subject.surface === "blender") &&
    modelCandidate.subject.sourceSha256 === input.artifacts.source &&
    modelCandidate.subject.exportSha256 === input.artifacts.export;
  checks.push({
    id: "model_source_review",
    checked: modelCandidate?.executed === true,
    status: modelPassed
      ? "passed"
      : modelCandidate?.status === "failed"
        ? "failed"
        : "unavailable",
  });
  if (!modelPassed)
    return reviewResult(
      modelCandidate?.status === "failed" ? "failed" : "unavailable",
      "model_review_required",
      checks,
    );

  const productionPassed =
    manifest.environment.productionJar === true &&
    manifest.environment.cleanInstance === true &&
    manifest.checks.some(
      (check) =>
        executedPass(check) &&
        check.subject.class === "browser" &&
        check.subject.surface === "minecraft_client" &&
        check.subject.productionJarSha256 === input.artifacts.productionJar,
    );
  checks.push({
    id: "production_jar",
    checked: productionPassed,
    status: productionPassed ? "passed" : "unavailable",
  });
  if (!productionPassed) {
    const hasClient = manifest.checks.some(
      (check) =>
        check.subject.class === "browser" &&
        check.subject.surface === "minecraft_client",
    );
    return reviewResult(
      "unavailable",
      hasClient ? "production_jar_required" : "minecraft_client_required",
      checks,
    );
  }
  const declaredStates = [...new Set(spec.clips.map((clip) => clip.state))];
  const states = declaredStates.length === 0 ? ["static"] : declaredStates;
  const requiredScenarios = states.flatMap((state) => [
    { state, kind: "state" as const },
    ...(input.requirements.multiplayer
      ? [{ state, kind: "multiplayer" as const }]
      : []),
    ...(input.requirements.persistence
      ? [{ state, kind: "restart" as const }]
      : []),
  ]);
  const scenarioChecks: EvidenceCheck[] = [];
  for (const required of requiredScenarios) {
    const matching = manifest.checks.filter(
      (check) =>
        check.subject.class === "browser" &&
        check.subject.surface === "minecraft_client" &&
        check.subject.productionJarSha256 === input.artifacts.productionJar &&
        check.subject.scenario?.state === required.state &&
        check.subject.scenario.kind === required.kind,
    );
    const check = matching.find(executedPass) ?? matching[0];
    const passed = executedPass(check);
    checks.push({
      id: `scenario:${required.kind}:${required.state}`,
      checked: check?.executed === true,
      status: passed ? "passed" : check ? "failed" : "unavailable",
    });
    if (check) scenarioChecks.push(check);
  }
  if (scenarioChecks.length !== requiredScenarios.length)
    return reviewResult("failed", "missing_state_evidence", checks);
  if (scenarioChecks.some((check) => !executedPass(check)))
    return reviewResult("failed", "invalid_evidence_status", checks);

  const designCandidate = manifest.checks.find(
    (check) => check.id === "design-human",
  );
  if (
    designCandidate &&
    (designCandidate.subject.sourceSha256 !== input.artifacts.source ||
      designCandidate.subject.exportSha256 !== input.artifacts.export)
  ) {
    checks.push({ id: "human_design_review", checked: true, status: "failed" });
    return reviewResult("failed", "stale_review", checks);
  }
  const reviewer = designCandidate?.subject.reviewer;
  const designPassed =
    executedPass(designCandidate) &&
    designCandidate.subject.class === "design_review" &&
    designCandidate.subject.sourceSha256 === input.artifacts.source &&
    designCandidate.subject.exportSha256 === input.artifacts.export &&
    reviewer?.kind === "human" &&
    reviewer.decision === "approved" &&
    reviewer.rubric.length > 0 &&
    Number.isInteger(reviewer.revision) &&
    reviewer.revision > 0;
  checks.push({
    id: "human_design_review",
    checked: designCandidate?.executed === true,
    status: designPassed
      ? "passed"
      : reviewer?.kind === "stand_in" || designCandidate?.executed !== true
        ? "unavailable"
        : "failed",
  });
  if (!designPassed)
    return reviewResult(
      reviewer?.kind === "stand_in" || designCandidate?.executed !== true
        ? "unavailable"
        : "failed",
      "design_review_required",
      checks,
    );
  return reviewResult("passed", undefined, checks);
}
