import { createHash } from "node:crypto";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema, ErrorObject } from "ajv";

export interface AssetIssue {
  code: string;
  path: string;
  message: string;
}

export type AssetManifestResult =
  { status: "valid"; issues: [] } | { status: "invalid"; issues: AssetIssue[] };

export type AssetKind = "java_block_item" | "modded_entity";
export type EditableFormat = "bbmodel" | "json" | "png" | "java";
export type RuntimeFormat =
  | "java_model_json"
  | "java"
  | "geckolib_geometry_json"
  | "geckolib_animation_json"
  | "png";

export interface AssetManifestInput {
  schemaVersion: "asset-manifest-1.0.0";
  targetPackId: string;
  targetPackRevision: number;
  targetFormats: { resourcePack: number; dataPack: number };
  visualScenarioIds: string[];
  assets: Array<{
    id: string;
    kind: AssetKind;
    editableSource: {
      path: string;
      format: EditableFormat;
      bytes: string | Uint8Array;
    };
    exports: Array<{
      path: string;
      format: RuntimeFormat;
      bytes: string | Uint8Array;
    }>;
    generation: {
      route: string;
      prompt?: string;
      model?: string;
      seed?: number;
    };
    blockbench?: {
      projectFormat: AssetKind;
      applicationVersion: string;
      exportSettings: Record<string, unknown>;
    };
    provenance: Array<{
      sourceUrl: string;
      author: string;
      license: string;
      modifications: string;
      notices: string[];
    }>;
  }>;
}

export interface AssetManifest {
  schemaVersion: "asset-manifest-1.0.0";
  targetPackId: string;
  targetPackRevision: number;
  targetFormats: { resourcePack: number; dataPack: number };
  visualScenarioIds: string[];
  assets: Array<{
    id: string;
    kind: AssetKind;
    editableSource: { path: string; format: EditableFormat; sha256: string };
    exports: Array<{ path: string; format: RuntimeFormat; sha256: string }>;
    generation: {
      route: string;
      prompt?: string;
      model?: string;
      seed?: number;
    };
    blockbench?: {
      projectFormat: AssetKind;
      applicationVersion: string;
      exportSettings: Record<string, unknown>;
    };
    provenance: Array<{
      sourceUrl: string;
      author: string;
      license: string;
      modifications: string;
      notices: string[];
    }>;
  }>;
}

export interface RecordAssetExportRequest {
  assetId: string;
  path: string;
  format: RuntimeFormat;
  bytes: string | Uint8Array;
}

export type RecordAssetExportResult =
  | { status: "recorded"; manifest: AssetManifest; issues: [] }
  | { status: "invalid"; issues: AssetIssue[]; manifest?: undefined };

const schema: AnySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "targetPackId",
    "targetPackRevision",
    "targetFormats",
    "visualScenarioIds",
    "assets",
  ],
  properties: {
    schemaVersion: { type: "string" },
    targetPackId: { type: "string" },
    targetPackRevision: { type: "number" },
    targetFormats: {
      type: "object",
      additionalProperties: false,
      required: ["resourcePack", "dataPack"],
      properties: {
        resourcePack: { type: "number" },
        dataPack: { type: "number" },
      },
    },
    visualScenarioIds: { type: "array", items: { type: "string" } },
    assets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "kind",
          "editableSource",
          "exports",
          "generation",
          "provenance",
        ],
        properties: {
          id: { type: "string" },
          kind: { type: "string" },
          editableSource: {
            type: "object",
            additionalProperties: false,
            required: ["path", "format", "sha256"],
            properties: {
              path: { type: "string" },
              format: { type: "string" },
              sha256: { type: "string" },
            },
          },
          exports: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["path", "format", "sha256"],
              properties: {
                path: { type: "string" },
                format: { type: "string" },
                sha256: { type: "string" },
              },
            },
          },
          generation: {
            type: "object",
            additionalProperties: false,
            required: ["route"],
            properties: {
              route: { type: "string" },
              prompt: { type: "string" },
              model: { type: "string" },
              seed: { type: "number" },
            },
            allOf: [
              {
                if: {
                  properties: {
                    route: { enum: ["host_ai", "fal", "comfyui_unfake"] },
                  },
                  required: ["route"],
                },
                then: {
                  required: ["prompt", "model", "seed"],
                  properties: {
                    prompt: { type: "string" },
                    model: { type: "string" },
                    seed: { type: "number" },
                  },
                },
              },
            ],
          },
          blockbench: {
            type: "object",
            additionalProperties: false,
            required: ["projectFormat", "applicationVersion", "exportSettings"],
            properties: {
              projectFormat: { type: "string" },
              applicationVersion: { type: "string" },
              exportSettings: { type: "object" },
            },
          },
          provenance: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "sourceUrl",
                "author",
                "license",
                "modifications",
                "notices",
              ],
              properties: {
                sourceUrl: { type: "string" },
                author: { type: "string" },
                license: { type: "string" },
                modifications: { type: "string" },
                notices: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    },
  },
};

const validateShape = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
}).compile(schema);

const routes = new Set([
  "manual",
  "mc_asset",
  "host_ai",
  "fal",
  "comfyui_unfake",
  "blockbench",
  "direct_json",
  "direct_png",
  "direct_java",
]);
const aiRoutes = new Set(["host_ai", "fal", "comfyui_unfake"]);
const editableFormats = new Set(["bbmodel", "json", "png", "java"]);
const javaExports = new Set(["java_model_json", "java", "png"]);
const entityExports = new Set([
  "geckolib_geometry_json",
  "geckolib_animation_json",
  "png",
]);
const emptyExports = new Set<string>();
const runtimeExports = new Set([...javaExports, ...entityExports]);
const directRoutes = new Set(["direct_json", "direct_png", "direct_java"]);
const directFormats: Record<
  string,
  { readonly source: string; readonly exported: string }
> = {
  direct_json: { source: "json", exported: "java_model_json" },
  direct_png: { source: "png", exported: "png" },
  direct_java: { source: "java", exported: "java" },
};
const identifier = /^[a-z][a-z0-9_]{0,63}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const exactVersion = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

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

function issue(code: string, path: string, message: string): AssetIssue {
  return { code, path, message };
}

function shapeIssue(error: ErrorObject): AssetIssue {
  const path = error.instancePath || "/";
  if (error.keyword === "additionalProperties") {
    const property = Object.hasOwn(error.params, "additionalProperty")
      ? String(error.params.additionalProperty)
      : "unknown";
    return issue("unknown_field", path, `Unknown field ${property}`);
  }
  if (error.keyword === "required") {
    const property = Object.hasOwn(error.params, "missingProperty")
      ? String(error.params.missingProperty)
      : "unknown";
    return issue("required", path, `Missing required field ${property}`);
  }
  if (error.keyword === "type") {
    return issue("type", path, error.message ?? "Invalid manifest value type");
  }
  return issue(
    "invalid_manifest_shape",
    path,
    error.message ?? "Invalid manifest shape",
  );
}

function finish(issues: AssetIssue[]): AssetManifestResult {
  const unique = new Map<string, AssetIssue>();
  for (const item of issues) {
    unique.set(`${item.path}\0${item.code}\0${item.message}`, item);
  }
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

export function createAssetManifest(input: AssetManifestInput): AssetManifest {
  const manifest = structuredClone(input) as unknown as AssetManifest;
  for (const asset of manifest.assets) {
    const source = asset.editableSource as unknown as {
      bytes?: string | Uint8Array;
      sha256: string;
    };
    source.sha256 = sha256(source.bytes!);
    delete source.bytes;
    for (const exported of asset.exports) {
      const value = exported as unknown as {
        bytes?: string | Uint8Array;
        sha256: string;
      };
      value.sha256 = sha256(value.bytes!);
      delete value.bytes;
    }
  }
  return manifest;
}

export function recordAssetExport(
  manifest: AssetManifest,
  request: RecordAssetExportRequest,
): RecordAssetExportResult {
  const current = validateAssetManifest(manifest);
  if (current.status === "invalid") return current;

  const asset = manifest.assets.find(
    (candidate) => candidate.id === request.assetId,
  );
  const exported = asset?.exports.find(
    (candidate) =>
      candidate.path === request.path && candidate.format === request.format,
  );
  if (!asset || !exported || !safeRelativePath(request.path)) {
    return {
      status: "invalid",
      issues: [
        issue(
          "unknown_asset_export",
          "/assets",
          "Export must name a known asset, declared path, and matching format",
        ),
      ],
    };
  }

  const next = structuredClone(manifest);
  const nextAsset = next.assets.find(
    (candidate) => candidate.id === request.assetId,
  )!;
  const nextExport = nextAsset.exports.find(
    (candidate) =>
      candidate.path === request.path && candidate.format === request.format,
  )!;
  nextExport.sha256 = sha256(request.bytes);
  return { status: "recorded", manifest: next, issues: [] };
}

export function validateAssetManifest(manifest: unknown): AssetManifestResult {
  const issues: AssetIssue[] = [];
  if (!validateShape(manifest)) {
    issues.push(...(validateShape.errors ?? []).map(shapeIssue));
    return finish(issues);
  }
  const root = manifest as Partial<AssetManifest>;

  if (root.schemaVersion !== "asset-manifest-1.0.0") {
    issues.push(
      issue(
        "invalid_schema_version",
        "/schemaVersion",
        "Unsupported manifest schema",
      ),
    );
  }
  if (
    typeof root.targetPackId === "string" &&
    !/^[a-z0-9][a-z0-9.-]*-r\d+$/.test(root.targetPackId)
  ) {
    issues.push(
      issue(
        "invalid_target_pack_id",
        "/targetPackId",
        "Invalid exact target pack ID",
      ),
    );
  }
  if (
    typeof root.targetPackRevision === "number" &&
    (!Number.isInteger(root.targetPackRevision) || root.targetPackRevision <= 0)
  ) {
    issues.push(
      issue(
        "invalid_target_revision",
        "/targetPackRevision",
        "Revision must be a positive integer",
      ),
    );
  }
  if (root.targetFormats) {
    for (const field of ["resourcePack", "dataPack"] as const) {
      const value = root.targetFormats[field];
      if (
        typeof value === "number" &&
        (!Number.isFinite(value) || value <= 0)
      ) {
        issues.push(
          issue(
            "invalid_target_format",
            `/targetFormats/${field}`,
            "Pack format must be positive",
          ),
        );
      }
    }
  }

  const scenarios = new Set<string>();
  if (Array.isArray(root.visualScenarioIds)) {
    root.visualScenarioIds.forEach((id, index) => {
      if (typeof id !== "string") return;
      if (!identifier.test(id)) {
        issues.push(
          issue(
            "invalid_scenario_id",
            `/visualScenarioIds/${index}`,
            "Invalid visual scenario ID",
          ),
        );
      }
      if (scenarios.has(id)) {
        issues.push(
          issue(
            "duplicate_scenario_id",
            `/visualScenarioIds/${index}`,
            "Duplicate visual scenario ID",
          ),
        );
      }
      scenarios.add(id);
    });
  }

  if (!Array.isArray(root.assets)) return finish(issues);
  if (root.assets.length === 0) {
    issues.push(
      issue("missing_asset", "/assets", "Manifest requires at least one asset"),
    );
  }
  const assetIds = new Set<string>();
  root.assets.forEach((asset, assetIndex) => {
    if (typeof asset !== "object" || asset === null) return;
    const base = `/assets/${assetIndex}`;
    if (typeof asset.id === "string") {
      if (!identifier.test(asset.id)) {
        issues.push(
          issue("invalid_asset_id", `${base}/id`, "Invalid stable asset ID"),
        );
      }
      if (assetIds.has(asset.id)) {
        issues.push(
          issue("duplicate_asset_id", `${base}/id`, "Duplicate asset ID"),
        );
      }
      assetIds.add(asset.id);
    }

    const source = asset.editableSource;
    if (source && typeof source === "object") {
      if (typeof source.path === "string" && !safeRelativePath(source.path)) {
        issues.push(
          issue(
            "unsafe_asset_path",
            `${base}/editableSource/path`,
            "Asset paths must be safe relative paths",
          ),
        );
      }
      if (
        typeof source.format === "string" &&
        !editableFormats.has(source.format)
      ) {
        issues.push(
          issue(
            "unsupported_editable_format",
            `${base}/editableSource/format`,
            "Unsupported editable source format",
          ),
        );
      }
      if (
        typeof source.sha256 === "string" &&
        !hashPattern.test(source.sha256)
      ) {
        issues.push(
          issue(
            "invalid_sha256",
            `${base}/editableSource/sha256`,
            "SHA-256 must be 64 lowercase hexadecimal characters",
          ),
        );
      }
    }

    if (!Array.isArray(asset.exports) || asset.exports.length === 0) {
      issues.push(
        issue(
          "missing_runtime_export",
          `${base}/exports`,
          "At least one runtime export is required",
        ),
      );
    }
    const exportPaths = new Set<string>();
    if (Array.isArray(asset.exports)) {
      asset.exports.forEach((exported, exportIndex) => {
        if (typeof exported !== "object" || exported === null) return;
        const path = `${base}/exports/${exportIndex}`;
        if (typeof exported.path === "string") {
          if (!safeRelativePath(exported.path)) {
            issues.push(
              issue(
                "unsafe_asset_path",
                `${path}/path`,
                "Asset paths must be safe relative paths",
              ),
            );
          }
          if (exportPaths.has(exported.path)) {
            issues.push(
              issue(
                "duplicate_export_path",
                `${path}/path`,
                "Duplicate runtime export path",
              ),
            );
          }
          exportPaths.add(exported.path);
        }
        if (
          typeof exported.sha256 === "string" &&
          !hashPattern.test(exported.sha256)
        ) {
          issues.push(
            issue(
              "invalid_sha256",
              `${path}/sha256`,
              "SHA-256 must be 64 lowercase hexadecimal characters",
            ),
          );
        }
        const allowed =
          asset.kind === "java_block_item"
            ? javaExports
            : asset.kind === "modded_entity"
              ? entityExports
              : emptyExports;
        if (
          typeof exported.format === "string" &&
          !runtimeExports.has(exported.format)
        ) {
          issues.push(
            issue(
              "unsupported_export_format",
              `${path}/format`,
              "Unsupported runtime export format",
            ),
          );
        } else if (
          typeof exported.format === "string" &&
          !allowed.has(exported.format)
        ) {
          issues.push(
            issue(
              "incompatible_asset_format",
              `${path}/format`,
              "Export format is incompatible with the asset kind",
            ),
          );
        }
      });
    }

    if (asset.kind !== "java_block_item" && asset.kind !== "modded_entity") {
      issues.push(
        issue(
          "incompatible_asset_format",
          `${base}/kind`,
          "Unsupported asset kind",
        ),
      );
    }
    const route = asset.generation?.route;
    if (asset.blockbench === undefined && !directRoutes.has(route)) {
      issues.push(
        issue(
          "required",
          `${base}/blockbench`,
          "Blockbench metadata is required for this generation route",
        ),
      );
    }
    if (directRoutes.has(route) && Object.hasOwn(directFormats, route)) {
      const expected = directFormats[route]!;
      if (asset.editableSource.format !== expected.source) {
        issues.push(
          issue(
            "incompatible_asset_format",
            `${base}/editableSource/format`,
            "Editable source format does not match the direct route",
          ),
        );
      }
      for (const [exportIndex, exported] of asset.exports.entries()) {
        if (exported.format !== expected.exported) {
          issues.push(
            issue(
              "incompatible_asset_format",
              `${base}/exports/${exportIndex}/format`,
              "Runtime export format does not match the direct route",
            ),
          );
        }
      }
    }
    if (asset.blockbench && typeof asset.blockbench === "object") {
      if (asset.blockbench.projectFormat !== asset.kind) {
        issues.push(
          issue(
            "incompatible_asset_format",
            `${base}/blockbench/projectFormat`,
            "Blockbench project format must match the asset kind",
          ),
        );
      }
      if (
        typeof asset.blockbench.applicationVersion === "string" &&
        !exactVersion.test(asset.blockbench.applicationVersion)
      ) {
        issues.push(
          issue(
            "non_exact_blockbench_version",
            `${base}/blockbench/applicationVersion`,
            "Blockbench version must be exact",
          ),
        );
      }
    }

    if (asset.generation && typeof asset.generation === "object") {
      const generation = asset.generation;
      if (
        typeof generation.route === "string" &&
        !routes.has(generation.route)
      ) {
        issues.push(
          issue(
            "unsupported_generation_route",
            `${base}/generation/route`,
            "Unsupported generation route",
          ),
        );
      }
      if (
        typeof generation.seed === "number" &&
        !Number.isInteger(generation.seed)
      ) {
        issues.push(
          issue(
            "invalid_generation_seed",
            `${base}/generation/seed`,
            "Generation seed must be an integer",
          ),
        );
      }
      if (aiRoutes.has(generation.route)) {
        for (const field of ["prompt", "model"] as const) {
          if (
            typeof generation[field] === "string" &&
            generation[field].trim() === ""
          ) {
            issues.push(
              issue(
                "required",
                `${base}/generation/${field}`,
                "AI generation metadata cannot be empty",
              ),
            );
          }
        }
      }
    }

    if (!Array.isArray(asset.provenance) || asset.provenance.length === 0) {
      issues.push(
        issue(
          "required",
          `${base}/provenance`,
          "At least one provenance record is required",
        ),
      );
    }
    if (Array.isArray(asset.provenance)) {
      asset.provenance.forEach((record, provenanceIndex) => {
        if (typeof record.sourceUrl !== "string") return;
        let valid = false;
        try {
          const url = new URL(record.sourceUrl);
          valid =
            (url.protocol === "https:" || url.protocol === "http:") &&
            !url.username &&
            !url.password;
        } catch {
          valid = false;
        }
        if (!valid) {
          issues.push(
            issue(
              "invalid_provenance_url",
              `${base}/provenance/${provenanceIndex}/sourceUrl`,
              "Provenance URL must be an HTTP(S) URL without credentials",
            ),
          );
        }
      });
    }
  });

  return finish(issues);
}
