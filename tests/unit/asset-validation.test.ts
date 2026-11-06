import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  validateAssets,
  type AssetValidationRequest,
} from "../../src/core/assets/validate-assets.ts";

type JsonObject = Record<string, unknown>;
type AssetValidationResult = {
  status: string;
  issues?: Array<{ code: string; path: string }>;
};

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validFiles(): Record<string, string> {
  return {
    "src/main/resources/fabric.mod.json": json({
      schemaVersion: 1,
      id: "ruby_tools",
      version: "1.0.0",
      name: "Ruby Tools",
      depends: { minecraft: "1.21.1" },
    }),
    "src/main/resources/assets/ruby_tools/blockstates/ruby_block.json": json({
      variants: { "": { model: "ruby_tools:block/ruby_block" } },
    }),
    "src/main/resources/assets/ruby_tools/models/block/ruby_block.json": json({
      parent: "minecraft:block/cube_all",
      textures: { all: "ruby_tools:block/ruby_block" },
    }),
    "src/main/resources/assets/ruby_tools/models/item/ruby_blade.json": json({
      parent: "minecraft:item/generated",
      textures: { layer0: "ruby_tools:item/ruby_blade" },
      display: {
        gui: { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [1, 1, 1] },
        firstperson_righthand: {
          rotation: [0, 45, 0],
          translation: [0, 2, 0],
          scale: [0.8, 0.8, 0.8],
        },
      },
      overrides: [
        {
          predicate: { "ruby_tools:charged": 1 },
          model: "ruby_tools:item/ruby_blade_charged",
        },
      ],
    }),
    "src/main/resources/assets/ruby_tools/models/item/ruby_blade_charged.json":
      json({
        parent: "ruby_tools:item/ruby_blade",
        textures: { layer0: "ruby_tools:item/ruby_blade_charged" },
      }),
    "src/main/resources/assets/ruby_tools/textures/block/ruby_block.png":
      "block-png",
    "src/main/resources/assets/ruby_tools/textures/item/ruby_blade.png":
      "item-png",
    "src/main/resources/assets/ruby_tools/textures/item/ruby_blade.png.mcmeta":
      json({
        animation: { frametime: 2, frames: [0, 1], interpolate: false },
      }),
    "src/main/resources/assets/ruby_tools/textures/item/ruby_blade_charged.png":
      "charged-png",
    "src/main/resources/assets/ruby_tools/lang/en_us.json": json({
      "block.ruby_tools.ruby_block": "Ruby Block",
      "item.ruby_tools.ruby_blade": "Ruby Blade",
      "item.ruby_tools.ruby_blade.charged": "Charged with %s",
    }),
    "src/main/resources/assets/ruby_tools/lang/ru_ru.json": json({
      "block.ruby_tools.ruby_block": "Рубиновый блок",
      "item.ruby_tools.ruby_blade": "Рубиновый клинок",
      "item.ruby_tools.ruby_blade.charged": "Заряжено: %s",
    }),
    "src/main/resources/assets/ruby_tools/sounds.json": json({
      ruby_use: {
        sounds: [{ name: "ruby_tools:ruby_use", type: "file" }],
      },
    }),
    "src/main/resources/assets/ruby_tools/sounds/ruby_use.ogg": "sound",
    "src/main/resources/data/ruby_tools/recipes/ruby_blade.json": json({
      type: "minecraft:crafting_shaped",
      pattern: ["#", "/"],
      key: {
        "#": { item: "ruby_tools:ruby_block" },
        "/": { item: "minecraft:stick" },
      },
      result: { id: "ruby_tools:ruby_blade", count: 1 },
    }),
    "src/main/resources/data/ruby_tools/loot_table/blocks/ruby_block.json":
      json({
        type: "minecraft:block",
        pools: [
          {
            rolls: 1,
            entries: [
              { type: "minecraft:item", name: "ruby_tools:ruby_block" },
            ],
          },
        ],
      }),
    "src/main/resources/data/ruby_tools/tags/items/swords.json": json({
      replace: false,
      values: ["ruby_tools:ruby_blade"],
    }),
    "src/main/resources/data/ruby_tools/worldgen/configured_feature/ruby_ore.json":
      json({
        type: "minecraft:ore",
        config: {
          targets: [],
          size: 4,
          discard_chance_on_air_exposure: 0,
          state: { Name: "ruby_tools:ruby_block" },
        },
      }),
    "src/main/resources/data/ruby_tools/worldgen/placed_feature/ruby_ore.json":
      json({
        feature: "ruby_tools:ruby_ore",
        placement: [],
      }),
  };
}

function validRequest(): AssetValidationRequest {
  const files = validFiles();
  const generated =
    "src/main/resources/data/ruby_tools/recipes/ruby_blade.json";
  return {
    modId: "ruby_tools",
    namespace: "ruby_tools",
    metadataFile: "src/main/resources/fabric.mod.json",
    targetPack: {
      id: "java-fabric-1.21.1-r1",
      revision: 1,
      minecraftVersion: "1.21.1",
      resourcePackFormat: 34,
      dataPackFormat: 48,
    },
    files,
    registry: [
      { kind: "item", id: "ruby_tools:ruby_blade" },
      { kind: "block", id: "ruby_tools:ruby_block" },
      { kind: "sound_event", id: "ruby_tools:ruby_use" },
      { kind: "configured_feature", id: "ruby_tools:ruby_ore" },
      { kind: "placed_feature", id: "ruby_tools:ruby_ore" },
    ],
    animations: [
      {
        texture:
          "src/main/resources/assets/ruby_tools/textures/item/ruby_blade.png",
        frameCount: 2,
      },
    ],
    requiredLangKeys: [
      "block.ruby_tools.ruby_block",
      "item.ruby_tools.ruby_blade",
      "item.ruby_tools.ruby_blade.charged",
    ],
    datagen: [{ path: generated, expectedSha256: sha256(files[generated]!) }],
  };
}

function tomlMetadata(loaderVersion: string): string {
  return `modLoader = "javafml"
loaderVersion = "${loaderVersion}"
license = "MIT"

[[mods]]
modId = "ruby_tools"
version = "1.0.0"
displayName = "Ruby Tools"

[[dependencies.ruby_tools]]
modId = "minecraft"
type = "required"
versionRange = "[1.21.1,1.21.2)"
ordering = "NONE"
side = "BOTH"
`;
}

function tomlRequest(metadataFile: string): AssetValidationRequest {
  const request = validRequest();
  delete request.files[request.metadataFile];
  request.metadataFile = metadataFile;
  request.files[metadataFile] = tomlMetadata(
    metadataFile.includes("neoforge") ? "[4,)" : "[47,)",
  );
  return request;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function changeFile(
  path: string,
  mutate: (document: JsonObject) => void,
): AssetValidationRequest {
  const request = validRequest();
  const document = JSON.parse(request.files[path]!) as JsonObject;
  mutate(document);
  request.files[path] = json(document);
  return request;
}

function expectValid(request: AssetValidationRequest): void {
  assert.deepEqual(validateAssets(request), { status: "valid", issues: [] });
}

function expectIssue(request: AssetValidationRequest, code: string): void {
  const result = validateAssets(request) as AssetValidationResult;
  assert.equal(result.status, "invalid");
  assert.ok(
    result.issues?.some((issue) => issue.code === code),
    `expected ${code}, received ${JSON.stringify(result)}`,
  );
  assert.ok(result.issues!.every((issue) => issue.path!.length > 0));
}

test("accepts a complete cross-linked asset set without mutating the request", () => {
  const request = validRequest();
  const before = clone(request);
  expectValid(request);
  assert.deepEqual(request, before);
});

test("requires valid metadata and exact mod identity", () => {
  let request = validRequest();
  delete request.files[request.metadataFile];
  expectIssue(request, "missing_mod_metadata");

  request = changeFile(validRequest().metadataFile, (metadata) => {
    metadata.id = "other_mod";
  });
  expectIssue(request, "metadata_mod_id_mismatch");

  request = changeFile(validRequest().metadataFile, (metadata) => {
    metadata.depends = { minecraft: "1.21.2" };
  });
  expectIssue(request, "metadata_target_mismatch");
});

test("parses real NeoForge and Forge TOML mod metadata", () => {
  for (const metadataFile of [
    "src/main/resources/META-INF/neoforge.mods.toml",
    "src/main/resources/META-INF/mods.toml",
  ]) {
    expectValid(tomlRequest(metadataFile));
  }
});

test("accepts actual pinned Fabric and NeoForge target dependency ranges", () => {
  const fabric = changeFile(validRequest().metadataFile, (metadata) => {
    metadata.depends = { minecraft: "~1.21.1" };
  });
  const neoforge = tomlRequest(
    "src/main/resources/META-INF/neoforge.mods.toml",
  );
  const metadataPath = neoforge.metadataFile;
  neoforge.files[metadataPath] = neoforge.files[metadataPath]!.replace(
    '[[dependencies.ruby_tools]]\nmodId = "minecraft"\ntype = "required"\nversionRange = "[1.21.1,1.21.2)"',
    '[[dependencies.ruby_tools]]\nmodId = "neoforge"\ntype = "required"\nversionRange = "[21.1.0,)"\nordering = "NONE"\nside = "BOTH"\n\n[[dependencies.ruby_tools]]\nmodId = "minecraft"\ntype = "required"\nversionRange = "[1.21.1]"',
  );

  for (const [minecraftVersion, resourcePackFormat, dataPackFormat] of [
    ["1.21.1", 34, 48],
    ["1.21.2", 42, 57],
    ["1.21.3", 42, 57],
    ["1.21.4", 46, 61],
    ["1.21.5", 55, 71],
    ["1.21.6", 63, 80],
    ["1.21.7", 64, 81],
    ["1.21.8", 64, 81],
    ["1.21.9", 69, 88],
    ["1.21.10", 69, 88],
    ["1.21.11", 75, 94.1],
  ] as const) {
    const request = clone(fabric);
    request.targetPack.minecraftVersion = minecraftVersion;
    request.targetPack.resourcePackFormat = resourcePackFormat;
    request.targetPack.dataPackFormat = dataPackFormat;
    expectValid(request);
  }

  const wrongMinor = clone(fabric);
  wrongMinor.targetPack.minecraftVersion = "1.22.0";
  assert.equal(validateAssets(wrongMinor).status, "invalid");

  const wrongMajor = clone(fabric);
  wrongMajor.targetPack.minecraftVersion = "26.1";
  wrongMajor.targetPack.resourcePackFormat = 84;
  wrongMajor.targetPack.dataPackFormat = 101.1;
  expectIssue(wrongMajor, "metadata_target_mismatch");

  expectValid(neoforge);
  neoforge.targetPack.minecraftVersion = "1.21.2";
  neoforge.targetPack.resourcePackFormat = 42;
  neoforge.targetPack.dataPackFormat = 57;
  expectIssue(neoforge, "metadata_target_mismatch");
});

test("rejects wrong identity, missing display metadata, and wrong Minecraft dependencies in TOML", () => {
  for (const metadataFile of [
    "src/main/resources/META-INF/neoforge.mods.toml",
    "src/main/resources/META-INF/mods.toml",
  ]) {
    for (const [contents, code] of [
      [
        tomlMetadata(
          metadataFile.includes("neoforge") ? "[4,)" : "[47,)",
        ).replace('modId = "ruby_tools"', 'modId = "other_mod"'),
        "metadata_mod_id_mismatch",
      ],
      [
        tomlMetadata(
          metadataFile.includes("neoforge") ? "[4,)" : "[47,)",
        ).replace('version = "1.0.0"', 'version = ""'),
        "metadata_version_invalid",
      ],
      [
        tomlMetadata(
          metadataFile.includes("neoforge") ? "[4,)" : "[47,)",
        ).replace('displayName = "Ruby Tools"\n', ""),
        "metadata_name_missing",
      ],
      [
        tomlMetadata(
          metadataFile.includes("neoforge") ? "[4,)" : "[47,)",
        ).replace(
          'versionRange = "[1.21.1,1.21.2)"',
          'versionRange = "[1.21.2,1.21.3)"',
        ),
        "metadata_target_mismatch",
      ],
    ] as const) {
      const request = tomlRequest(metadataFile);
      request.files[metadataFile] = contents;
      expectIssue(request, code);
    }
  }
});

test("returns diagnostics for malformed and prototype-polluting TOML without throwing", () => {
  for (const contents of [
    '[[mods]\nmodId = "ruby_tools"',
    `${tomlMetadata("[47,)")}\n[__proto__]\npolluted = true\n`,
  ]) {
    const request = tomlRequest("src/main/resources/META-INF/mods.toml");
    request.files[request.metadataFile] = contents;
    const result = validateAssets(request) as AssetValidationResult;
    assert.equal(result.status, "invalid");
    assert.ok(result.issues!.length > 0);
  }
});

test("rejects malformed identifiers and namespace escapes at every asset boundary", () => {
  for (const namespace of ["Ruby_tools", "ruby-tools", "1ruby", "ruby tools"]) {
    const request = validRequest();
    request.namespace = namespace;
    expectIssue(request, "invalid_identifier");
  }
  const request = validRequest();
  request.registry.push({ kind: "item", id: "Other:ruby_blade" });
  expectIssue(request, "invalid_identifier");
});

test("resolves blockstate model references and rejects missing models", () => {
  const request = changeFile(
    "src/main/resources/assets/ruby_tools/blockstates/ruby_block.json",
    (blockstate) => {
      blockstate.variants = { "": { model: "ruby_tools:block/missing" } };
    },
  );
  expectIssue(request, "missing_model_reference");
});

test("resolves model parents transitively and rejects missing parents and cycles", () => {
  let request = changeFile(
    "src/main/resources/assets/ruby_tools/models/block/ruby_block.json",
    (model) => {
      model.parent = "ruby_tools:block/missing";
    },
  );
  expectIssue(request, "missing_model_parent");

  request = changeFile(
    "src/main/resources/assets/ruby_tools/models/item/ruby_blade_charged.json",
    (model) => {
      model.parent = "ruby_tools:item/ruby_blade_charged";
    },
  );
  expectIssue(request, "model_parent_cycle");
});

test("resolves texture variables and rejects missing texture references", () => {
  const request = changeFile(
    "src/main/resources/assets/ruby_tools/models/item/ruby_blade_charged.json",
    (model) => {
      model.textures = { layer0: "ruby_tools:item/missing" };
    },
  );
  expectIssue(request, "missing_texture_reference");
});

test("requires animation metadata beside an animated texture and validates frame references", () => {
  let request = validRequest();
  delete request.files[
    "src/main/resources/assets/ruby_tools/textures/item/ruby_blade.png.mcmeta"
  ];
  expectIssue(request, "missing_animation_metadata");

  request = changeFile(
    "src/main/resources/assets/ruby_tools/textures/item/ruby_blade.png.mcmeta",
    (metadata) => {
      metadata.animation = { frametime: 0, frames: [0, -1] };
    },
  );
  expectIssue(request, "invalid_animation_reference");
});

test("rejects overrides whose target model does not exist", () => {
  const request = changeFile(
    "src/main/resources/assets/ruby_tools/models/item/ruby_blade.json",
    (model) => {
      model.overrides = [
        {
          predicate: { "ruby_tools:charged": 1 },
          model: "ruby_tools:item/missing",
        },
      ];
    },
  );
  expectIssue(request, "missing_override_model");
});

test("validates every display transform as finite three-component Minecraft values", () => {
  for (const [field, value] of [
    ["rotation", [0, 0]],
    ["translation", [0, null, 0]],
    ["scale", [0, 0, 0]],
    ["scale", [5, 1, 1]],
  ] as const) {
    const request = changeFile(
      "src/main/resources/assets/ruby_tools/models/item/ruby_blade.json",
      (model) => {
        (model.display as JsonObject).gui = {
          rotation: [0, 0, 0],
          translation: [0, 0, 0],
          scale: [1, 1, 1],
          [field]: value,
        };
      },
    );
    expectIssue(request, "invalid_display_transform");
  }
});

test("requires declared lang keys and matching ordered placeholders across locales", () => {
  let request = validRequest();
  request.requiredLangKeys.push("item.ruby_tools.missing");
  expectIssue(request, "missing_lang_key");

  request = changeFile(
    "src/main/resources/assets/ruby_tools/lang/ru_ru.json",
    (lang) => {
      lang["item.ruby_tools.ruby_blade.charged"] = "Заряжено";
    },
  );
  expectIssue(request, "lang_placeholder_mismatch");

  request = changeFile(
    "src/main/resources/assets/ruby_tools/lang/ru_ru.json",
    (lang) => {
      lang["item.ruby_tools.ruby_blade.charged"] = "Заряжено %d";
    },
  );
  expectIssue(request, "lang_placeholder_mismatch");
});

test("treats explicit positional and implicit printf placeholders as equivalent", () => {
  let request = changeFile(
    "src/main/resources/assets/ruby_tools/lang/en_us.json",
    (lang) => {
      lang["item.ruby_tools.ruby_blade.charged"] = "Charged with %1$s";
    },
  );
  expectValid(request);

  request = changeFile(
    "src/main/resources/assets/ruby_tools/lang/ru_ru.json",
    (lang) => {
      lang["item.ruby_tools.ruby_blade.charged"] = "Заряжено: %1$s";
    },
  );
  expectValid(request);
});

test("validates recipe results and ingredients against the registry", () => {
  for (const path of [
    ["result", "id"],
    ["key", "#", "item"],
  ] as const) {
    const request = changeFile(
      "src/main/resources/data/ruby_tools/recipes/ruby_blade.json",
      (recipe) => {
        let parent: unknown = recipe;
        for (const segment of path.slice(0, -1)) {
          parent = (parent as JsonObject)[segment];
        }
        (parent as JsonObject)[path.at(-1)!] = "ruby_tools:missing";
      },
    );
    expectIssue(request, "unknown_recipe_reference");
  }
});

test("validates loot entry registry references", () => {
  const request = changeFile(
    "src/main/resources/data/ruby_tools/loot_table/blocks/ruby_block.json",
    (loot) => {
      ((loot.pools as JsonObject[])[0]!.entries as JsonObject[])[0]!.name =
        "ruby_tools:missing";
    },
  );
  expectIssue(request, "unknown_loot_reference");
});

test("validates item tags without silently accepting unknown IDs", () => {
  const request = changeFile(
    "src/main/resources/data/ruby_tools/tags/items/swords.json",
    (tag) => {
      tag.values = ["ruby_tools:missing"];
    },
  );
  expectIssue(request, "unknown_tag_entry");
});

test("validates configured and placed worldgen cross-file links and block states", () => {
  let request = changeFile(
    "src/main/resources/data/ruby_tools/worldgen/configured_feature/ruby_ore.json",
    (feature) => {
      ((feature.config as JsonObject).state as JsonObject).Name =
        "ruby_tools:missing";
    },
  );
  expectIssue(request, "unknown_worldgen_block");

  request = changeFile(
    "src/main/resources/data/ruby_tools/worldgen/placed_feature/ruby_ore.json",
    (feature) => {
      feature.feature = "ruby_tools:missing";
    },
  );
  expectIssue(request, "unknown_configured_feature");
});

test("rejects duplicate registry IDs even when their kinds and namespaces otherwise match", () => {
  const request = validRequest();
  request.registry.push({ kind: "item", id: "ruby_tools:ruby_blade" });
  expectIssue(request, "duplicate_registry_id");
});

test("rejects asset namespaces that disagree with the declared mod namespace", () => {
  const request = changeFile(
    "src/main/resources/assets/ruby_tools/blockstates/ruby_block.json",
    (blockstate) => {
      blockstate.variants = { "": { model: "other:block/ruby_block" } };
    },
  );
  expectIssue(request, "namespace_mismatch");
});

test("validates sound event registry entries and sound file links", () => {
  let request = validRequest();
  delete request.files[
    "src/main/resources/assets/ruby_tools/sounds/ruby_use.ogg"
  ];
  expectIssue(request, "missing_sound_file");

  request = validRequest();
  request.registry = request.registry.filter(
    (entry) => entry.kind !== "sound_event",
  );
  expectIssue(request, "unknown_sound_event");
});

test("rejects unknown Minecraft versions before accepting arbitrary pack formats", () => {
  const request = validRequest();
  request.targetPack.minecraftVersion = "1.99.99";
  request.targetPack.resourcePackFormat = 999999;
  request.targetPack.dataPackFormat = 888888;
  expectIssue(request, "unsupported_minecraft_version");
});

test("requires exact target resource and data pack formats", () => {
  for (const field of ["resourcePackFormat", "dataPackFormat"] as const) {
    const request = validRequest();
    request.targetPack[field] += 1;
    expectIssue(request, "pack_format_mismatch");
  }
});

test("detects stale generated output by comparing immutable expected hashes", () => {
  const request = validRequest();
  request.datagen[0]!.expectedSha256 = sha256("stale");
  expectIssue(request, "stale_datagen_output");
});

test("returns datagen diagnostics for inherited object property paths without throwing", () => {
  for (const path of ["__proto__", "constructor"]) {
    const request = validRequest();
    request.datagen = [{ path, expectedSha256: sha256("missing") }];
    expectIssue(request, "stale_datagen_output");
  }
});

test("rejects inherited object property names as registry kinds", () => {
  for (const kind of ["constructor", "toString", "__proto__"]) {
    const request = validRequest();
    (request.registry[0]! as unknown as JsonObject).kind = kind;
    expectIssue(request, "unsupported_registry_kind");
  }
});

test("rejects inherited object property names as metadata file paths", () => {
  for (const metadataFile of ["constructor", "toString", "__proto__"]) {
    const request = validRequest();
    request.metadataFile = metadataFile;
    expectIssue(request, "invalid_metadata_file");
  }
});

test("reports malformed JSON instead of throwing or skipping dependent checks", () => {
  const request = validRequest();
  request.files[
    "src/main/resources/assets/ruby_tools/models/block/ruby_block.json"
  ] = "{not-json";
  const first = validateAssets(request) as AssetValidationResult;
  const second = validateAssets(request) as AssetValidationResult;
  expectIssue(request, "malformed_json");
  assert.deepEqual(first, second);
});
