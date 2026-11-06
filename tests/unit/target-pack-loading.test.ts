import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../../src/core/targets/canonical-json.ts";
import { loadTargetPacks } from "../../src/core/targets/load-target-packs.ts";

const validFixture = fileURLToPath(
  new URL("../../fixtures/target-packs/valid/", import.meta.url),
);
const malformedFixture = fileURLToPath(
  new URL("../../fixtures/target-packs/malformed-json/", import.meta.url),
);
const packRelativePath = "java/fabric/1.21.1";
const fixtureFiles = ["target.json", "docs.json", "verification.json"] as const;
type FixtureFile = (typeof fixtureFiles)[number];
type JsonObject = Record<string, unknown>;
type PackDocuments = Record<FixtureFile, JsonObject>;

interface Mutation {
  file: FixtureFile;
  path: readonly string[];
  value?: unknown;
  remove?: boolean;
}

const unsupportedReason = {
  code: "loader_release_unavailable",
  detail: "The exact loader release is unavailable upstream.",
  evidence: [
    {
      url: "https://meta.fabricmc.net/v2/versions/loader/1.21.1",
      sha256:
        "9b2e18a69c684e429f52ef93dc829b865b4e2986a6a21ea57a2c77a84ab15e21",
    },
  ],
};

function packDirectory(root: string): string {
  return join(root, packRelativePath);
}

async function readPack(directory: string): Promise<PackDocuments> {
  const entries = await Promise.all(
    fixtureFiles.map(async (file) => [
      file,
      JSON.parse(await readFile(join(directory, file), "utf8")) as JsonObject,
    ]),
  );
  return Object.fromEntries(entries) as PackDocuments;
}

async function writePack(
  directory: string,
  documents: PackDocuments,
): Promise<void> {
  await Promise.all(
    fixtureFiles.map((file) =>
      writeFile(
        join(directory, file),
        `${JSON.stringify(documents[file], null, 2)}\n`,
      ),
    ),
  );
}

function mutate(
  documents: PackDocuments,
  operations: readonly Mutation[],
): void {
  for (const operation of operations) {
    const document = documents[operation.file];
    let parent = document;
    for (const segment of operation.path.slice(0, -1)) {
      parent = parent[segment] as JsonObject;
    }
    const key = operation.path.at(-1);
    assert.ok(key, "mutation path must not be empty");
    if (operation.remove) delete parent[key];
    else parent[key] = operation.value;
  }
}

async function cloneValidPack(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-target-packs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(validFixture, root, { recursive: true });
  return root;
}

async function mutatedPack(
  t: TestContext,
  operations: readonly Mutation[],
  rehash = true,
): Promise<string> {
  const root = await cloneValidPack(t);
  const directory = packDirectory(root);
  const documents = await readPack(directory);
  mutate(documents, operations);
  await writePack(directory, documents);
  const changesPackHash = operations.some(
    (operation) =>
      operation.file === "target.json" &&
      operation.path.length === 1 &&
      operation.path[0] === "packSha256",
  );
  if (rehash && !changesPackHash) await rehashPack(directory);
  return root;
}

async function rehashPack(directory: string): Promise<void> {
  const documents = await readPack(directory);
  const target = documents["target.json"];
  const { packSha256: _excluded, ...unsigned } = target;
  target.packSha256 = createHash("sha256")
    .update(canonicalJson(unsigned))
    .digest("hex");
  await writePack(directory, documents);
}

async function assertInvalid(root: string, diagnostic: RegExp): Promise<void> {
  await assert.rejects(loadTargetPacks(root), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, diagnostic);
    return true;
  });
}

test("loads a valid three-file pack with its qualification evidence", async () => {
  const packs = await loadTargetPacks(validFixture);

  assert.equal(packs.length, 1);
  assert.equal(packs[0]?.id, "java-fabric-1.21.1-r1");
  assert.equal(packs[0]?.minecraft.version, "1.21.1");
  assert.equal(packs[0]?.loader.version, "0.20.1");
  assert.equal(packs[0]?.java.toolchain, 21);
  assert.equal(
    packs[0]?.verification.evidenceManifest?.sha256,
    "9b2e18a69c684e429f52ef93dc829b865b4e2986a6a21ea57a2c77a84ab15e21",
  );
});

test("returns packs in deterministic lexical registry order", async (t) => {
  const root = await cloneValidPack(t);
  for (const loader of ["quilt", "neoforge", "forge"]) {
    const destination = join(root, "java", loader, "1.21.1");
    await cp(packDirectory(root), destination, { recursive: true });
    const documents = await readPack(destination);
    mutate(documents, [
      { file: "target.json", path: ["id"], value: `java-${loader}-1.21.1-r1` },
      { file: "target.json", path: ["loader", "id"], value: loader },
    ]);
    await writePack(destination, documents);
    await rehashPack(destination);
  }

  const first = await loadTargetPacks(root);
  const second = await loadTargetPacks(root);

  assert.deepEqual(
    first.map((pack) => pack.id),
    [
      "java-fabric-1.21.1-r1",
      "java-forge-1.21.1-r1",
      "java-neoforge-1.21.1-r1",
      "java-quilt-1.21.1-r1",
    ],
  );
  assert.deepEqual(second, first);
});

for (const status of ["unsupported", "rejected"] as const) {
  test(`accepts ${status} packs with reasons and without executable verification`, async (t) => {
    const root = await mutatedPack(t, [
      { file: "target.json", path: ["status"], value: status },
      { file: "target.json", path: ["reason"], value: unsupportedReason },
      { file: "target.json", path: ["template"], remove: true },
      { file: "verification.json", path: ["capabilities"], value: {} },
      { file: "verification.json", path: ["required"], value: [] },
      { file: "verification.json", path: ["checks"], value: {} },
      { file: "verification.json", path: ["testedPlatforms"], value: [] },
      { file: "verification.json", path: ["evidenceManifest"], remove: true },
    ]);

    const packs = await loadTargetPacks(root);

    assert.equal(packs.length, 1);
    assert.equal(packs[0]?.status, status);
    assert.equal(packs[0]?.reason?.code, unsupportedReason.code);
  });
}

test("rejects duplicate pack IDs", async (t) => {
  const root = await cloneValidPack(t);
  const destination = join(root, "java/neoforge/1.21.2");
  await cp(packDirectory(root), destination, { recursive: true });
  const documents = await readPack(destination);
  mutate(documents, [
    { file: "target.json", path: ["loader", "id"], value: "neoforge" },
    { file: "target.json", path: ["minecraft", "version"], value: "1.21.2" },
    {
      file: "target.json",
      path: ["minecraft", "releaseJsonUrl"],
      value: "https://fixtures.invalid/minecraft/1.21.2.json",
    },
  ]);
  await writePack(destination, documents);
  await rehashPack(destination);

  await assertInvalid(root, /duplicate.*id|id.*duplicate/i);
});

test("rejects duplicate edition, loader, and Minecraft coordinates", async (t) => {
  const root = await cloneValidPack(t);
  const destination = join(root, "java/fabric/duplicate-revision");
  await cp(packDirectory(root), destination, { recursive: true });
  const documents = await readPack(destination);
  mutate(documents, [
    {
      file: "target.json",
      path: ["id"],
      value: "java-fabric-1.21.1-r2",
    },
    { file: "target.json", path: ["revision"], value: 2 },
  ]);
  await writePack(destination, documents);
  await rehashPack(destination);

  await assertInvalid(root, /duplicate.*coordinate|coordinate.*duplicate/i);
});

test("rejects missing target, docs, and verification files", async (t) => {
  for (const file of fixtureFiles) {
    await t.test(file, async (t) => {
      const root = await cloneValidPack(t);
      await rm(join(packDirectory(root), file));
      await assertInvalid(root, new RegExp(file.replace(".", "\\.")));
    });
  }
});

test("rejects malformed target JSON", async () => {
  await assertInvalid(malformedFixture, /target\.json|JSON|parse/i);
});

test("rejects malformed docs and verification JSON", async (t) => {
  for (const file of ["docs.json", "verification.json"] as const) {
    await t.test(file, async (t) => {
      const root = await cloneValidPack(t);
      await writeFile(join(packDirectory(root), file), "{ not-json\n");
      await assertInvalid(root, new RegExp(file.replace(".", "\\.")));
    });
  }
});

test("rejects unknown fields in every pack document", async (t) => {
  for (const file of fixtureFiles) {
    await t.test(file, async (t) => {
      const root = await mutatedPack(t, [
        { file, path: ["unexpected"], value: true },
      ]);
      await assertInvalid(root, /unexpected|unknown|additional/i);
    });
  }
});

const invalidExactValues = [
  ["latest Minecraft", ["minecraft", "version"], "latest"],
  ["ranged loader", ["loader", "version"], "^0.20.1"],
  ["latest API", ["loader", "apiDependencies", "0", "version"], "latest"],
  ["latest Gradle", ["gradle", "version"], "latest"],
  ["ranged plugin", ["gradle", "plugins", "0", "version"], "~1.20.0"],
] as const;

test("rejects latest, ranged, and non-exact versions", async (t) => {
  for (const [name, path, value] of invalidExactValues) {
    await t.test(name, async (t) => {
      const root = await mutatedPack(t, [{ file: "target.json", path, value }]);
      await assertInvalid(root, /version|latest|exact/i);
    });
  }
});

test("rejects floating template revisions", async (t) => {
  for (const revision of ["main", "1.21.1", "HEAD"]) {
    await t.test(revision, async (t) => {
      const root = await mutatedPack(t, [
        {
          file: "target.json",
          path: ["template", "revision"],
          value: revision,
        },
      ]);
      await assertInvalid(root, /revision|immutable/i);
    });
  }
});

test("rejects a pack hash that does not match the pack content", async (t) => {
  const root = await mutatedPack(
    t,
    [{ file: "target.json", path: ["packSha256"], value: "0".repeat(64) }],
    false,
  );

  await assertInvalid(root, /packSha256|pack.*hash|content/i);
});

test("requires Gradle distribution URLs to agree with the exact version", async (t) => {
  const root = await mutatedPack(t, [
    {
      file: "target.json",
      path: ["gradle", "distributionUrl"],
      value: "https://services.gradle.org/distributions/gradle-8.9-bin.zip",
    },
  ]);

  await assertInvalid(root, /distributionUrl|distribution.*version|gradle/i);
});

test("accepts an official Gradle all distribution for the declared version", async (t) => {
  const root = await mutatedPack(t, [
    {
      file: "target.json",
      path: ["gradle", "distributionUrl"],
      value: "https://services.gradle.org/distributions/gradle-9.8.2-all.zip",
    },
  ]);

  const packs = await loadTargetPacks(root);
  assert.equal(
    packs[0]?.gradle?.distributionUrl,
    "https://services.gradle.org/distributions/gradle-9.8.2-all.zip",
  );
});

test("requires loader and API coordinates to agree with their declared versions", async (t) => {
  const cases = [
    ["loader", ["loader", "coordinates"], "net.fabricmc:fabric-loader:0.15.0"],
    [
      "API dependency",
      ["loader", "apiDependencies", "0", "coordinates"],
      "net.fabricmc.fabric-api:fabric-api:0.100.0+1.21.1",
    ],
  ] as const;

  for (const [name, path, value] of cases) {
    await t.test(name, async (t) => {
      const root = await mutatedPack(t, [{ file: "target.json", path, value }]);
      await assertInvalid(root, /coordinates|version/i);
    });
  }
});

test("accepts Forge coordinates whose full version is Minecraft-loader", async (t) => {
  const root = await mutatedPack(t, [
    { file: "target.json", path: ["loader", "id"], value: "forge" },
    { file: "target.json", path: ["loader", "version"], value: "52.1.20" },
    {
      file: "target.json",
      path: ["loader", "coordinates"],
      value: "net.minecraftforge:forge:1.21.1-52.1.20",
    },
  ]);

  const packs = await loadTargetPacks(root);
  assert.equal(
    packs[0]?.loader.coordinates,
    "net.minecraftforge:forge:1.21.1-52.1.20",
  );
});

test("requires the release JSON URL to identify the declared Minecraft version", async (t) => {
  const root = await mutatedPack(t, [
    {
      file: "target.json",
      path: ["minecraft", "releaseJsonUrl"],
      value:
        "https://piston-meta.mojang.com/v1/packages/82ba6501da174a665c1787775f946487422f2432/1.21.json",
    },
  ]);

  await assertInvalid(root, /releaseJsonUrl|release.*version|minecraft/i);
});

test("rejects SNAPSHOT versions and documentation revisions", async (t) => {
  const cases = [
    ["target.json", ["loader", "version"], "0.20.1-SNAPSHOT"],
    [
      "target.json",
      ["loader", "apiDependencies", "0", "version"],
      "0.116.17-sNaPsHoT+1.21.1",
    ],
    ["target.json", ["gradle", "plugins", "0", "version"], "1.19-SNAPSHOT"],
    ["docs.json", ["minecraftRelease", "revision"], "1.21.1-SNAPSHOT"],
    ["docs.json", ["loaderApi", "0", "revision"], "0.20.1-SNAPSHOT"],
    ["docs.json", ["gradlePlugins", "0", "version"], "1.19-SNAPSHOT"],
    ["docs.json", ["gradlePlugins", "0", "revision"], "1.19-sNaPsHoT"],
  ] as const;

  for (const [file, path, value] of cases) {
    await t.test(`${file} ${path.join(".")}`, async (t) => {
      const root = await mutatedPack(t, [{ file, path, value }]);
      await assertInvalid(root, /snapshot|version|revision|exact/i);
    });
  }
});

test("requires supported checks to retain assertions and artifact globs", async (t) => {
  for (const check of ["build", "server", "client", "gameTest", "visual"]) {
    for (const field of ["assertions", "artifactGlobs"]) {
      await t.test(`${check}.${field}`, async (t) => {
        const root = await mutatedPack(t, [
          {
            file: "verification.json",
            path: ["checks", check, field],
            value: [],
          },
        ]);
        await assertInvalid(
          root,
          new RegExp(`${field}|assertion|artifact`, "i"),
        );
      });
    }
  }
});

test("rejects missing or malformed wrapper distribution hashes", async (t) => {
  const cases = [
    ["missing", { remove: true }],
    ["short", { value: "abc123" }],
    ["non-hex", { value: "z".repeat(64) }],
  ] as const;
  for (const [name, operation] of cases) {
    await t.test(name, async (t) => {
      const root = await mutatedPack(t, [
        {
          file: "target.json",
          path: ["gradle", "distributionSha256"],
          ...operation,
        },
      ]);
      await assertInvalid(root, /distributionSha256|sha-?256/i);
    });
  }
});

test("requires wrapper JAR hashes for supported packs while keeping them optional for candidates", async (t) => {
  const missingWrapper = {
    file: "target.json",
    path: ["gradle", "wrapperJarSha256"],
    remove: true,
  } as const;
  await assertInvalid(
    await mutatedPack(t, [missingWrapper]),
    /wrapperJarSha256|wrapper.*sha-?256/i,
  );

  const candidate = await mutatedPack(t, [
    { file: "target.json", path: ["status"], value: "candidate" },
    missingWrapper,
  ]);
  const packs = await loadTargetPacks(candidate);
  assert.equal(packs[0]?.status, "candidate");
  assert.equal(packs[0]?.gradle?.wrapperJarSha256, undefined);
});

test("rejects supported packs without immutable pack and qualification evidence", async (t) => {
  const cases: readonly [string, readonly Mutation[], RegExp][] = [
    [
      "pack hash",
      [{ file: "target.json", path: ["packSha256"], remove: true }],
      /packSha256/,
    ],
    [
      "evidence manifest",
      [
        {
          file: "verification.json",
          path: ["evidenceManifest"],
          remove: true,
        },
      ],
      /evidenceManifest|evidence/i,
    ],
    [
      "required visual evidence",
      [
        {
          file: "verification.json",
          path: ["required"],
          value: ["build", "server", "client", "gameTest"],
        },
      ],
      /required|visual/i,
    ],
    [
      "official API documentation",
      [{ file: "docs.json", path: ["loaderApi"], value: [] }],
      /loaderApi|documentation/i,
    ],
    [
      "saved documentation response",
      [
        {
          file: "docs.json",
          path: ["minecraftRelease", "responseSha256"],
          value: "",
        },
      ],
      /responseSha256|evidence/i,
    ],
  ];

  for (const [name, operations, diagnostic] of cases) {
    await t.test(name, async (t) => {
      await assertInvalid(await mutatedPack(t, operations), diagnostic);
    });
  }
});

test("rejects invalid status, reason, template, and verification combinations", async (t) => {
  const cases: readonly [string, readonly Mutation[], RegExp][] = [
    [
      "unsupported without reason",
      [{ file: "target.json", path: ["status"], value: "unsupported" }],
      /reason/i,
    ],
    [
      "rejected without reason detail",
      [
        { file: "target.json", path: ["status"], value: "rejected" },
        {
          file: "target.json",
          path: ["reason"],
          value: {
            code: "verification_failed",
            evidence: unsupportedReason.evidence,
          },
        },
      ],
      /detail/i,
    ],
    [
      "unsupported without primary-source evidence",
      [
        { file: "target.json", path: ["status"], value: "unsupported" },
        {
          file: "target.json",
          path: ["reason"],
          value: { ...unsupportedReason, evidence: [] },
        },
      ],
      /evidence/i,
    ],
    [
      "unsupported with template",
      [
        { file: "target.json", path: ["status"], value: "unsupported" },
        { file: "target.json", path: ["reason"], value: unsupportedReason },
      ],
      /template/i,
    ],
    [
      "rejected with verification commands",
      [
        { file: "target.json", path: ["status"], value: "rejected" },
        { file: "target.json", path: ["reason"], value: unsupportedReason },
        { file: "target.json", path: ["template"], remove: true },
      ],
      /verification|checks|argv|command/i,
    ],
    [
      "supported with a reason",
      [{ file: "target.json", path: ["reason"], value: unsupportedReason }],
      /reason|status/i,
    ],
  ];

  for (const [name, operations, diagnostic] of cases) {
    await t.test(name, async (t) => {
      await assertInvalid(await mutatedPack(t, operations), diagnostic);
    });
  }
});

test("rejects unobfuscated mapping rules and wrong JDK constraints", async (t) => {
  const cases: readonly [string, Mutation, RegExp][] = [
    [
      "none mappings on obfuscated Minecraft",
      {
        file: "target.json",
        path: ["mappings"],
        value: { kind: "none", artifacts: [] },
      },
      /mappings|obfuscat/i,
    ],
    [
      "JDK 25 on Minecraft 1.21.1",
      { file: "target.json", path: ["java", "toolchain"], value: 25 },
      /java|toolchain|21/i,
    ],
    [
      "non-64-bit JVM",
      { file: "target.json", path: ["java", "architecture"], value: "32-bit" },
      /architecture|64-bit/i,
    ],
  ];

  for (const [name, operation, diagnostic] of cases) {
    await t.test(name, async (t) => {
      await assertInvalid(await mutatedPack(t, [operation]), diagnostic);
    });
  }
});

test("accepts every allowlisted Gradle task in a fixed argv array", async (t) => {
  const tasks = [
    "clean",
    "build",
    "test",
    "runServer",
    "runClient",
    "runGameTestServer",
    "runClientGameTest",
    "runGametest",
  ];

  for (const task of tasks) {
    await t.test(task, async (t) => {
      const root = await mutatedPack(t, [
        {
          file: "verification.json",
          path: ["checks", "build", "argv"],
          value: ["./gradlew", "--no-daemon", task],
        },
      ]);
      const packs = await loadTargetPacks(root);
      assert.equal(packs.length, 1);
    });
  }
});

test("allows only fixed argv arrays with allowlisted Gradle tasks", async (t) => {
  const cases: readonly [string, unknown][] = [
    ["unknown task", ["./gradlew", "--no-daemon", "publish"]],
    [
      "shell task",
      ["./gradlew", "--no-daemon", "build && curl https://evil.invalid"],
    ],
    ["shell executable", ["sh", "-c", "./gradlew build"]],
    ["string argv", "./gradlew build"],
    ["extra executable", ["./gradlew", "build", ";", "env"]],
  ];

  for (const [name, argv] of cases) {
    await t.test(name, async (t) => {
      const root = await mutatedPack(t, [
        {
          file: "verification.json",
          path: ["checks", "build", "argv"],
          value: argv,
        },
      ]);
      await assertInvalid(root, /argv|task|executable|allowlist/i);
    });
  }
});
