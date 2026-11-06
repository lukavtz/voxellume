import { readFileSync } from "node:fs";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema, ErrorObject } from "ajv";

import { canonicalJson, sha256 } from "../targets/canonical-json.ts";

export const MOD_SPEC_SCHEMA_VERSION = "mod-spec-1.0.0" as const;

export type JsonObject = Record<string, unknown>;

export interface ModSpecMetadata extends JsonObject {
  name: string;
  version: string;
  description: string;
  authors: string[];
  license: string;
}

export interface ModSpec extends JsonObject {
  schemaVersion: typeof MOD_SPEC_SCHEMA_VERSION;
  modId: string;
  namespace: string;
  javaPackage: string;
  metadata: ModSpecMetadata;
  targetPackId: string;
  targetPackRevision: number;
  features: JsonObject[];
  implementationUnits: JsonObject[];
  acceptance: JsonObject[];
}

export interface ModSpecIssue {
  code: string;
  path: string;
  message: string;
}

export interface ExpectedTarget {
  targetPackId: string;
  targetPackRevision: number;
}

export type ModSpecValidationResult =
  | { status: "valid"; spec: ModSpec }
  | { status: "invalid" | "unsupported_request"; issues: ModSpecIssue[] };

const schema = JSON.parse(
  readFileSync(
    new URL("../../../schemas/mod-spec.schema.json", import.meta.url),
    "utf8",
  ),
) as JsonObject;
const legacySchema = structuredClone(schema);
legacySchema.$id = "https://voxellume.local/schemas/mod-spec-0.9.0.schema.json";
const legacyProperties = legacySchema.properties as JsonObject;
legacyProperties.schemaVersion = { const: "mod-spec-0.9.0" };
legacyProperties.targetRevision = legacyProperties.targetPackRevision;
delete legacyProperties.targetPackRevision;
legacySchema.required = (legacySchema.required as string[]).map((field) =>
  field === "targetPackRevision" ? "targetRevision" : field,
);
const legacyMetadata = legacyProperties.metadata as JsonObject;
const legacyMetadataProperties = legacyMetadata.properties as JsonObject;
legacyMetadataProperties.title = legacyMetadataProperties.name;
delete legacyMetadataProperties.name;
legacyMetadata.required = (legacyMetadata.required as string[]).map((field) =>
  field === "name" ? "title" : field,
);
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
  removeAdditional: false,
  useDefaults: false,
  coerceTypes: false,
});
const validateSchema = ajv.compile(schema as AnySchema);
const validateLegacySchema = ajv.compile(legacySchema as AnySchema);

const CHECK_KINDS: Record<string, true> = {
  unit: true,
  resource: true,
  build: true,
  server: true,
  client: true,
  gameTest: true,
  visual: true,
};

function issue(code: string, path: string, message: string): ModSpecIssue {
  return { code, path, message };
}

function schemaIssue(error: ErrorObject): ModSpecIssue {
  const path = error.instancePath || "/";
  const missing =
    error.keyword === "required" && "missingProperty" in error.params
      ? `/${String(error.params.missingProperty)}`
      : "";
  const unsupportedCodes: Record<string, string> = {
    "/schemaVersion": "unsupported_schema_version",
    "/configuration/entries": "unsupported_configuration_kind",
    "/evidence/required": "unsupported_check_kind",
    "/delivery/buildTasks": "unsupported_task",
  };
  let code =
    error.keyword === "additionalProperties"
      ? "unknown_field"
      : error.keyword === "minItems"
        ? "min_items"
        : error.keyword;
  if (path === "/targetPackRevision" && error.keyword === "minimum") {
    code = "type";
  }
  if (error.keyword === "enum" || error.keyword === "const") {
    for (const [prefix, unsupportedCode] of Object.entries(unsupportedCodes)) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        code = unsupportedCode;
        break;
      }
    }
    if (path.startsWith("/features/") && path.endsWith("/kind")) {
      code = "unsupported_feature_kind";
    }
    if (path.startsWith("/acceptance/") && path.endsWith("/kind")) {
      code = "unsupported_check_kind";
    }
  }
  return issue(code, `${path}${missing}`, error.message ?? "Invalid ModSpec.");
}

function safeRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    /^([/\\]|[A-Za-z]:)/.test(value)
  ) {
    return false;
  }
  return !value.split(/[/\\]/).includes("..");
}

function addDuplicateIssues(
  values: JsonObject[],
  path: string,
  issues: ModSpecIssue[],
): Set<string> {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    const id = value.id as string;
    if (ids.has(id)) {
      issues.push(
        issue("duplicate_id", `${path}/${index}/id`, `Duplicate ID "${id}".`),
      );
    }
    ids.add(id);
  });
  return ids;
}

function requireLink(
  ids: Set<string>,
  id: string,
  path: string,
  issues: ModSpecIssue[],
): void {
  if (!ids.has(id)) {
    issues.push(issue("missing_link", path, `Unknown stable ID "${id}".`));
  }
}

function semanticIssues(spec: ModSpec): ModSpecIssue[] {
  const issues: ModSpecIssue[] = [];
  const features = spec.features;
  const units = spec.implementationUnits;
  const assets = spec.assets as JsonObject[];
  const acceptance = spec.acceptance;
  const recipes = (spec.recipes as JsonObject[] | undefined) ?? [];
  const scenarios = (spec.runtime as JsonObject).scenarios as JsonObject[];
  const featureIds = addDuplicateIssues(features, "/features", issues);
  const unitIds = addDuplicateIssues(units, "/implementationUnits", issues);
  const assetIds = addDuplicateIssues(assets, "/assets", issues);
  const acceptanceIds = addDuplicateIssues(acceptance, "/acceptance", issues);
  addDuplicateIssues(recipes, "/recipes", issues);
  addDuplicateIssues(scenarios, "/runtime/scenarios", issues);
  addDuplicateIssues(
    (spec.configuration as JsonObject).entries as JsonObject[],
    "/configuration/entries",
    issues,
  );
  addDuplicateIssues(
    (spec.persistence as JsonObject).migrations as JsonObject[],
    "/persistence/migrations",
    issues,
  );

  features.forEach((feature, index) => {
    (feature.implementationUnitIds as string[]).forEach((id, link) => {
      requireLink(
        unitIds,
        id,
        `/features/${index}/implementationUnitIds/${link}`,
        issues,
      );
      const unit = units.find((candidate) => candidate.id === id);
      if (unit && unit.featureId !== feature.id) {
        issues.push(
          issue(
            "inconsistent_link",
            `/features/${index}/implementationUnitIds/${link}`,
            "Implementation unit belongs to another feature.",
          ),
        );
      }
    });
    (feature.assetIds as string[]).forEach((id, link) =>
      requireLink(assetIds, id, `/features/${index}/assetIds/${link}`, issues),
    );
    (feature.acceptanceIds as string[]).forEach((id, link) => {
      requireLink(
        acceptanceIds,
        id,
        `/features/${index}/acceptanceIds/${link}`,
        issues,
      );
      const entry = acceptance.find((candidate) => candidate.id === id);
      if (entry && entry.featureId !== feature.id) {
        issues.push(
          issue(
            "inconsistent_link",
            `/features/${index}/acceptanceIds/${link}`,
            "Acceptance entry belongs to another feature.",
          ),
        );
      }
    });
  });
  units.forEach((unit, index) => {
    requireLink(
      featureIds,
      unit.featureId as string,
      `/implementationUnits/${index}/featureId`,
      issues,
    );
    (unit.sourcePaths as string[]).forEach((path, pathIndex) => {
      if (!safeRelativePath(path)) {
        issues.push(
          issue(
            "unsafe_path",
            `/implementationUnits/${index}/sourcePaths/${pathIndex}`,
            "Path must remain relative to the project.",
          ),
        );
      }
    });
  });
  acceptance.forEach((entry, index) => {
    requireLink(
      featureIds,
      entry.featureId as string,
      `/acceptance/${index}/featureId`,
      issues,
    );
    (entry.implementationUnitIds as string[]).forEach((id, link) => {
      requireLink(
        unitIds,
        id,
        `/acceptance/${index}/implementationUnitIds/${link}`,
        issues,
      );
      const unit = units.find((candidate) => candidate.id === id);
      if (unit && unit.featureId !== entry.featureId) {
        issues.push(
          issue(
            "inconsistent_link",
            `/acceptance/${index}/implementationUnitIds/${link}`,
            "Acceptance implementation unit belongs to another feature.",
          ),
        );
      }
    });
    if (!safeRelativePath(entry.fixture as string)) {
      issues.push(
        issue(
          "unsafe_path",
          `/acceptance/${index}/fixture`,
          "Fixture path must remain relative to the project.",
        ),
      );
    }
  });
  recipes.forEach((recipe, index) =>
    requireLink(
      featureIds,
      recipe.featureId as string,
      `/recipes/${index}/featureId`,
      issues,
    ),
  );
  scenarios.forEach((scenario, index) =>
    (scenario.acceptanceIds as string[]).forEach((id, link) =>
      requireLink(
        acceptanceIds,
        id,
        `/runtime/scenarios/${index}/acceptanceIds/${link}`,
        issues,
      ),
    ),
  );
  assets.forEach((asset, index) => {
    for (const field of ["source", "generated"]) {
      if (!safeRelativePath(asset[field] as string)) {
        issues.push(
          issue(
            "unsafe_path",
            `/assets/${index}/${field}`,
            "Asset path must remain relative to the project.",
          ),
        );
      }
    }
  });

  ((spec.configuration as JsonObject).entries as JsonObject[]).forEach(
    (entry, index) => {
      const expectedType =
        entry.kind === "boolean"
          ? "boolean"
          : entry.kind === "string"
            ? "string"
            : "number";
      const validDefault =
        entry.kind === "integer"
          ? Number.isInteger(entry.default)
          : typeof entry.default === expectedType;
      if (!validDefault) {
        issues.push(
          issue(
            "invalid_configuration_default",
            `/configuration/entries/${index}/default`,
            "Configuration default must match its declared kind.",
          ),
        );
      }
      if (
        typeof entry.minimum === "number" &&
        typeof entry.maximum === "number" &&
        entry.minimum > entry.maximum
      ) {
        issues.push(
          issue(
            "invalid_configuration_range",
            `/configuration/entries/${index}`,
            "Configuration minimum cannot exceed maximum.",
          ),
        );
      }
    },
  );
  ((spec.evidence as JsonObject).artifactGlobs as string[]).forEach(
    (glob, index) => {
      if (!safeRelativePath(glob)) {
        issues.push(
          issue(
            "unsafe_path",
            `/evidence/artifactGlobs/${index}`,
            "Evidence glob must remain relative to the project.",
          ),
        );
      }
    },
  );
  const visual = spec.visual as JsonObject;
  if (!safeRelativePath(visual.rubric as string)) {
    issues.push(
      issue(
        "unsafe_path",
        "/visual/rubric",
        "Rubric path must remain relative to the project.",
      ),
    );
  }
  const delivery = spec.delivery as JsonObject;
  if (!safeRelativePath(delivery.productionJar as string)) {
    issues.push(
      issue(
        "unsafe_path",
        "/delivery/productionJar",
        "Artifact path must remain relative to the project.",
      ),
    );
  }
  ((spec.evidence as JsonObject).required as string[]).forEach(
    (kind, index) => {
      if (!CHECK_KINDS[kind]) {
        issues.push(
          issue(
            "unsupported_check_kind",
            `/evidence/required/${index}`,
            `Unsupported check kind "${kind}".`,
          ),
        );
      }
    },
  );
  ((spec.persistence as JsonObject).migrations as JsonObject[]).forEach(
    (migration, index) => {
      if (migration.toVersion !== (migration.fromVersion as number) + 1) {
        issues.push(
          issue(
            "invalid_migration",
            `/persistence/migrations/${index}`,
            "A migration must advance exactly one persistence version.",
          ),
        );
      }
    },
  );
  return issues;
}

export function validateModSpec(
  document: unknown,
  expectedTarget?: ExpectedTarget,
): ModSpecValidationResult {
  if (!validateSchema(document)) {
    const issues = (validateSchema.errors ?? []).map(schemaIssue);
    const unsupported = issues.some((item) =>
      item.code.startsWith("unsupported_"),
    );
    return { status: unsupported ? "unsupported_request" : "invalid", issues };
  }
  const spec = structuredClone(document) as ModSpec;
  const issues = semanticIssues(spec);
  if (issues.length > 0) return { status: "invalid", issues };
  if (
    expectedTarget &&
    (spec.targetPackId !== expectedTarget.targetPackId ||
      spec.targetPackRevision !== expectedTarget.targetPackRevision)
  ) {
    return {
      status: "invalid",
      issues: [
        issue(
          "target_mismatch",
          "/targetPackId",
          "ModSpec target pack ID and revision must exactly match the resolved target.",
        ),
      ],
    };
  }
  return { status: "valid", spec };
}

export type ModSpecMigrationResult =
  | ModSpec
  | { status: "invalid" | "unsupported_request"; issues: ModSpecIssue[] };

export function migrateModSpec(document: JsonObject): ModSpec;
export function migrateModSpec(document: unknown): ModSpecMigrationResult;
export function migrateModSpec(document: unknown): ModSpecMigrationResult {
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document)
  ) {
    return {
      status: "invalid",
      issues: [issue("type", "/", "A ModSpec document must be an object.")],
    };
  }
  const source = structuredClone(document) as JsonObject;
  const version = source.schemaVersion;
  if (version !== MOD_SPEC_SCHEMA_VERSION && version !== "mod-spec-0.9.0") {
    return {
      status: "unsupported_request",
      issues: [
        issue(
          "unsupported_schema_version",
          "/schemaVersion",
          `Unsupported ModSpec schema version: ${String(version)}`,
        ),
      ],
    };
  }
  if (version === MOD_SPEC_SCHEMA_VERSION) {
    const current = validateModSpec(source);
    return current.status === "valid" ? current.spec : current;
  }
  if (!validateLegacySchema(source)) {
    return {
      status: "invalid",
      issues: (validateLegacySchema.errors ?? []).map(schemaIssue),
    };
  }
  source.schemaVersion = MOD_SPEC_SCHEMA_VERSION;
  source.targetPackRevision = source.targetRevision;
  delete source.targetRevision;
  const metadata = source.metadata as JsonObject;
  metadata.name = metadata.title;
  delete metadata.title;
  const migrated = validateModSpec(source);
  return migrated.status === "valid" ? migrated.spec : migrated;
}

const VOLATILE_KEYS: Record<string, true> = {
  createdAt: true,
  updatedAt: true,
  committedAt: true,
  runStartedAt: true,
  timestamp: true,
  transactionId: true,
  randomId: true,
  selector: true,
  selectorBookkeeping: true,
  created_at: true,
  updated_at: true,
  committed_at: true,
  run_started_at: true,
  transaction_id: true,
  random_id: true,
};

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !VOLATILE_KEYS[key])
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

export function canonicalModSpecHash(document: unknown): string {
  return sha256(canonicalJson(canonicalValue(document)));
}
