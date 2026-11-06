import { createHash } from "node:crypto";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema, ErrorObject } from "ajv";
import { parse as parseToml } from "smol-toml";

export interface RegistryEntry {
  kind:
    "item" | "block" | "sound_event" | "configured_feature" | "placed_feature";
  id: string;
}

export interface AssetValidationRequest {
  modId: string;
  namespace: string;
  metadataFile: string;
  targetPack: {
    id: string;
    revision: number;
    minecraftVersion: string;
    resourcePackFormat: number;
    dataPackFormat: number;
  };
  files: Record<string, string>;
  registry: RegistryEntry[];
  animations: Array<{ texture: string; frameCount: number }>;
  requiredLangKeys: string[];
  datagen: Array<{ path: string; expectedSha256: string }>;
}

export interface AssetValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type AssetValidationResult =
  | { status: "valid"; issues: [] }
  | { status: "invalid"; issues: AssetValidationIssue[] };

type JsonObject = Record<string, unknown>;

const requestSchema: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "modId",
    "namespace",
    "metadataFile",
    "targetPack",
    "files",
    "registry",
    "animations",
    "requiredLangKeys",
    "datagen",
  ],
  properties: {
    modId: { type: "string" },
    namespace: { type: "string" },
    metadataFile: { type: "string" },
    targetPack: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "revision",
        "minecraftVersion",
        "resourcePackFormat",
        "dataPackFormat",
      ],
      properties: {
        id: { type: "string" },
        revision: { type: "number" },
        minecraftVersion: { type: "string" },
        resourcePackFormat: { type: "number" },
        dataPackFormat: { type: "number" },
      },
    },
    files: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    registry: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "id"],
        properties: { kind: { type: "string" }, id: { type: "string" } },
      },
    },
    animations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["texture", "frameCount"],
        properties: {
          texture: { type: "string" },
          frameCount: { type: "number" },
        },
      },
    },
    requiredLangKeys: { type: "array", items: { type: "string" } },
    datagen: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "expectedSha256"],
        properties: {
          path: { type: "string" },
          expectedSha256: { type: "string" },
        },
      },
    },
  },
};

const validateRequest = new Ajv2020({
  allErrors: true,
  strict: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
}).compile(requestSchema);

const packFormats: Record<string, { resource: number; data: number }> = {
  "1.21": { resource: 34, data: 48 },
  "1.21.1": { resource: 34, data: 48 },
  "1.21.2": { resource: 42, data: 57 },
  "1.21.3": { resource: 42, data: 57 },
  "1.21.4": { resource: 46, data: 61 },
  "1.21.5": { resource: 55, data: 71 },
  "1.21.6": { resource: 63, data: 80 },
  "1.21.7": { resource: 64, data: 81 },
  "1.21.8": { resource: 64, data: 81 },
  "1.21.9": { resource: 69, data: 88 },
  "1.21.10": { resource: 69, data: 88 },
  "1.21.11": { resource: 75, data: 94.1 },
  "26.1": { resource: 84, data: 101.1 },
  "26.1.1": { resource: 84, data: 101.1 },
  "26.1.2": { resource: 84, data: 101.1 },
  "26.2": { resource: 88, data: 107.1 },
  "26.3": { resource: 97.1, data: 121 },
};
const registryKinds = new Set([
  "item",
  "block",
  "sound_event",
  "configured_feature",
  "placed_feature",
]);
const reservedMetadataNames = new Set(["constructor", "toString", "__proto__"]);
const namespacePattern = /^[a-z][a-z0-9_]{1,63}$/;
const idPattern = /^[a-z][a-z0-9_.-]*:[a-z0-9_./-]+$/;
const hashPattern = /^[0-9a-f]{64}$/;

function safeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.startsWith("/") &&
    !/^[A-Za-z]:/.test(path) &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function object(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestIssue(error: ErrorObject): AssetValidationIssue {
  const path = error.instancePath || "/";
  if (error.keyword === "required") {
    return {
      code: "required",
      path,
      message: `Missing ${String(error.params.missingProperty)}`,
    };
  }
  if (error.keyword === "additionalProperties") {
    return {
      code: "unknown_field",
      path,
      message: `Unknown ${String(error.params.additionalProperty)}`,
    };
  }
  return {
    code: "invalid_asset_request",
    path,
    message: error.message ?? "Invalid asset request",
  };
}

function parseIdentifier(
  id: string,
): { namespace: string; path: string } | undefined {
  if (!idPattern.test(id)) return undefined;
  const separator = id.indexOf(":");
  return { namespace: id.slice(0, separator), path: id.slice(separator + 1) };
}

function placeholders(value: string): string[] {
  const result: string[] = [];
  const pattern = /%(?:(\d+)\$)?([a-zA-Z%])/g;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    if (match[2] !== "%") result.push(match[2]!);
  }
  return result;
}

function numericVersion(value: string): number[] | undefined {
  if (!/^\d{1,4}(?:\.\d{1,4}){1,2}$/.test(value)) return undefined;
  const parts = value.split(".").map(Number);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function compareVersions(
  left: readonly number[],
  right: readonly number[],
): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

function minecraftRangeIncludes(range: unknown, target: string): boolean {
  if (typeof range !== "string" || range.length > 128) return false;
  const targetVersion = numericVersion(target);
  if (targetVersion === undefined) return false;
  const normalized = range.trim();
  if (normalized === target) return true;
  if (normalized.startsWith("~")) {
    const base = numericVersion(normalized.slice(1));
    if (base === undefined) return false;
    const nextMinor = [base[0]!, base[1]! + 1, 0];
    return (
      compareVersions(targetVersion, base) >= 0 &&
      compareVersions(targetVersion, nextMinor) < 0
    );
  }
  const singleton = /^\[(\d{1,4}(?:\.\d{1,4}){1,2})]$/.exec(normalized);
  if (singleton) {
    const required = numericVersion(singleton[1]!);
    return (
      required !== undefined && compareVersions(targetVersion, required) === 0
    );
  }
  const match =
    /^([[(])\s*(\d{1,4}(?:\.\d{1,4}){1,2})\s*,\s*(\d{1,4}(?:\.\d{1,4}){1,2})\s*([\])])$/.exec(
      normalized,
    );
  if (!match) return false;
  const lower = numericVersion(match[2]!);
  const upper = numericVersion(match[3]!);
  if (
    lower === undefined ||
    upper === undefined ||
    compareVersions(lower, upper) > 0
  )
    return false;
  const lowerComparison = compareVersions(targetVersion, lower);
  const upperComparison = compareVersions(targetVersion, upper);
  return (
    (lowerComparison > 0 || (lowerComparison === 0 && match[1] === "[")) &&
    (upperComparison < 0 || (upperComparison === 0 && match[4] === "]"))
  );
}

export function validateAssets(
  request: AssetValidationRequest,
): AssetValidationResult {
  const issues: AssetValidationIssue[] = [];
  const add = (code: string, path: string, message: string): void => {
    issues.push({ code, path: path || "/", message });
  };
  if (!validateRequest(request)) {
    for (const error of validateRequest.errors ?? [])
      issues.push(requestIssue(error));
    return finish();
  }

  const { files, namespace, modId } = request;
  if (!namespacePattern.test(namespace) || !namespacePattern.test(modId)) {
    add(
      "invalid_identifier",
      "/namespace",
      "Mod ID and namespace must be lowercase Minecraft identifiers",
    );
  }
  if (namespace !== modId) {
    add(
      "metadata_mod_id_mismatch",
      "/namespace",
      "Mod ID and namespace must agree",
    );
  }
  if (
    !Number.isInteger(request.targetPack.revision) ||
    request.targetPack.revision <= 0
  ) {
    add(
      "invalid_target_revision",
      "/targetPack/revision",
      "Target revision must be a positive integer",
    );
  }
  const expectedFormats = Object.hasOwn(
    packFormats,
    request.targetPack.minecraftVersion,
  )
    ? packFormats[request.targetPack.minecraftVersion]
    : undefined;
  if (expectedFormats === undefined) {
    add(
      "unsupported_minecraft_version",
      "/targetPack/minecraftVersion",
      `Unsupported Minecraft version ${request.targetPack.minecraftVersion}`,
    );
  } else if (
    request.targetPack.resourcePackFormat !== expectedFormats.resource ||
    request.targetPack.dataPackFormat !== expectedFormats.data
  ) {
    add(
      "pack_format_mismatch",
      "/targetPack",
      `Expected resource format ${expectedFormats.resource} and data format ${expectedFormats.data}`,
    );
  }

  const documents = new Map<string, JsonObject>();
  for (const [path, contents] of Object.entries(files)) {
    if (!safeRelativePath(path)) {
      add(
        "unsafe_asset_path",
        path || "/",
        "Asset path must be a normalized relative path",
      );
      continue;
    }
    const assetRoot = /^src\/main\/resources\/(assets|data)\/([^/]+)\//.exec(
      path,
    );
    if (assetRoot && assetRoot[2] !== namespace) {
      add(
        "namespace_mismatch",
        path,
        `Asset directory namespace ${assetRoot[2]} does not match ${namespace}`,
      );
    }
    if (path === request.metadataFile && path.endsWith(".toml")) {
      try {
        documents.set(
          path,
          parseToml(contents, {
            unsafeKeyBehaviour: "throw",
            maxDepth: 32,
          }),
        );
      } catch {
        add(
          "malformed_toml",
          path,
          "Mod metadata is not valid TOML or contains unsafe keys",
        );
      }
      continue;
    }
    if (!path.endsWith(".json") && !path.endsWith(".mcmeta")) {
      if (path === request.metadataFile) {
        add(
          "unsupported_mod_metadata",
          path,
          "Only Fabric JSON and NeoForge/Forge TOML metadata are supported",
        );
      }
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(contents);
      if (!object(parsed)) {
        add("invalid_json_document", path, "Asset JSON root must be an object");
      } else {
        documents.set(path, parsed);
      }
    } catch {
      add("malformed_json", path, "Asset file is not valid JSON");
    }
  }

  const checkId = (
    id: unknown,
    path: string,
    code = "invalid_identifier",
  ): { namespace: string; path: string } | undefined => {
    if (typeof id !== "string") {
      add(code, path, "Expected a resource identifier");
      return undefined;
    }
    const parsed = parseIdentifier(id);
    if (!parsed) {
      add("invalid_identifier", path, `Invalid resource identifier ${id}`);
      return undefined;
    }
    if (parsed.namespace !== "minecraft" && parsed.namespace !== namespace) {
      add(
        "namespace_mismatch",
        path,
        `Namespace ${parsed.namespace} does not match ${namespace}`,
      );
    }
    return parsed;
  };
  const registry = new Set<string>();
  for (const [index, entry] of request.registry.entries()) {
    const path = `/registry/${index}`;
    if (!object(entry)) continue;
    if (typeof entry.kind === "string" && !registryKinds.has(entry.kind)) {
      add(
        "unsupported_registry_kind",
        `${path}/kind`,
        "Unsupported registry kind",
      );
    }
    if (typeof entry.id !== "string") continue;
    checkId(entry.id, `${path}/id`);
    const key = `${entry.kind}:${entry.id}`;
    if (registry.has(key))
      add("duplicate_registry_id", `${path}/id`, `Duplicate ${key}`);
    registry.add(key);
  }
  const known = (kind: RegistryEntry["kind"], id: string): boolean =>
    parseIdentifier(id)?.namespace === "minecraft" ||
    registry.has(`${kind}:${id}`);

  const metadataPath = request.metadataFile;
  if (reservedMetadataNames.has(metadataPath)) {
    add(
      "invalid_metadata_file",
      "/metadataFile",
      "Metadata filename is reserved",
    );
  } else if (!safeRelativePath(metadataPath)) {
    add(
      "unsafe_asset_path",
      "/metadataFile",
      "Metadata path must be relative and normalized",
    );
  } else if (!Object.hasOwn(files, metadataPath)) {
    add("missing_mod_metadata", metadataPath, "Mod metadata file is missing");
  } else {
    const metadata = documents.get(metadataPath);
    if (metadata) {
      let id: unknown = metadata.id;
      let version: unknown = metadata.version;
      let name: unknown = metadata.name;
      let targetVersion: unknown = object(metadata.depends)
        ? metadata.depends.minecraft
        : undefined;
      let idPath = `${metadataPath}/id`;
      let versionPath = `${metadataPath}/version`;
      let namePath = `${metadataPath}/name`;
      let targetPath = `${metadataPath}/depends/minecraft`;
      if (metadataPath.endsWith(".toml")) {
        const mods = metadata.mods;
        const primary =
          Array.isArray(mods) && object(mods[0]) ? mods[0] : undefined;
        if (primary === undefined) {
          add(
            "invalid_mod_metadata",
            `${metadataPath}/mods/0`,
            "TOML metadata requires a primary mods entry",
          );
        }
        id = primary?.modId;
        version = primary?.version;
        name = primary?.displayName;
        idPath = `${metadataPath}/mods/0/modId`;
        versionPath = `${metadataPath}/mods/0/version`;
        namePath = `${metadataPath}/mods/0/displayName`;
        const dependencies = metadata.dependencies;
        const dependencyEntry =
          object(dependencies) && Object.hasOwn(dependencies, modId)
            ? dependencies[modId]
            : undefined;
        const dependencyCandidates = Array.isArray(dependencyEntry)
          ? dependencyEntry
          : [dependencyEntry];
        const dependency = dependencyCandidates.find(
          (candidate) => object(candidate) && candidate.modId === "minecraft",
        );
        targetVersion = object(dependency)
          ? dependency.versionRange
          : undefined;
        targetPath = `${metadataPath}/dependencies/${modId}/versionRange`;
      }
      if (id !== modId) {
        add(
          "metadata_mod_id_mismatch",
          idPath,
          "Metadata mod ID does not match the request",
        );
      }
      if (typeof version !== "string" || version.trim() === "") {
        add(
          metadataPath.endsWith(".toml")
            ? "metadata_version_invalid"
            : "invalid_mod_metadata",
          versionPath,
          "Metadata requires an exact version",
        );
      }
      if (typeof name !== "string" || name.trim() === "") {
        add(
          metadataPath.endsWith(".toml")
            ? "metadata_name_missing"
            : "invalid_mod_metadata",
          namePath,
          "Metadata requires a display name",
        );
      }
      if (
        !minecraftRangeIncludes(
          targetVersion,
          request.targetPack.minecraftVersion,
        )
      ) {
        add(
          "metadata_target_mismatch",
          targetPath,
          "Metadata Minecraft dependency must include the exact target",
        );
      }
    }
  }

  const modelPath = (id: string): string | undefined => {
    const parsed = parseIdentifier(id);
    return parsed
      ? `src/main/resources/assets/${parsed.namespace}/models/${parsed.path}.json`
      : undefined;
  };
  const texturePath = (id: string): string | undefined => {
    const parsed = parseIdentifier(id);
    return parsed
      ? `src/main/resources/assets/${parsed.namespace}/textures/${parsed.path}.png`
      : undefined;
  };
  const modelFiles = new Map<string, string>();
  for (const path of documents.keys()) {
    const match =
      /^src\/main\/resources\/assets\/([^/]+)\/models\/(.+)\.json$/.exec(path);
    if (match) modelFiles.set(`${match[1]}:${match[2]}`, path);
  }

  const modelParents = new Map<string, string>();
  for (const [path, blockstate] of documents) {
    if (
      !/^src\/main\/resources\/assets\/[^/]+\/blockstates\/.+\.json$/.test(path)
    )
      continue;
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
      } else if (object(value)) {
        if (typeof value.model === "string") {
          const reference = checkId(
            value.model,
            `${path}/model`,
            "missing_model_reference",
          );
          const target = reference && modelPath(value.model);
          if (
            reference?.namespace !== "minecraft" &&
            target &&
            !documents.has(target)
          ) {
            add(
              "missing_model_reference",
              `${path}/model`,
              `Missing model ${value.model}`,
            );
          }
        }
        for (const child of Object.values(value)) visit(child);
      }
    };
    visit(blockstate.variants);
    visit(blockstate.multipart);
  }

  for (const [id, path] of modelFiles) {
    const model = documents.get(path)!;
    if (model.parent !== undefined) {
      const parent = checkId(
        model.parent,
        `${path}/parent`,
        "missing_model_parent",
      );
      if (parent) {
        modelParents.set(
          id,
          parent.namespace === "minecraft"
            ? `minecraft:${parent.path}`
            : `${parent.namespace}:${parent.path}`,
        );
        if (
          parent.namespace !== "minecraft" &&
          !modelFiles.has(`${parent.namespace}:${parent.path}`)
        ) {
          add(
            "missing_model_parent",
            `${path}/parent`,
            `Missing parent model ${String(model.parent)}`,
          );
        }
      }
    }
    const inheritedTextures = (start: string): Record<string, string> => {
      const chain: string[] = [];
      const seen = new Set<string>();
      let current: string | undefined = start;
      while (current && modelFiles.has(current) && !seen.has(current)) {
        seen.add(current);
        chain.push(current);
        current = modelParents.get(current);
      }
      const result: Record<string, string> = {};
      for (const modelId of chain.reverse()) {
        const textures = documents.get(modelFiles.get(modelId)!)?.textures;
        if (object(textures)) {
          for (const [key, value] of Object.entries(textures)) {
            if (typeof value === "string") result[key] = value;
          }
        }
      }
      return result;
    };
    const variables = inheritedTextures(id);
    const textures = object(model.textures) ? model.textures : {};
    for (const [key, raw] of Object.entries(textures)) {
      if (typeof raw !== "string") {
        add(
          "invalid_texture_reference",
          `${path}/textures/${key}`,
          "Texture variable must be a string",
        );
        continue;
      }
      let value = raw;
      const visitedVariables = new Set<string>();
      while (value.startsWith("#")) {
        const variable = value.slice(1);
        if (
          visitedVariables.has(variable) ||
          typeof variables[variable] !== "string"
        ) {
          add(
            "invalid_texture_reference",
            `${path}/textures/${key}`,
            `Unresolved texture variable ${value}`,
          );
          break;
        }
        visitedVariables.add(variable);
        value = variables[variable];
      }
      if (value.startsWith("#")) continue;
      const reference = checkId(
        value,
        `${path}/textures/${key}`,
        "missing_texture_reference",
      );
      const target = reference && texturePath(value);
      if (
        reference?.namespace !== "minecraft" &&
        target &&
        !Object.hasOwn(files, target)
      ) {
        add(
          "missing_texture_reference",
          `${path}/textures/${key}`,
          `Missing texture ${value}`,
        );
      }
    }

    if (model.overrides !== undefined) {
      if (!Array.isArray(model.overrides)) {
        add(
          "invalid_model_override",
          `${path}/overrides`,
          "Model overrides must be an array",
        );
      } else {
        for (const [index, override] of model.overrides.entries()) {
          if (!object(override)) {
            add(
              "invalid_model_override",
              `${path}/overrides/${index}`,
              "Override must be an object",
            );
            continue;
          }
          const target = checkId(
            override.model,
            `${path}/overrides/${index}/model`,
            "missing_override_model",
          );
          const targetPath =
            typeof override.model === "string"
              ? modelPath(override.model)
              : undefined;
          if (
            target?.namespace !== "minecraft" &&
            targetPath &&
            !documents.has(targetPath)
          ) {
            add(
              "missing_override_model",
              `${path}/overrides/${index}/model`,
              `Missing override model ${String(override.model)}`,
            );
          }
          if (object(override.predicate)) {
            for (const predicate of Object.keys(override.predicate))
              checkId(predicate, `${path}/overrides/${index}/predicate`);
          }
        }
      }
    }

    if (model.display !== undefined) {
      if (!object(model.display)) {
        add(
          "invalid_display_transform",
          `${path}/display`,
          "Display transforms must be an object",
        );
      } else {
        for (const [transformName, transform] of Object.entries(
          model.display,
        )) {
          if (!object(transform)) {
            add(
              "invalid_display_transform",
              `${path}/display/${transformName}`,
              "Display transform must be an object",
            );
            continue;
          }
          for (const field of ["rotation", "translation", "scale"] as const) {
            const vector = transform[field];
            if (vector === undefined) continue;
            const validVector =
              Array.isArray(vector) &&
              vector.length === 3 &&
              vector.every(
                (component) =>
                  typeof component === "number" && Number.isFinite(component),
              );
            let valid = validVector;
            if (validVector && field === "rotation")
              valid = vector.every((component) => Math.abs(component) <= 45);
            if (validVector && field === "translation")
              valid = vector.every((component) => Math.abs(component) <= 80);
            if (validVector && field === "scale")
              valid = vector.every(
                (component) => component !== 0 && Math.abs(component) <= 4,
              );
            if (!valid)
              add(
                "invalid_display_transform",
                `${path}/display/${transformName}/${field}`,
                `${field} must contain three finite in-range components`,
              );
          }
        }
      }
    }
  }

  for (const [id, parent] of modelParents) {
    const seen = new Set<string>([id]);
    let current: string | undefined = parent;
    while (current && current.split(":")[0] !== "minecraft") {
      if (seen.has(current)) {
        add(
          "model_parent_cycle",
          modelFiles.get(id) ?? id,
          `Model parent cycle includes ${current}`,
        );
        break;
      }
      seen.add(current);
      current = modelParents.get(current);
    }
  }

  for (const [index, animation] of request.animations.entries()) {
    const base = `/animations/${index}`;
    if (!object(animation)) continue;
    if (!safeRelativePath(animation.texture)) {
      add(
        "unsafe_asset_path",
        `${base}/texture`,
        "Animation texture path must be relative and normalized",
      );
      continue;
    }
    if (!Object.hasOwn(files, animation.texture)) {
      add(
        "missing_texture_reference",
        `${base}/texture`,
        "Animated texture is missing",
      );
    }
    if (!Number.isInteger(animation.frameCount) || animation.frameCount <= 0) {
      add(
        "invalid_animation_reference",
        `${base}/frameCount`,
        "Frame count must be a positive integer",
      );
    }
    const metadata = documents.get(`${animation.texture}.mcmeta`);
    if (!metadata) {
      add(
        "missing_animation_metadata",
        `${animation.texture}.mcmeta`,
        "Animated texture requires an mcmeta sidecar",
      );
      continue;
    }
    const definition = metadata.animation;
    if (
      !object(definition) ||
      !Number.isInteger(definition.frametime) ||
      (definition.frametime as number) <= 0
    ) {
      add(
        "invalid_animation_reference",
        `${animation.texture}.mcmeta/animation`,
        "Animation requires a positive integer frametime",
      );
      continue;
    }
    if (definition.frames !== undefined) {
      if (!Array.isArray(definition.frames)) {
        add(
          "invalid_animation_reference",
          `${animation.texture}.mcmeta/animation/frames`,
          "Animation frames must be an array",
        );
      } else {
        definition.frames.forEach((frame, frameIndex) => {
          const frameNumber =
            typeof frame === "number"
              ? frame
              : object(frame)
                ? frame.index
                : undefined;
          const time =
            object(frame) && Object.hasOwn(frame, "time") ? frame.time : 1;
          if (
            typeof frameNumber !== "number" ||
            !Number.isInteger(frameNumber) ||
            frameNumber < 0 ||
            frameNumber >= animation.frameCount ||
            !Number.isInteger(time) ||
            (time as number) <= 0
          ) {
            add(
              "invalid_animation_reference",
              `${animation.texture}.mcmeta/animation/frames/${frameIndex}`,
              "Frame index or time is outside the declared animation",
            );
          }
        });
      }
    }
  }

  const langFiles = [...documents.entries()]
    .filter(([path]) =>
      /^src\/main\/resources\/assets\/[^/]+\/lang\/[^/]+\.json$/.test(path),
    )
    .sort(([left], [right]) => left.localeCompare(right));
  const baselinePath =
    langFiles.find(([path]) => path.endsWith("/en_us.json"))?.[0] ??
    langFiles[0]?.[0];
  const baseline = baselinePath ? documents.get(baselinePath) : undefined;
  for (const [path, lang] of langFiles) {
    for (const key of request.requiredLangKeys) {
      if (typeof lang[key] !== "string")
        add(
          "missing_lang_key",
          `${path}/${key}`,
          `Required lang key ${key} is missing`,
        );
    }
    for (const [key, value] of Object.entries(lang)) {
      if (typeof value !== "string") {
        add(
          "invalid_lang_value",
          `${path}/${key}`,
          "Lang values must be strings",
        );
        continue;
      }
      const reference = baseline?.[key];
      if (
        typeof reference === "string" &&
        placeholders(reference).join("\0") !== placeholders(value).join("\0")
      ) {
        add(
          "lang_placeholder_mismatch",
          `${path}/${key}`,
          "Ordered printf placeholders must match the baseline locale",
        );
      }
    }
  }
  if (!baseline) {
    for (const key of request.requiredLangKeys)
      add(
        "missing_lang_key",
        `/requiredLangKeys/${key}`,
        "No locale declares the required key",
      );
  }

  const itemReferences = (
    value: unknown,
    visit: (id: string) => void,
  ): void => {
    if (typeof value === "string") {
      if (!value.startsWith("#")) visit(value);
    } else if (Array.isArray(value)) {
      for (const child of value) itemReferences(child, visit);
    } else if (object(value)) {
      if (typeof value.item === "string") visit(value.item);
      else if (typeof value.id === "string") visit(value.id);
      else
        for (const child of Object.values(value)) itemReferences(child, visit);
    }
  };
  for (const [path, recipe] of documents) {
    if (!/^src\/main\/resources\/data\/[^/]+\/recipes\/.+\.json$/.test(path))
      continue;
    const checkRecipeId = (id: string): void => {
      checkId(id, path, "unknown_recipe_reference");
      if (!known("item", id) && !known("block", id))
        add("unknown_recipe_reference", path, `Unknown recipe item ${id}`);
    };
    itemReferences(recipe.result, checkRecipeId);
    itemReferences(recipe.key, checkRecipeId);
    itemReferences(recipe.ingredients, checkRecipeId);
    itemReferences(recipe.ingredient, checkRecipeId);
  }

  for (const [path, loot] of documents) {
    if (!/^src\/main\/resources\/data\/[^/]+\/loot_table\/.+\.json$/.test(path))
      continue;
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
      } else if (object(value)) {
        if (value.type === "minecraft:item" && typeof value.name === "string") {
          checkId(value.name, path, "unknown_loot_reference");
          if (!known("item", value.name) && !known("block", value.name))
            add(
              "unknown_loot_reference",
              path,
              `Unknown loot item ${value.name}`,
            );
        }
        for (const child of Object.values(value)) visit(child);
      }
    };
    visit(loot.pools);
  }

  for (const [path, tag] of documents) {
    if (
      !/^src\/main\/resources\/data\/[^/]+\/tags\/(items|blocks)\/.+\.json$/.test(
        path,
      )
    )
      continue;
    if (!Array.isArray(tag.values)) {
      add("invalid_tag", `${path}/values`, "Tag values must be an array");
      continue;
    }
    const kind = path.includes("/tags/items/") ? "item" : "block";
    for (const value of tag.values) {
      const id =
        typeof value === "string"
          ? value
          : object(value) && typeof value.id === "string"
            ? value.id
            : undefined;
      if (id === undefined) {
        add("unknown_tag_entry", `${path}/values`, "Tag entry requires an ID");
        continue;
      }
      if (id.startsWith("#")) {
        checkId(id.slice(1), `${path}/values`);
      } else {
        checkId(id, `${path}/values`, "unknown_tag_entry");
        if (!known(kind, id))
          add("unknown_tag_entry", `${path}/values`, `Unknown tag entry ${id}`);
      }
    }
  }

  for (const [path, feature] of documents) {
    if (
      /^src\/main\/resources\/data\/[^/]+\/worldgen\/configured_feature\/.+\.json$/.test(
        path,
      )
    ) {
      const visitStates = (value: unknown): void => {
        if (Array.isArray(value)) {
          for (const child of value) visitStates(child);
        } else if (object(value)) {
          if (typeof value.Name === "string") {
            checkId(
              value.Name,
              `${path}/config/state/Name`,
              "unknown_worldgen_block",
            );
            if (!known("block", value.Name))
              add(
                "unknown_worldgen_block",
                `${path}/config/state/Name`,
                `Unknown worldgen block ${value.Name}`,
              );
          }
          for (const child of Object.values(value)) visitStates(child);
        }
      };
      visitStates(feature.config);
    }
    if (
      /^src\/main\/resources\/data\/[^/]+\/worldgen\/placed_feature\/.+\.json$/.test(
        path,
      )
    ) {
      if (typeof feature.feature === "string") {
        checkId(
          feature.feature,
          `${path}/feature`,
          "unknown_configured_feature",
        );
        if (!known("configured_feature", feature.feature))
          add(
            "unknown_configured_feature",
            `${path}/feature`,
            `Unknown configured feature ${feature.feature}`,
          );
      }
    }
  }

  for (const [path, sounds] of documents) {
    const match = /^src\/main\/resources\/assets\/([^/]+)\/sounds\.json$/.exec(
      path,
    );
    if (!match) continue;
    for (const [eventName, definition] of Object.entries(sounds)) {
      const eventId = `${match[1]}:${eventName}`;
      checkId(eventId, `${path}/${eventName}`, "unknown_sound_event");
      if (!known("sound_event", eventId))
        add(
          "unknown_sound_event",
          `${path}/${eventName}`,
          `Sound event ${eventId} is not registered`,
        );
      if (!object(definition) || !Array.isArray(definition.sounds)) {
        add(
          "invalid_sound_event",
          `${path}/${eventName}/sounds`,
          "Sound event requires a sounds array",
        );
        continue;
      }
      for (const sound of definition.sounds) {
        const name =
          typeof sound === "string"
            ? sound
            : object(sound) && typeof sound.name === "string"
              ? sound.name
              : undefined;
        if (name === undefined) {
          add(
            "invalid_sound_event",
            `${path}/${eventName}/sounds`,
            "Sound entry requires a name",
          );
          continue;
        }
        const reference = checkId(name, `${path}/${eventName}/sounds`);
        if (object(sound) && sound.type === "event") {
          if (!known("sound_event", name))
            add(
              "unknown_sound_event",
              `${path}/${eventName}/sounds`,
              `Unknown referenced sound event ${name}`,
            );
        } else if (reference?.namespace !== "minecraft" && reference) {
          const soundPath = `src/main/resources/assets/${reference.namespace}/sounds/${reference.path}.ogg`;
          if (!Object.hasOwn(files, soundPath))
            add(
              "missing_sound_file",
              soundPath,
              `Missing sound file for ${name}`,
            );
        }
      }
    }
  }

  for (const [index, generated] of request.datagen.entries()) {
    if (!object(generated)) continue;
    const path = generated.path;
    if (!safeRelativePath(path)) {
      add(
        "unsafe_asset_path",
        `/datagen/${index}/path`,
        "Datagen path must be relative and normalized",
      );
    } else if (!hashPattern.test(generated.expectedSha256)) {
      add(
        "invalid_sha256",
        `/datagen/${index}/expectedSha256`,
        "Expected datagen hash must be lowercase SHA-256",
      );
    } else {
      const contents = Object.hasOwn(files, path) ? files[path] : undefined;
      if (
        contents === undefined ||
        createHash("sha256").update(contents).digest("hex") !==
          generated.expectedSha256
      ) {
        add(
          "stale_datagen_output",
          path,
          "Generated output is missing or does not match its immutable hash",
        );
      }
    }
  }

  return finish();

  function finish(): AssetValidationResult {
    const unique = new Map<string, AssetValidationIssue>();
    for (const item of issues)
      unique.set(`${item.path}\0${item.code}\0${item.message}`, item);
    const sorted = [...unique.values()].sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.code.localeCompare(right.code) ||
        left.message.localeCompare(right.message),
    );
    return sorted.length === 0
      ? { status: "valid", issues: [] }
      : { status: "invalid", issues: sorted };
  }
}
