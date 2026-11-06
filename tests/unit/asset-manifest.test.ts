import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createAssetManifest,
  recordAssetExport,
  validateAssetManifest,
  type AssetManifest,
  type AssetManifestInput,
  type RuntimeFormat,
} from "../../src/core/assets/asset-manifest.ts";

const pngFormat: RuntimeFormat = "png";

type JsonObject = Record<string, unknown>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validInput(): AssetManifestInput {
  return {
    schemaVersion: "asset-manifest-1.0.0",
    targetPackId: "java-fabric-1.21.1-r1",
    targetPackRevision: 1,
    targetFormats: { resourcePack: 34, dataPack: 48 },
    visualScenarioIds: ["ruby_blade_inventory", "ruby_blade_first_person"],
    assets: [
      {
        id: "ruby_blade",
        kind: "java_block_item",
        editableSource: {
          path: "assets-src/ruby_blade.bbmodel",
          format: "bbmodel",
          bytes: "editable-blockbench-project",
        },
        exports: [
          {
            path: "src/main/resources/assets/ruby_tools/models/item/ruby_blade.json",
            format: "java_model_json",
            bytes: '{"parent":"minecraft:item/generated"}\n',
          },
          {
            path: "src/main/resources/assets/ruby_tools/textures/item/ruby_blade.png",
            format: "png",
            bytes: "png-bytes",
          },
        ],
        generation: {
          route: "fal",
          prompt: "16x16 ruby blade, crisp pixel art, approved style board",
          model: "fal-ai/flux-pro/v1.1-ultra",
          seed: 1729,
        },
        blockbench: {
          projectFormat: "java_block_item",
          applicationVersion: "5.2.2",
          exportSettings: { textureSize: [16, 16], ambientOcclusion: true },
        },
        provenance: [
          {
            sourceUrl: "https://example.invalid/reference/ruby-blade.png",
            author: "Voxellume Tests",
            license: "CC0-1.0",
            modifications:
              "Used only as a style reference; no reference pixels exported.",
            notices: ["Synthetic test reference."],
          },
        ],
      },
    ],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validManifest(): AssetManifest {
  return createAssetManifest(validInput());
}

function expectManifestIssue(manifest: unknown, code: string): void {
  const result = validateAssetManifest(manifest);
  assert.equal(result.status, "invalid");
  assert.ok(
    result.issues?.some((issue) => issue.code === code),
    `expected ${code}, received ${JSON.stringify(result)}`,
  );
  assert.ok(result.issues!.every((issue) => issue.path!.length > 0));
}

test("creates a complete manifest with independent source and export SHA-256 hashes", () => {
  const input = validInput();
  const before = clone(input);

  const manifest = createAssetManifest(input);

  assert.equal(manifest.schemaVersion, "asset-manifest-1.0.0");
  assert.equal(manifest.targetPackId, "java-fabric-1.21.1-r1");
  assert.equal(manifest.targetPackRevision, 1);
  assert.deepEqual(manifest.targetFormats, { resourcePack: 34, dataPack: 48 });
  assert.deepEqual(manifest.visualScenarioIds, [
    "ruby_blade_inventory",
    "ruby_blade_first_person",
  ]);
  assert.equal(manifest.assets[0]!.editableSource.format, "bbmodel");
  assert.equal(
    manifest.assets[0]!.editableSource.sha256,
    sha256("editable-blockbench-project"),
  );
  assert.equal(
    manifest.assets[0]!.exports[0]!.sha256,
    sha256('{"parent":"minecraft:item/generated"}\n'),
  );
  assert.equal(manifest.assets[0]!.exports[1]!.sha256, sha256("png-bytes"));
  assert.equal("bytes" in manifest.assets[0]!.editableSource, false);
  assert.equal("bytes" in manifest.assets[0]!.exports[0]!, false);
  assert.deepEqual(input, before);
});

test("records a replacement export immutably and preserves all provenance", () => {
  const manifest = validManifest();
  const before = clone(manifest);

  const result = recordAssetExport(manifest, {
    assetId: "ruby_blade",
    path: "src/main/resources/assets/ruby_tools/textures/item/ruby_blade.png",
    format: "png",
    bytes: "new-png-bytes",
  });

  assert.equal(result.status, "recorded");
  assert.ok(result.manifest);
  assert.equal(
    result.manifest.assets[0]!.exports[1]!.sha256,
    sha256("new-png-bytes"),
  );
  assert.deepEqual(manifest, before);
  assert.deepEqual(
    result.manifest.assets[0]!.generation,
    manifest.assets[0]!.generation,
  );
  assert.deepEqual(
    result.manifest.assets[0]!.provenance,
    manifest.assets[0]!.provenance,
  );
  assert.deepEqual(
    result.manifest.visualScenarioIds,
    manifest.visualScenarioIds,
  );
});

test("rejects export recording for unknown assets or undeclared export paths", () => {
  const manifest = validManifest();
  for (const request of [
    {
      assetId: "missing",
      path: "src/main/resources/assets/ruby_tools/textures/item/ruby_blade.png",
      format: pngFormat,
      bytes: "new",
    },
    {
      assetId: "ruby_blade",
      path: "src/main/resources/assets/ruby_tools/textures/item/unreviewed.png",
      format: pngFormat,
      bytes: "new",
    },
  ]) {
    const result = recordAssetExport(manifest, request);
    assert.equal(result.status, "invalid");
    assert.ok(
      result.issues?.some((issue) => issue.code === "unknown_asset_export"),
    );
  }
});

test("validates a created manifest and reports deterministic diagnostics without mutation", () => {
  const manifest = validManifest();
  const before = clone(manifest);
  assert.deepEqual(validateAssetManifest(manifest), {
    status: "valid",
    issues: [],
  });
  assert.deepEqual(manifest, before);

  const malformed = clone(manifest) as unknown as JsonObject;
  malformed.assets = [];
  const first = validateAssetManifest(malformed);
  const second = validateAssetManifest(malformed);
  assert.equal(first.status, "invalid");
  assert.deepEqual(first, second);
});

test("requires exact lowercase SHA-256 values for editable sources and every export", () => {
  for (const section of ["editableSource", "exports"] as const) {
    for (const hash of ["", "ABC123", "f".repeat(63), "g".repeat(64)]) {
      const manifest = clone(validManifest()) as unknown as JsonObject;
      const asset = (manifest.assets as JsonObject[])[0]!;
      if (section === "editableSource") {
        (asset.editableSource as JsonObject).sha256 = hash;
      } else {
        (asset.exports as JsonObject[])[0]!.sha256 = hash;
      }
      expectManifestIssue(manifest, "invalid_sha256");
    }
  }
});

test("requires one editable source and at least one runtime export per asset", () => {
  let manifest = clone(validManifest()) as unknown as JsonObject;
  delete (manifest.assets as JsonObject[])[0]!.editableSource;
  expectManifestIssue(manifest, "required");

  manifest = clone(validManifest()) as unknown as JsonObject;
  (manifest.assets as JsonObject[])[0]!.exports = [];
  expectManifestIssue(manifest, "missing_runtime_export");
});

test("supports only explicit editable-source to runtime generation routes", () => {
  for (const route of [
    "manual",
    "blockbench",
    "mc_asset",
    "host_ai",
    "fal",
    "comfyui_unfake",
  ] as const) {
    const input = validInput();
    input.assets[0]!.generation = {
      route,
      ...(route === "host_ai" || route === "fal" || route === "comfyui_unfake"
        ? { prompt: "ruby blade", model: "approved-model-v1", seed: 7 }
        : {}),
    };
    assert.equal(
      validateAssetManifest(createAssetManifest(input)).status,
      "valid",
    );
  }

  const input = validInput();
  (input.assets[0]!.generation as JsonObject).route =
    "unreviewed_remote_workflow";
  const manifest = createAssetManifest(input);
  expectManifestIssue(manifest, "unsupported_generation_route");
});

test("accepts direct JSON, PNG, and Java routes with matching editable and runtime formats", () => {
  for (const [route, editableFormat, runtimeFormat] of [
    ["direct_json", "json", "java_model_json"],
    ["direct_png", "png", "png"],
    ["direct_java", "java", "java"],
  ] as const) {
    const input = validInput();
    const asset = input.assets[0]!;
    asset.editableSource = {
      path: `assets-src/direct.${editableFormat}`,
      format: editableFormat,
      bytes: "direct-source",
    };
    asset.exports = [
      {
        path: `src/main/resources/direct.${runtimeFormat}`,
        format: runtimeFormat,
        bytes: "direct-source",
      },
    ];
    asset.generation = { route };
    delete (asset as unknown as JsonObject).blockbench;

    const manifest = createAssetManifest(input);
    assert.equal(validateAssetManifest(manifest).status, "valid");
    assert.equal(manifest.assets[0]!.generation.route, route);
  }
});

test("requires prompt, exact model identity, and integer seed for every AI route", () => {
  for (const route of ["host_ai", "fal", "comfyui_unfake"] as const) {
    for (const field of ["prompt", "model", "seed"] as const) {
      const manifest = clone(validManifest());
      manifest.assets[0]!.generation.route = route;
      delete (manifest.assets[0]!.generation as JsonObject)[field];
      expectManifestIssue(manifest, "required");
    }
  }

  const manifest = clone(validManifest());
  manifest.assets[0]!.generation.seed = 1.5;
  expectManifestIssue(manifest, "invalid_generation_seed");
});

test("records complete Blockbench project format, application version, and export settings", () => {
  for (const field of [
    "projectFormat",
    "applicationVersion",
    "exportSettings",
  ] as const) {
    const manifest = clone(validManifest());
    delete (manifest.assets[0]!.blockbench as JsonObject)[field];
    expectManifestIssue(manifest, "required");
  }

  const manifest = clone(validManifest());
  manifest.assets[0]!.blockbench!.applicationVersion = "latest";
  expectManifestIssue(manifest, "non_exact_blockbench_version");
});

test("requires source URL, author, license, modifications, and notices provenance", () => {
  for (const field of [
    "sourceUrl",
    "author",
    "license",
    "modifications",
    "notices",
  ] as const) {
    const manifest = clone(validManifest());
    delete (manifest.assets[0]!.provenance[0]! as JsonObject)[field];
    expectManifestIssue(manifest, "required");
  }

  const manifest = clone(validManifest());
  manifest.assets[0]!.provenance[0]!.sourceUrl =
    "file:///private/reference.png";
  expectManifestIssue(manifest, "invalid_provenance_url");
});

test("requires exact target pack revision and positive resource/data formats", () => {
  for (const value of [0, -1, 1.5]) {
    const manifest = clone(validManifest());
    manifest.targetPackRevision = value;
    expectManifestIssue(manifest, "invalid_target_revision");
  }
  for (const field of ["resourcePack", "dataPack"] as const) {
    const manifest = clone(validManifest());
    manifest.targetFormats[field] = 0;
    expectManifestIssue(manifest, "invalid_target_format");
  }
});

test("requires unique stable visual scenario IDs and asset IDs", () => {
  let manifest = clone(validManifest());
  manifest.visualScenarioIds = ["inventory", "inventory"];
  expectManifestIssue(manifest, "duplicate_scenario_id");

  manifest = clone(validManifest());
  manifest.assets.push(clone(manifest.assets[0]!));
  expectManifestIssue(manifest, "duplicate_asset_id");
});

test("keeps Java Block/Item and Modded Entity projects and exports incompatible", () => {
  let manifest = clone(validManifest());
  manifest.assets[0]!.blockbench!.projectFormat = "modded_entity";
  expectManifestIssue(manifest, "incompatible_asset_format");

  manifest = clone(validManifest());
  manifest.assets[0]!.exports[0]!.format = "geckolib_geometry_json";
  expectManifestIssue(manifest, "incompatible_asset_format");

  manifest = clone(validManifest());
  manifest.assets[0]!.exports.push({
    path: "src/main/resources/assets/ruby_tools/animations/ruby_blade.animation.json",
    format: "geckolib_animation_json",
    sha256: sha256("animation"),
  });
  expectManifestIssue(manifest, "incompatible_asset_format");

  const input = validInput();
  input.assets[0]!.kind = "modded_entity";
  input.assets[0]!.blockbench!.projectFormat = "modded_entity";
  input.assets[0]!.exports = [
    {
      path: "src/main/resources/assets/ruby_tools/geo/ruby_blade.geo.json",
      format: "geckolib_geometry_json",
      bytes: "geometry",
    },
    {
      path: "src/main/resources/assets/ruby_tools/animations/ruby_blade.animation.json",
      format: "geckolib_animation_json",
      bytes: "animation",
    },
  ];
  assert.equal(
    validateAssetManifest(createAssetManifest(input)).status,
    "valid",
  );
});

test("rejects Modded Entity delivery through Java model or direct Java Block/Item routes", () => {
  const manifest = clone(validManifest());
  manifest.assets[0]!.kind = "modded_entity";
  manifest.assets[0]!.blockbench!.projectFormat = "modded_entity";
  expectManifestIssue(manifest, "incompatible_asset_format");
});

test("rejects inherited object property names as generation routes", () => {
  for (const route of ["constructor", "toString", "__proto__"]) {
    const manifest = clone(validManifest());
    (manifest.assets[0]!.generation as JsonObject).route = route;
    expectManifestIssue(manifest, "unsupported_generation_route");
  }
});

test("rejects inherited object property names as editable source formats", () => {
  for (const format of ["constructor", "toString", "__proto__"]) {
    const manifest = clone(validManifest());
    (manifest.assets[0]!.editableSource as JsonObject).format = format;
    expectManifestIssue(manifest, "unsupported_editable_format");
  }
});

test("rejects inherited object property names as runtime export formats", () => {
  for (const format of ["constructor", "toString", "__proto__"]) {
    const manifest = clone(validManifest());
    (manifest.assets[0]!.exports[0]! as JsonObject).format = format;
    expectManifestIssue(manifest, "unsupported_export_format");
  }
});

test("returns schema diagnostics for null provenance entries instead of throwing", () => {
  const manifest = clone(validManifest());
  manifest.assets[0]!.provenance = [
    null,
  ] as unknown as AssetManifest["assets"][number]["provenance"];
  expectManifestIssue(manifest, "type");
});

test("rejects unknown fields so provenance cannot be silently discarded", () => {
  const manifest = clone(validManifest()) as unknown as JsonObject;
  manifest.unreviewedRemoteWorkflow = "https://example.invalid/workflow.json";
  expectManifestIssue(manifest, "unknown_field");
});
