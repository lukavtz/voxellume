import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateOperations } from "../../src/core/spec/operations.ts";

type JsonObject = Record<string, unknown>;
type OperationResult = {
  status: string;
  operations?: JsonObject[];
  issues?: Array<{ code: string; path: string }>;
  question?: string;
  reason?: string;
};

const spec = JSON.parse(
  readFileSync(
    new URL("../../fixtures/mod-spec/valid.json", import.meta.url),
    "utf8",
  ),
) as JsonObject;
const feature = (spec.features as JsonObject[])[0]!;
const acceptance = (spec.acceptance as JsonObject[])[0]!;

const ordinaryOperations: Array<JsonObject & { type: string }> = [
  {
    type: "create_feature",
    feature: {
      ...structuredClone(feature),
      id: "ruby_pickaxe",
      names: { en_us: "Ruby Pickaxe" },
      implementationUnitIds: [],
      assetIds: [],
      acceptanceIds: [],
    },
  },
  {
    type: "update_feature",
    featureId: "ruby_blade",
    patch: { properties: { attackDamage: 8, durability: 512 } },
  },
  { type: "delete_feature", featureId: "ruby_block" },
  {
    type: "rename_feature",
    featureId: "ruby_blade",
    newId: "tempered_ruby_blade",
  },
  {
    type: "add_recipe",
    recipe: {
      id: "recipe_ruby_blade",
      featureId: "ruby_blade",
      kind: "crafting_shaped",
      result: { item: "ruby_tools:ruby_blade", count: 1 },
    },
  },
  {
    type: "update_recipe",
    recipeId: "recipe_ruby_block",
    patch: { result: { item: "ruby_tools:ruby_block", count: 2 } },
  },
  { type: "remove_recipe", recipeId: "recipe_ruby_block" },
  {
    type: "set_appearance",
    featureId: "ruby_blade",
    assetIds: ["asset_ruby_blade_model"],
  },
  {
    type: "add_acceptance",
    acceptance: {
      ...structuredClone(acceptance),
      id: "accept_ruby_blade_durability",
      behavior: "A ruby blade loses one durability point per hit.",
      checkIds: ["gametest.ruby_blade.durability"],
      expected: { durabilityLost: 1 },
    },
  },
  {
    type: "test_feature",
    featureId: "ruby_blade",
    acceptanceIds: ["accept_ruby_blade_damage"],
  },
  { type: "revert_change", changeId: "change_ruby_blade_damage" },
];

function expectIssue(
  result: OperationResult,
  status: string,
  code: string,
): void {
  assert.equal(result.status, status);
  assert.ok(
    result.issues?.some((issue) => issue.code === code),
    `expected ${code}, received ${JSON.stringify(result)}`,
  );
}

test("recognizes all eleven mutating or executable operations with stable normalized output", () => {
  for (const operation of ordinaryOperations) {
    const document = structuredClone(spec);
    const beforeDocument = structuredClone(document);
    const beforeOperation = structuredClone(operation);
    const result = validateOperations(document, [operation]) as OperationResult;

    assert.equal(result.status, "validated", operation.type);
    assert.deepEqual(result.operations, [beforeOperation], operation.type);
    assert.deepEqual(document, beforeDocument, operation.type);
    assert.deepEqual(operation, beforeOperation, operation.type);
    assert.deepEqual(
      validateOperations(document, [operation]),
      result,
      `${operation.type} must be deterministic`,
    );
  }
});

test("returns clarification_required instead of inventing an answer", () => {
  const operation = {
    type: "clarify_request",
    question: "Should the ruby blade have a sweeping attack?",
  };
  const result = validateOperations(spec, [operation]) as OperationResult;

  assert.equal(result.status, "clarification_required");
  assert.equal(result.question, operation.question);
  assert.equal(result.operations, undefined);
});

test("returns unsupported_request with the caller's reason", () => {
  const operation = {
    type: "unsupported_request",
    reason: "Bedrock Edition is outside the Java target contract.",
  };
  const result = validateOperations(spec, [operation]) as OperationResult;

  assert.equal(result.status, "unsupported_request");
  assert.equal(result.reason, operation.reason);
  assert.equal(result.operations, undefined);
});

test("rejects unknown operation kinds as unsupported rather than malformed", () => {
  expectIssue(
    validateOperations(spec, [
      { type: "execute_shell", command: "gradle build" },
    ]),
    "unsupported_request",
    "unsupported_operation",
  );
});

test("requires stable feature IDs instead of arbitrary paths or selectors", () => {
  for (const type of [
    "update_feature",
    "delete_feature",
    "rename_feature",
    "set_appearance",
    "test_feature",
  ]) {
    expectIssue(
      validateOperations(spec, [
        { type, path: "src/main/java/RubyBlade.java" },
      ]),
      "invalid",
      "stable_id_required",
    );
    expectIssue(
      validateOperations(spec, [{ type, selector: { index: 0 } }]),
      "invalid",
      "stable_id_required",
    );
  }
  for (const type of ["update_recipe", "remove_recipe"]) {
    expectIssue(
      validateOperations(spec, [
        { type, path: "data/ruby_tools/recipe/ruby_block.json" },
      ]),
      "invalid",
      "stable_id_required",
    );
  }
});

test("rejects arbitrary commands, executable fields, and unknown operation fields", () => {
  const malicious = [
    {
      type: "test_feature",
      featureId: "ruby_blade",
      command: "./gradlew build",
    },
    { type: "update_feature", featureId: "ruby_blade", exec: "rm -rf /" },
    {
      type: "set_appearance",
      featureId: "ruby_blade",
      script: "process.exit(0)",
    },
    { type: "delete_feature", featureId: "ruby_blade", unexpected: true },
  ];
  for (const operation of malicious) {
    expectIssue(
      validateOperations(spec, [operation]),
      "invalid",
      "unknown_field",
    );
  }
});

test("rejects malformed known operations without partially validating the batch", () => {
  const malformed = [
    { type: "create_feature" },
    { type: "update_feature", featureId: "ruby_blade" },
    { type: "rename_feature", featureId: "ruby_blade", newId: "Invalid-ID" },
    { type: "add_recipe", recipe: { id: "missing_fields" } },
    { type: "set_appearance", featureId: "ruby_blade", assetIds: [] },
    { type: "add_acceptance", acceptance: { id: "missing_fields" } },
    { type: "test_feature", featureId: "ruby_blade", acceptanceIds: [] },
    { type: "revert_change" },
    { type: "clarify_request", question: "" },
    { type: "unsupported_request", reason: "" },
  ];
  for (const operation of malformed) {
    const result = validateOperations(spec, [operation]) as OperationResult;
    assert.equal(result.status, "invalid", operation.type);
    assert.equal(result.operations, undefined, operation.type);
    assert.ok(result.issues && result.issues.length > 0, operation.type);
  }
});

test("validates every operation atomically and preserves input ordering", () => {
  const operations = structuredClone(ordinaryOperations);
  const valid = validateOperations(spec, operations) as OperationResult;
  assert.equal(valid.status, "validated");
  assert.deepEqual(
    valid.operations?.map((operation) => operation.type),
    ordinaryOperations.map((operation) => operation.type),
  );

  const withInvalid = [...operations, { type: "delete_feature" }];
  const before = structuredClone(withInvalid);
  const invalid = validateOperations(spec, withInvalid) as OperationResult;
  expectIssue(invalid, "invalid", "stable_id_required");
  assert.equal(invalid.operations, undefined);
  assert.deepEqual(withInvalid, before);
});

test("rejects dangling stable IDs and conflicting new IDs", () => {
  const dangling = [
    { type: "update_feature", featureId: "missing_feature", patch: {} },
    { type: "delete_feature", featureId: "missing_feature" },
    { type: "update_recipe", recipeId: "missing_recipe", patch: {} },
    { type: "remove_recipe", recipeId: "missing_recipe" },
    {
      type: "test_feature",
      featureId: "ruby_blade",
      acceptanceIds: ["missing_acceptance"],
    },
  ];
  for (const operation of dangling) {
    expectIssue(
      validateOperations(spec, [operation]),
      "invalid",
      "missing_link",
    );
  }

  const duplicateFeature = structuredClone(ordinaryOperations[0]!);
  (duplicateFeature.feature as JsonObject).id = "ruby_blade";
  expectIssue(
    validateOperations(spec, [duplicateFeature]),
    "invalid",
    "duplicate_id",
  );
});

test("validates the complete update_feature and update_recipe patch payloads", () => {
  const invalidPatches = [
    {
      operation: {
        type: "update_feature",
        featureId: "ruby_blade",
        patch: { unexpected: true },
      },
      status: "invalid",
      code: "unknown_field",
    },
    {
      operation: {
        type: "update_recipe",
        recipeId: "recipe_ruby_block",
        patch: { unexpected: true },
      },
      status: "invalid",
      code: "unknown_field",
    },
    {
      operation: {
        type: "update_feature",
        featureId: "ruby_blade",
        patch: { id: "replacement_id" },
      },
      status: "invalid",
      code: "stable_id_immutable",
    },
    {
      operation: {
        type: "update_recipe",
        recipeId: "recipe_ruby_block",
        patch: { id: "replacement_recipe" },
      },
      status: "invalid",
      code: "stable_id_immutable",
    },
    {
      operation: {
        type: "update_feature",
        featureId: "ruby_blade",
        patch: { implementationUnitIds: [] },
      },
      status: "invalid",
      code: "missing_link",
    },
    {
      operation: {
        type: "update_feature",
        featureId: "ruby_blade",
        patch: { properties: { command: "./gradlew build" } },
      },
      status: "invalid",
      code: "executable_value",
    },
    {
      operation: {
        type: "update_feature",
        featureId: "ruby_blade",
        patch: { properties: { exec: "process.exit(0)" } },
      },
      status: "invalid",
      code: "executable_value",
    },
    {
      operation: {
        type: "update_recipe",
        recipeId: "recipe_ruby_block",
        patch: {
          result: {
            item: "ruby_tools:ruby_block",
            count: 1,
            script: "require('node:child_process')",
          },
        },
      },
      status: "invalid",
      code: "executable_value",
    },
    {
      operation: {
        type: "update_feature",
        featureId: "ruby_blade",
        patch: { kind: "projectile" },
      },
      status: "unsupported_request",
      code: "unsupported_feature_kind",
    },
  ];

  for (const { operation, status, code } of invalidPatches) {
    const result = validateOperations(spec, [operation]) as OperationResult;
    expectIssue(result, status, code);
    assert.equal(result.operations, undefined, operation.type);
  }

  for (const operation of ordinaryOperations.filter(({ type }) =>
    ["update_feature", "update_recipe"].includes(type),
  )) {
    const result = validateOperations(spec, [operation]) as OperationResult;
    assert.equal(result.status, "validated", operation.type);
    assert.deepEqual(result.operations, [operation], operation.type);
  }
});

test("rejects acceptance and implementation links owned by another feature", () => {
  const crossFeatureOperations = [
    {
      type: "create_feature",
      feature: {
        ...structuredClone(feature),
        id: "ruby_pickaxe",
        implementationUnitIds: ["unit_ruby_blade"],
        assetIds: [],
        acceptanceIds: [],
      },
    },
    {
      type: "create_feature",
      feature: {
        ...structuredClone(feature),
        id: "ruby_pickaxe",
        implementationUnitIds: [],
        assetIds: [],
        acceptanceIds: ["accept_ruby_blade_damage"],
      },
    },
    {
      type: "add_acceptance",
      acceptance: {
        ...structuredClone(acceptance),
        id: "accept_ruby_block_damage",
        featureId: "ruby_block",
        implementationUnitIds: ["unit_ruby_blade"],
      },
    },
    {
      type: "test_feature",
      featureId: "ruby_blade",
      acceptanceIds: ["accept_ruby_block_drops"],
    },
  ];

  for (const operation of crossFeatureOperations) {
    const result = validateOperations(spec, [operation]) as OperationResult;
    expectIssue(result, "invalid", "cross_feature_link");
    assert.equal(result.operations, undefined, operation.type);
  }
});

test("requires clarification and unsupported control operations to be alone", () => {
  const mutation = ordinaryOperations.find(
    ({ type }) => type === "update_feature",
  )!;
  const controls = [
    {
      type: "clarify_request",
      question: "Should the ruby blade have a sweeping attack?",
    },
    {
      type: "unsupported_request",
      reason: "Bedrock Edition is outside the Java target contract.",
    },
  ];

  for (const control of controls) {
    for (const operations of [
      [structuredClone(mutation), structuredClone(control)],
      [structuredClone(control), structuredClone(mutation)],
    ]) {
      const result = validateOperations(spec, operations) as OperationResult;
      expectIssue(result, "invalid", "control_operation_mixed");
      assert.equal(result.operations, undefined, control.type);
    }
  }
});
