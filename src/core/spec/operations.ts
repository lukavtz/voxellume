import { readFileSync } from "node:fs";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema, ErrorObject } from "ajv";

import { validateModSpec } from "./mod-spec.ts";
import type { JsonObject, ModSpec, ModSpecIssue } from "./mod-spec.ts";

export interface ModOperation extends JsonObject {
  type: string;
}

interface OperationResultBase {
  operations?: ModOperation[];
  issues?: ModSpecIssue[];
  question?: string;
  reason?: string;
}

export type OperationValidationResult =
  | (OperationResultBase & { status: "validated"; operations: ModOperation[] })
  | (OperationResultBase & {
      status: "invalid";
      operations?: undefined;
      issues: ModSpecIssue[];
    })
  | (OperationResultBase & {
      status: "unsupported_request";
      operations?: undefined;
      issues: ModSpecIssue[];
      reason?: undefined;
    })
  | (OperationResultBase & {
      status: "clarification_required";
      operations?: undefined;
      question: string;
    })
  | (OperationResultBase & {
      status: "unsupported_request";
      operations?: undefined;
      issues?: undefined;
      reason: string;
    });

const modSpecSchema = JSON.parse(
  readFileSync(
    new URL("../../../schemas/mod-spec.schema.json", import.meta.url),
    "utf8",
  ),
) as AnySchema & { $defs: Record<string, AnySchema> };

const idArray = { type: "array", items: { $ref: "#/$defs/identifier" } };
const operationSchema: AnySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: {
    ...modSpecSchema.$defs,
    featureDraft: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "kind",
        "names",
        "properties",
        "implementationUnitIds",
        "assetIds",
        "acceptanceIds",
      ],
      properties: {
        id: { $ref: "#/$defs/identifier" },
        kind: {
          enum: [
            "item",
            "block",
            "entity",
            "recipe",
            "worldgen",
            "gui",
            "mechanic",
          ],
        },
        names: {
          type: "object",
          minProperties: 1,
          propertyNames: { pattern: "^[a-z]{2}_[a-z]{2}$" },
          additionalProperties: { $ref: "#/$defs/nonEmptyString" },
        },
        properties: { type: "object" },
        implementationUnitIds: idArray,
        assetIds: idArray,
        acceptanceIds: idArray,
      },
    },
    featurePatch: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { $ref: "#/$defs/identifier" },
        kind: {
          enum: [
            "item",
            "block",
            "entity",
            "recipe",
            "worldgen",
            "gui",
            "mechanic",
          ],
        },
        names: {
          type: "object",
          minProperties: 1,
          propertyNames: { pattern: "^[a-z]{2}_[a-z]{2}$" },
          additionalProperties: { $ref: "#/$defs/nonEmptyString" },
        },
        properties: { type: "object" },
        implementationUnitIds: idArray,
        assetIds: idArray,
        acceptanceIds: idArray,
      },
    },
    recipePatch: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { $ref: "#/$defs/identifier" },
        featureId: { $ref: "#/$defs/identifier" },
        kind: { $ref: "#/$defs/nonEmptyString" },
        result: {
          type: "object",
          additionalProperties: false,
          required: ["item", "count"],
          properties: {
            item: { $ref: "#/$defs/nonEmptyString" },
            count: { type: "integer", minimum: 1 },
          },
        },
      },
    },
  },
  oneOf: [
    operation("create_feature", ["feature"], {
      feature: { $ref: "#/$defs/featureDraft" },
    }),
    operation("update_feature", ["featureId", "patch"], {
      featureId: { $ref: "#/$defs/identifier" },
      patch: { $ref: "#/$defs/featurePatch" },
    }),
    operation("delete_feature", ["featureId"], {
      featureId: { $ref: "#/$defs/identifier" },
    }),
    operation("rename_feature", ["featureId", "newId"], {
      featureId: { $ref: "#/$defs/identifier" },
      newId: { $ref: "#/$defs/identifier" },
    }),
    operation("add_recipe", ["recipe"], { recipe: { $ref: "#/$defs/recipe" } }),
    operation("update_recipe", ["recipeId", "patch"], {
      recipeId: { $ref: "#/$defs/identifier" },
      patch: { $ref: "#/$defs/recipePatch" },
    }),
    operation("remove_recipe", ["recipeId"], {
      recipeId: { $ref: "#/$defs/identifier" },
    }),
    operation("set_appearance", ["featureId", "assetIds"], {
      featureId: { $ref: "#/$defs/identifier" },
      assetIds: { $ref: "#/$defs/idList" },
    }),
    operation("add_acceptance", ["acceptance"], {
      acceptance: { $ref: "#/$defs/acceptance" },
    }),
    operation("test_feature", ["featureId", "acceptanceIds"], {
      featureId: { $ref: "#/$defs/identifier" },
      acceptanceIds: { $ref: "#/$defs/idList" },
    }),
    operation("revert_change", ["changeId"], {
      changeId: { $ref: "#/$defs/identifier" },
    }),
    operation("clarify_request", ["question"], {
      question: { type: "string", minLength: 1 },
    }),
    operation("unsupported_request", ["reason"], {
      reason: { type: "string", minLength: 1 },
    }),
  ],
};

function operation(
  type: string,
  required: string[],
  properties: Record<string, AnySchema>,
): AnySchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["type", ...required],
    properties: { type: { const: type }, ...properties },
  };
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
  removeAdditional: false,
  useDefaults: false,
  coerceTypes: false,
});
const validateSchema = ajv.compile(operationSchema);
const KNOWN_TYPES: Record<string, true> = {
  create_feature: true,
  update_feature: true,
  delete_feature: true,
  rename_feature: true,
  add_recipe: true,
  update_recipe: true,
  remove_recipe: true,
  set_appearance: true,
  add_acceptance: true,
  test_feature: true,
  revert_change: true,
  clarify_request: true,
  unsupported_request: true,
};
const FEATURE_ID_TYPES: Record<string, true> = {
  update_feature: true,
  delete_feature: true,
  rename_feature: true,
  set_appearance: true,
  test_feature: true,
};
const RECIPE_ID_TYPES: Record<string, true> = {
  update_recipe: true,
  remove_recipe: true,
};

function issue(code: string, path: string, message: string): ModSpecIssue {
  return { code, path, message };
}

function operationIssue(error: ErrorObject, index: number): ModSpecIssue {
  let code = error.keyword;
  if (error.keyword === "additionalProperties") code = "unknown_field";
  if (error.keyword === "minItems") code = "min_items";
  if (
    error.keyword === "enum" &&
    (error.instancePath.endsWith("/feature/kind") ||
      error.instancePath.endsWith("/patch/kind"))
  ) {
    code = "unsupported_feature_kind";
  }
  if (
    error.keyword === "enum" &&
    error.instancePath.endsWith("/acceptance/kind")
  ) {
    code = "unsupported_check_kind";
  }
  return issue(
    code,
    `/${index}${error.instancePath}`,
    error.message ?? "Invalid operation.",
  );
}

function ids(spec: ModSpec, field: string): Set<string> {
  return new Set(
    ((spec[field] as JsonObject[] | undefined) ?? []).map(
      (entry) => entry.id as string,
    ),
  );
}

function linkIssues(
  operation: ModOperation,
  index: number,
  spec: ModSpec,
): ModSpecIssue[] {
  const issues: ModSpecIssue[] = [];
  const features = ids(spec, "features");
  const recipes = ids(spec, "recipes");
  const units = ids(spec, "implementationUnits");
  const assets = ids(spec, "assets");
  const acceptance = ids(spec, "acceptance");
  const unitEntries = spec.implementationUnits;
  const acceptanceEntries = spec.acceptance;
  const check = (set: Set<string>, id: string, path: string) => {
    if (!set.has(id)) {
      issues.push(
        issue("missing_link", `/${index}${path}`, `Unknown stable ID "${id}".`),
      );
    }
  };
  const checkUnit = (id: string, featureId: string, path: string) => {
    check(units, id, path);
    const entry = unitEntries.find((candidate) => candidate.id === id);
    if (entry && entry.featureId !== featureId) {
      issues.push(
        issue(
          "cross_feature_link",
          `/${index}${path}`,
          "Implementation unit belongs to another feature.",
        ),
      );
    }
  };
  const checkAcceptance = (id: string, featureId: string, path: string) => {
    check(acceptance, id, path);
    const entry = acceptanceEntries.find((candidate) => candidate.id === id);
    if (entry && entry.featureId !== featureId) {
      issues.push(
        issue(
          "cross_feature_link",
          `/${index}${path}`,
          "Acceptance entry belongs to another feature.",
        ),
      );
    }
  };

  if (FEATURE_ID_TYPES[operation.type]) {
    check(features, operation.featureId as string, "/featureId");
  }
  if (RECIPE_ID_TYPES[operation.type]) {
    check(recipes, operation.recipeId as string, "/recipeId");
  }
  if (operation.type === "create_feature") {
    const value = operation.feature as JsonObject;
    const featureId = value.id as string;
    (value.implementationUnitIds as string[]).forEach((id, link) =>
      checkUnit(id, featureId, `/feature/implementationUnitIds/${link}`),
    );
    (value.assetIds as string[]).forEach((id, link) =>
      check(assets, id, `/feature/assetIds/${link}`),
    );
    (value.acceptanceIds as string[]).forEach((id, link) =>
      checkAcceptance(id, featureId, `/feature/acceptanceIds/${link}`),
    );
  }
  if (operation.type === "add_acceptance") {
    const value = operation.acceptance as JsonObject;
    const featureId = value.featureId as string;
    check(features, featureId, "/acceptance/featureId");
    (value.implementationUnitIds as string[]).forEach((id, link) =>
      checkUnit(id, featureId, `/acceptance/implementationUnitIds/${link}`),
    );
  }
  if (operation.type === "add_recipe") {
    check(
      features,
      (operation.recipe as JsonObject).featureId as string,
      "/recipe/featureId",
    );
  }
  if (operation.type === "set_appearance") {
    (operation.assetIds as string[]).forEach((id, link) =>
      check(assets, id, `/assetIds/${link}`),
    );
  }
  if (operation.type === "test_feature") {
    const featureId = operation.featureId as string;
    (operation.acceptanceIds as string[]).forEach((id, link) =>
      checkAcceptance(id, featureId, `/acceptanceIds/${link}`),
    );
  }
  if (operation.type === "update_feature") {
    const featureId = operation.featureId as string;
    const patch = operation.patch as JsonObject;
    if (patch.id !== undefined) {
      issues.push(
        issue(
          "stable_id_immutable",
          `/${index}/patch/id`,
          "A feature stable ID cannot be changed by update_feature.",
        ),
      );
    }
    for (const field of ["implementationUnitIds", "acceptanceIds"] as const) {
      const links = patch[field] as string[] | undefined;
      if (links?.length === 0) {
        issues.push(
          issue(
            "missing_link",
            `/${index}/patch/${field}`,
            `${field} cannot be empty.`,
          ),
        );
      }
      links?.forEach((id, link) => {
        if (field === "implementationUnitIds")
          checkUnit(id, featureId, `/patch/${field}/${link}`);
        else checkAcceptance(id, featureId, `/patch/${field}/${link}`);
      });
    }
    (patch.assetIds as string[] | undefined)?.forEach((id, link) =>
      check(assets, id, `/patch/assetIds/${link}`),
    );
  }
  if (operation.type === "update_recipe") {
    const patch = operation.patch as JsonObject;
    if (patch.id !== undefined) {
      issues.push(
        issue(
          "stable_id_immutable",
          `/${index}/patch/id`,
          "A recipe stable ID cannot be changed by update_recipe.",
        ),
      );
    }
    if (typeof patch.featureId === "string") {
      check(features, patch.featureId, "/patch/featureId");
    }
  }
  return issues;
}

function executableIssues(
  value: unknown,
  path: string,
  seen = new WeakSet<object>(),
): ModSpecIssue[] {
  if (value === null || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const issues: ModSpecIssue[] = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${key}`;
    if (["command", "exec", "script", "shell", "eval"].includes(key)) {
      issues.push(
        issue(
          "executable_value",
          childPath,
          "Executable values are forbidden in operations.",
        ),
      );
    }
    issues.push(...executableIssues(child, childPath, seen));
  }
  return issues;
}

export function validateOperations(
  document: unknown,
  operations: readonly unknown[],
): OperationValidationResult {
  const specResult = validateModSpec(document);
  if (specResult.status !== "valid") return specResult;
  const spec = specResult.spec;
  const normalized: ModOperation[] = [];
  const issues: ModSpecIssue[] = [];
  let unsupportedOperation = false;

  operations.forEach((candidate, index) => {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      issues.push(
        issue("type", `/${index}`, "An operation must be an object."),
      );
      return;
    }
    const operation = structuredClone(candidate) as ModOperation;
    normalized.push(operation);
    if (typeof operation.type !== "string" || !KNOWN_TYPES[operation.type]) {
      unsupportedOperation = true;
      issues.push(
        issue(
          "unsupported_operation",
          `/${index}/type`,
          `Unsupported operation "${String(operation.type)}".`,
        ),
      );
      return;
    }
    const idField = FEATURE_ID_TYPES[operation.type]
      ? "featureId"
      : RECIPE_ID_TYPES[operation.type]
        ? "recipeId"
        : undefined;
    if (idField && operation[idField] === undefined) {
      issues.push(
        issue(
          "stable_id_required",
          `/${index}/${idField}`,
          "Operations must address a stable ID, not a path or selector.",
        ),
      );
    }
    if (operation.patch !== undefined) {
      issues.push(...executableIssues(operation.patch, `/${index}/patch`));
    }
    if (!validateSchema(operation)) {
      const operationIssues = (validateSchema.errors ?? []).map((error) =>
        operationIssue(error, index),
      );
      unsupportedOperation ||= operationIssues.some((item) =>
        item.code.startsWith("unsupported_"),
      );
      issues.push(...operationIssues);
    }
  });

  if (issues.length > 0) {
    return {
      status: unsupportedOperation ? "unsupported_request" : "invalid",
      issues,
    };
  }

  const controlIndex = normalized.findIndex(
    (operation) =>
      operation.type === "clarify_request" ||
      operation.type === "unsupported_request",
  );
  if (controlIndex >= 0 && normalized.length > 1) {
    return {
      status: "invalid",
      issues: [
        issue(
          "control_operation_mixed",
          `/${controlIndex}`,
          "Control operations must be sent alone.",
        ),
      ],
    };
  }

  const featureIds = ids(spec, "features");
  const recipeIds = ids(spec, "recipes");
  const acceptanceIds = ids(spec, "acceptance");
  for (const [index, operation] of normalized.entries()) {
    issues.push(...linkIssues(operation, index, spec));
    const added =
      operation.type === "create_feature"
        ? ((operation.feature as JsonObject).id as string)
        : operation.type === "add_recipe"
          ? ((operation.recipe as JsonObject).id as string)
          : operation.type === "add_acceptance"
            ? ((operation.acceptance as JsonObject).id as string)
            : undefined;
    if (added !== undefined) {
      const existing =
        operation.type === "create_feature"
          ? featureIds
          : operation.type === "add_recipe"
            ? recipeIds
            : acceptanceIds;
      if (existing.has(added)) {
        issues.push(
          issue("duplicate_id", `/${index}`, `Duplicate stable ID "${added}".`),
        );
      }
      existing.add(added);
    }
    if (operation.type === "rename_feature") {
      const newId = operation.newId as string;
      if (featureIds.has(newId)) {
        issues.push(
          issue(
            "duplicate_id",
            `/${index}/newId`,
            `Duplicate stable ID "${newId}".`,
          ),
        );
      }
      featureIds.add(newId);
    }
  }
  if (issues.length > 0) return { status: "invalid", issues };

  const control = normalized[0];
  if (control?.type === "clarify_request") {
    return {
      status: "clarification_required",
      question: control.question as string,
    };
  }
  if (control?.type === "unsupported_request") {
    return { status: "unsupported_request", reason: control.reason as string };
  }
  return { status: "validated", operations: normalized };
}
