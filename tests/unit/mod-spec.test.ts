import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canonicalModSpecHash,
  migrateModSpec,
  validateModSpec,
} from "../../src/core/spec/mod-spec.ts";

type JsonObject = Record<string, unknown>;
type ValidationResult = {
  status: string;
  spec?: JsonObject;
  issues?: Array<{ code: string; path: string }>;
};

const fixture = JSON.parse(
  readFileSync(
    new URL("../../fixtures/mod-spec/valid.json", import.meta.url),
    "utf8",
  ),
) as JsonObject;

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

function changed(path: readonly string[], value?: unknown): JsonObject {
  const document = clone(fixture);
  if (value === undefined) deletePath(document, path);
  else setPath(document, path, value);
  return document;
}

function expectValid(result: ValidationResult): void {
  assert.equal(result.status, "valid");
  assert.ok(result.spec);
}

function expectIssue(
  result: ValidationResult,
  status: string,
  code: string,
): void {
  assert.equal(result.status, status);
  assert.ok(
    result.issues?.some((issue) => issue.code === code),
    `expected ${code}, received ${JSON.stringify(result)}`,
  );
}

test("accepts the complete valid ModSpec without mutating it", () => {
  const document = clone(fixture);
  const before = clone(document);
  const result = validateModSpec(document) as ValidationResult;

  expectValid(result);
  assert.deepEqual(result.spec, before);
  assert.deepEqual(document, before);
});

test("requires every top-level contract and human metadata field", () => {
  const required = [
    "schemaVersion",
    "modId",
    "namespace",
    "javaPackage",
    "metadata",
    "targetPackId",
    "targetPackRevision",
    "dependencies",
    "compatibility",
    "gameplay",
    "features",
    "implementationUnits",
    "configuration",
    "persistence",
    "assets",
    "acceptance",
    "runtime",
    "visual",
    "evidence",
    "delivery",
  ];
  for (const field of required) {
    expectIssue(validateModSpec(changed([field])), "invalid", "required");
  }
  for (const field of [
    "name",
    "version",
    "description",
    "authors",
    "license",
  ]) {
    expectIssue(
      validateModSpec(changed(["metadata", field])),
      "invalid",
      "required",
    );
  }
});

test("rejects null, arrays, unsupported schema versions, and non-integer revisions", () => {
  for (const document of [null, [], "mod", 42]) {
    expectIssue(validateModSpec(document), "invalid", "type");
  }
  expectIssue(
    validateModSpec(changed(["schemaVersion"], "mod-spec-2.0.0")),
    "unsupported_request",
    "unsupported_schema_version",
  );
  for (const revision of [0, -1, 1.5, "1", null]) {
    expectIssue(
      validateModSpec(changed(["targetPackRevision"], revision)),
      "invalid",
      "type",
    );
  }
});

test("enforces modId and namespace identifiers independently", () => {
  for (const field of ["modId", "namespace"]) {
    for (const value of [
      "a",
      "Ruby_tools",
      "ruby-tools",
      "ruby.tools",
      "1ruby",
      "ruby tools",
      "a".repeat(65),
    ]) {
      expectIssue(
        validateModSpec(changed([field], value)),
        "invalid",
        "pattern",
      );
    }
  }
  const valid = clone(fixture);
  valid.modId = "a1";
  valid.namespace = "a1";
  expectValid(validateModSpec(valid));
});

test("validates Java package syntax independently from mod identifiers", () => {
  for (const value of [
    "Ruby.Tools",
    "dev..ruby",
    ".dev.ruby",
    "dev.ruby.",
    "dev.ruby-tools",
    "dev ruby.tools",
    "1dev.ruby",
  ]) {
    expectIssue(
      validateModSpec(changed(["javaPackage"], value)),
      "invalid",
      "pattern",
    );
  }
  const valid = changed(["javaPackage"], "dev.example.ruby_tools");
  expectValid(validateModSpec(valid));
});

test("accepts exactly the seven typed feature kinds", () => {
  for (const kind of [
    "item",
    "block",
    "entity",
    "recipe",
    "worldgen",
    "gui",
    "mechanic",
  ]) {
    expectValid(validateModSpec(changed(["features", "0", "kind"], kind)));
  }
  expectIssue(
    validateModSpec(changed(["features", "0", "kind"], "projectile")),
    "unsupported_request",
    "unsupported_feature_kind",
  );
});

test("requires stable, unique, well-formed feature IDs", () => {
  expectIssue(
    validateModSpec(changed(["features", "0", "id"])),
    "invalid",
    "required",
  );
  for (const id of ["RubyBlade", "ruby-blade", "1ruby", "", "a".repeat(65)]) {
    expectIssue(
      validateModSpec(changed(["features", "0", "id"], id)),
      "invalid",
      "pattern",
    );
  }
  expectIssue(
    validateModSpec(changed(["features", "1", "id"], "ruby_blade")),
    "invalid",
    "duplicate_id",
  );
});

test("accepts every deterministic acceptance check kind", () => {
  for (const kind of [
    "unit",
    "resource",
    "build",
    "server",
    "client",
    "gameTest",
    "visual",
  ]) {
    expectValid(validateModSpec(changed(["acceptance", "0", "kind"], kind)));
  }
  expectIssue(
    validateModSpec(changed(["acceptance", "0", "kind"], "screenshot")),
    "unsupported_request",
    "unsupported_check_kind",
  );
});

test("rejects orphan feature, implementation, asset, acceptance, and runtime links", () => {
  const orphans = [
    ["features", "0", "implementationUnitIds", "0"],
    ["features", "0", "assetIds", "0"],
    ["features", "0", "acceptanceIds", "0"],
    ["implementationUnits", "0", "featureId"],
    ["acceptance", "0", "featureId"],
    ["acceptance", "0", "implementationUnitIds", "0"],
    ["runtime", "scenarios", "0", "acceptanceIds", "0"],
  ];
  for (const path of orphans) {
    expectIssue(
      validateModSpec(changed(path, "missing_link")),
      "invalid",
      "missing_link",
    );
  }
});

test("requires independent behavior, fixture, check IDs, and expected output for acceptance", () => {
  for (const field of [
    "behavior",
    "kind",
    "implementationUnitIds",
    "checkIds",
    "fixture",
    "expected",
  ]) {
    expectIssue(
      validateModSpec(changed(["acceptance", "0", field])),
      "invalid",
      "required",
    );
  }
  for (const field of ["implementationUnitIds", "checkIds"]) {
    expectIssue(
      validateModSpec(changed(["acceptance", "0", field], [])),
      "invalid",
      "min_items",
    );
  }
});

test("rejects unknown fields at every object boundary", () => {
  const paths = [
    ["unexpected"],
    ["metadata", "unexpected"],
    ["features", "0", "unexpected"],
    ["implementationUnits", "0", "unexpected"],
    ["configuration", "entries", "0", "unexpected"],
    ["persistence", "migrations", "0", "unexpected"],
    ["assets", "0", "unexpected"],
    ["acceptance", "0", "unexpected"],
    ["runtime", "scenarios", "0", "unexpected"],
    ["visual", "unexpected"],
    ["evidence", "unexpected"],
    ["delivery", "unexpected"],
  ];
  for (const path of paths) {
    expectIssue(
      validateModSpec(changed(path, true)),
      "invalid",
      "unknown_field",
    );
  }
});

test("validates configuration, persistence, migration, asset, runtime, visual, evidence, and delivery values", () => {
  const invalidValues: Array<{ path: string[]; value: unknown; code: string }> =
    [
      { path: ["configuration", "entries"], value: [], code: "min_items" },
      {
        path: ["configuration", "entries", "0", "kind"],
        value: "float",
        code: "unsupported_configuration_kind",
      },
      { path: ["persistence", "version"], value: 0, code: "minimum" },
      {
        path: ["persistence", "migrations", "0", "toVersion"],
        value: 0,
        code: "invalid_migration",
      },
      {
        path: ["assets", "0", "source"],
        value: "../outside.bbmodel",
        code: "unsafe_path",
      },
      { path: ["runtime", "scenarios"], value: [], code: "min_items" },
      { path: ["visual", "scenarioIds"], value: [], code: "min_items" },
      {
        path: ["evidence", "required"],
        value: ["aesthetic_guess"],
        code: "unsupported_check_kind",
      },
      {
        path: ["delivery", "buildTasks", "0"],
        value: "publishAll",
        code: "unsupported_task",
      },
    ];
  for (const { path, value, code } of invalidValues) {
    const result = validateModSpec(changed(path, value));
    assert.ok(
      (result as ValidationResult).issues?.some((issue) => issue.code === code),
      `expected ${code}, received ${JSON.stringify(result)}`,
    );
  }
});

test("reports exact target revision mismatches separately from malformed specs", () => {
  const expected = {
    targetPackId: "java-fabric-1.21.1-r1",
    targetPackRevision: 1,
  };
  expectValid(validateModSpec(clone(fixture), expected));
  expectIssue(
    validateModSpec(
      changed(["targetPackId"], "java-neoforge-1.21.1-r1"),
      expected,
    ),
    "invalid",
    "target_mismatch",
  );
  expectIssue(
    validateModSpec(changed(["targetPackRevision"], 2), expected),
    "invalid",
    "target_mismatch",
  );
});

test("migrates an older document once and preserves the source", () => {
  const old = clone(fixture);
  old.schemaVersion = "mod-spec-0.9.0";
  old.targetRevision = old.targetPackRevision;
  delete old.targetPackRevision;
  const oldMetadata = old.metadata as JsonObject;
  oldMetadata.title = oldMetadata.name;
  delete oldMetadata.name;
  const before = clone(old);

  const migrated = migrateModSpec(old);
  assert.equal(migrated.schemaVersion, "mod-spec-1.0.0");
  assert.equal(migrated.targetPackRevision, 1);
  assert.equal(migrated.metadata.name, "Ruby Tools");
  assert.equal("targetRevision" in migrated, false);
  assert.equal("title" in migrated.metadata, false);
  expectValid(validateModSpec(migrated));
  assert.deepEqual(migrateModSpec(migrated), migrated);
  assert.deepEqual(old, before);
});

test("returns structured diagnostics for malformed legacy metadata and target revision", () => {
  for (const missing of ["metadata", "targetPackRevision"]) {
    const old = clone(fixture);
    old.schemaVersion = "mod-spec-0.9.0";
    const oldMetadata = old.metadata as JsonObject;
    oldMetadata.title = oldMetadata.name;
    delete oldMetadata.name;
    if (missing === "metadata") {
      delete old.metadata;
      old.targetRevision = old.targetPackRevision;
      delete old.targetPackRevision;
    } else {
      delete old.targetPackRevision;
    }

    const result = migrateModSpec(old) as unknown as JsonObject &
      ValidationResult;
    expectIssue(result, "invalid", "required");
    assert.equal(result.schemaVersion, undefined, missing);
    assert.equal(result.spec, undefined, missing);
  }
});

test("revalidates migrated links and targets instead of returning an invalid ModSpec", () => {
  const invalidLegacyDocuments = [
    changed(["features", "0", "acceptanceIds", "0"], "missing_acceptance"),
    changed(["targetPackId"], ""),
  ];

  for (const old of invalidLegacyDocuments) {
    old.schemaVersion = "mod-spec-0.9.0";
    old.targetRevision = old.targetPackRevision;
    delete old.targetPackRevision;
    const oldMetadata = old.metadata as JsonObject;
    oldMetadata.title = oldMetadata.name;
    delete oldMetadata.name;

    const result = migrateModSpec(old) as unknown as JsonObject &
      ValidationResult;
    assert.equal(result.status, "invalid");
    assert.ok(result.issues && result.issues.length > 0);
    assert.equal(result.schemaVersion, undefined);
    assert.equal(result.spec, undefined);
  }
});

test("matches an independently calculated canonical SHA-256 golden", () => {
  assert.equal(
    canonicalModSpecHash(clone(fixture)),
    "a1641db838de2da657f8a47cf1fd3ac875994dfed13bd7c313c238df07171e98",
  );
});

test("canonical hashing ignores key insertion order and JSON transport", () => {
  const reordered = Object.fromEntries(
    Object.entries(clone(fixture)).reverse(),
  );
  reordered.metadata = Object.fromEntries(
    Object.entries(fixture.metadata as JsonObject).reverse(),
  );
  assert.equal(canonicalModSpecHash(reordered), canonicalModSpecHash(fixture));
  assert.equal(
    canonicalModSpecHash(JSON.parse(JSON.stringify(fixture))),
    canonicalModSpecHash(fixture),
  );
});

test("canonical hashing excludes timestamps, random IDs, and selector bookkeeping", () => {
  const volatile = clone(fixture);
  volatile.createdAt = "2026-01-01T00:00:00.000Z";
  volatile.timestamp = "2026-01-01T00:00:00.000Z";
  volatile.transactionId = "transaction-one";
  volatile.randomId = "random-one";
  volatile.selector = { feature: "first-match" };
  const volatileFeature = (volatile.features as JsonObject[])[0]!;
  const volatileAcceptance = (volatile.acceptance as JsonObject[])[0]!;
  volatileFeature.timestamp = "2026-01-01T00:00:00.000Z";
  volatileFeature.randomId = "random-feature";
  volatileAcceptance.selector = { check: 0 };

  const changedVolatile = clone(volatile);
  changedVolatile.createdAt = "2030-12-31T23:59:59.000Z";
  changedVolatile.timestamp = "2030-12-31T23:59:59.000Z";
  changedVolatile.transactionId = "transaction-two";
  changedVolatile.randomId = "random-two";
  changedVolatile.selector = { feature: "last-match" };
  const changedFeature = (changedVolatile.features as JsonObject[])[0]!;
  const changedAcceptance = (changedVolatile.acceptance as JsonObject[])[0]!;
  changedFeature.timestamp = "2030-12-31T23:59:59.000Z";
  changedFeature.randomId = "other-feature";
  changedAcceptance.selector = { check: 99 };

  assert.equal(canonicalModSpecHash(volatile), canonicalModSpecHash(fixture));
  assert.equal(
    canonicalModSpecHash(changedVolatile),
    canonicalModSpecHash(fixture),
  );
  assert.notEqual(
    canonicalModSpecHash(changed(["metadata", "name"], "Changed")),
    canonicalModSpecHash(fixture),
  );
});
