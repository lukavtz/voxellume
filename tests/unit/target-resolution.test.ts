import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTargetCapability,
  resolveTarget,
} from "../../src/core/targets/resolve-target.ts";

const releases = [
  "1.21",
  "1.21.1",
  "1.21.2",
  "1.21.3",
  "1.21.4",
  "1.21.5",
  "1.21.6",
  "1.21.7",
  "1.21.8",
  "1.21.9",
  "1.21.10",
  "1.21.11",
  "26.1",
  "26.1.1",
  "26.1.2",
  "26.2",
  "26.3",
] as const;
const loaders = ["fabric", "neoforge", "forge", "quilt"] as const;
const capabilities = [
  "build",
  "server",
  "client",
  "gameTest",
  "visual",
] as const;
type Capability = (typeof capabilities)[number];

interface TargetReason {
  code: string;
  detail: string;
  evidence: readonly { url: string; sha256: string }[];
}

interface TargetVerification {
  schemaVersion: string;
  capabilities: Record<Capability, boolean>;
  required: Capability[];
  checks: Record<string, unknown>;
  testedPlatforms: { os: string; arch: string }[];
  evidenceManifest: { path: string; sha256: string };
}

const evidenceHash =
  "9b2e18a69c684e429f52ef93dc829b865b4e2986a6a21ea57a2c77a84ab15e21";

function reason(code: string): TargetReason {
  return {
    code,
    detail: `Fixture diagnostic: ${code}`,
    evidence: [
      {
        url: "https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-1",
        sha256: evidenceHash,
      },
    ],
  };
}

function makeVerification(): TargetVerification {
  const check = (task: string) => ({
    argv: ["./gradlew", "--no-daemon", task],
    assertions: ["exitCode == 0"],
    artifactGlobs: ["build/reports/**"],
  });

  return {
    schemaVersion: "target-verification-1.0.0",
    capabilities: {
      build: true,
      server: true,
      client: true,
      gameTest: true,
      visual: true,
    },
    required: [...capabilities],
    checks: {
      build: check("build"),
      server: check("runServer"),
      client: check("runClient"),
      gameTest: check("runGametest"),
      visual: check("runClient"),
    },
    testedPlatforms: [{ os: "macOS", arch: "arm64" }],
    evidenceManifest: {
      path: "evidence/java-fabric-1.21.1-r1/manifest.json",
      sha256: evidenceHash,
    },
  };
}

function makePack(
  options: {
    id?: string;
    status?: string;
    revision?: number;
    minecraftVersion?: string;
    loader?: string;
    packSha256?: string;
    reason?: TargetReason;
    verification?: TargetVerification;
  } = {},
) {
  const minecraftVersion = options.minecraftVersion ?? "1.21.1";
  const loader = options.loader ?? "fabric";
  const unobfuscated = minecraftVersion.startsWith("26.");
  const javaVersion = unobfuscated ? 25 : 21;

  return {
    schemaVersion: "target-pack-1.0.0",
    id: options.id ?? `java-${loader}-${minecraftVersion}-r1`,
    edition: "java" as const,
    status: options.status ?? "supported",
    revision: options.revision ?? 1,
    packSha256: options.packSha256 ?? evidenceHash,
    minecraft: {
      version: minecraftVersion,
      releaseManifestUrl:
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
      releaseJsonUrl: `https://piston-data.mojang.com/v1/objects/${evidenceHash}/release.json`,
      releaseJsonSha256: evidenceHash,
      obfuscation: unobfuscated ? "unobfuscated" : "obfuscated",
      dataPackVersion: unobfuscated ? 101.1 : 48,
      resourcePackVersion: unobfuscated ? 84 : 34,
    },
    loader: {
      id: loader,
      version: "0.20.1",
      coordinates: `net.fabricmc:fabric-loader:0.20.1`,
      artifactSha256: evidenceHash,
      apiDependencies: [],
    },
    mappings: unobfuscated
      ? { kind: "none", artifacts: [] }
      : {
          kind: "mojang",
          artifacts: [
            {
              coordinates: `net.minecraft:client:${minecraftVersion}:mappings@txt`,
              version: minecraftVersion,
              artifactSha256: evidenceHash,
            },
          ],
        },
    java: {
      gradleJvm: javaVersion,
      toolchain: javaVersion,
      release: javaVersion,
      architecture: "64-bit",
    },
    gradle: {
      version: "9.8.2",
      distributionUrl:
        "https://services.gradle.org/distributions/gradle-9.8.2-bin.zip",
      distributionSha256: evidenceHash,
      plugins: [
        {
          id: unobfuscated
            ? "net.fabricmc.fabric-loom"
            : "net.fabricmc.fabric-loom-remap",
          version: "1.20.0-alpha.19",
        },
      ],
    },
    template: {
      repository: "https://github.com/FabricMC/fabric-example-mod",
      revision: "4c47210589a9ff72a6075c8dd1d73315dcc3e010",
      contentSha256: evidenceHash,
    },
    metadata: { file: "fabric.mod.json" },
    resources: {
      modelFormat: "java-block-item-json",
      blockbench: {
        projectFormat: "Java Block/Item",
        applicationVersion: "5.0.0",
      },
    },
    knownLimitations: [],
    verification: options.verification ?? makeVerification(),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  };
}

function request(minecraftVersion = "1.21.1", loader = "fabric") {
  return { edition: "java" as const, minecraftVersion, loader };
}

test("resolves the fully qualified supported Fabric 1.21.1 target exactly", () => {
  const target = makePack({ id: "java-fabric-1.21.1-r1" });
  const requested = request();

  const result = resolveTarget(requested, [target]);

  assert.deepEqual(result, { status: "resolved", target });
  assert.equal(target.loader.version, "0.20.1");
  assert.equal(target.java.toolchain, 21);
  assert.equal(target.minecraft.obfuscation, "obfuscated");
  assert.equal(
    target.template.revision,
    "4c47210589a9ff72a6075c8dd1d73315dcc3e010",
  );
});

test("returns the complete unsupported diagnostic without mutating inputs", () => {
  const requested = request("1.20.4");
  const packs = [makePack()];
  const requestedBefore = structuredClone(requested);
  const packsBefore = structuredClone(packs);

  const first = resolveTarget(requested, packs);
  const second = resolveTarget(requested, packs);

  assert.equal(first.status, "unsupported");
  if (first.status === "unsupported") {
    assert.equal(first.code, "unsupported_target");
    assert.deepEqual(first.requested, requested);
    assert.equal(first.reason.code, "no_qualified_pack");
  }
  assert.deepEqual(second, first);
  assert.deepEqual(requested, requestedBefore);
  assert.deepEqual(packs, packsBefore);
});

test("returns supported duplicate coordinates as ambiguous candidates in lexical ID order", () => {
  const zulu = makePack({ id: "java-fabric-1.21.1-r10" });
  const alpha = makePack({ id: "java-fabric-1.21.1-r2" });

  const result = resolveTarget(request(), [zulu, alpha]);

  assert.equal(result.status, "ambiguous");
  if (result.status === "ambiguous") {
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.id),
      ["java-fabric-1.21.1-r10", "java-fabric-1.21.1-r2"],
    );
  }
});

test("returns unsupported for an empty catalog", () => {
  const requested = request();
  const result = resolveTarget(requested, []);

  assert.equal(result.status, "unsupported");
  if (result.status === "unsupported") {
    assert.equal(result.code, "unsupported_target");
    assert.deepEqual(result.requested, requested);
    assert.equal(result.reason.code, "no_qualified_pack");
  }
});

test("resolves every official release and loader coordinate without substitution", () => {
  const packs = releases.flatMap((minecraftVersion) =>
    loaders.map((loader) => makePack({ minecraftVersion, loader })),
  );
  assert.equal(packs.length, 68);

  for (const minecraftVersion of releases) {
    for (const loader of loaders) {
      const result = resolveTarget(request(minecraftVersion, loader), packs);
      assert.equal(
        result.status,
        "resolved",
        `${loader} ${minecraftVersion} must resolve exactly`,
      );
      if (result.status === "resolved") {
        assert.equal(result.target.id, `java-${loader}-${minecraftVersion}-r1`);
        assert.equal(result.target.minecraft.version, minecraftVersion);
        assert.equal(result.target.loader.id, loader);
      }
    }
  }
});

test("does not fall back by nearest version, loader, mapping, whitespace, or case", () => {
  const packs = [
    makePack(),
    makePack({ minecraftVersion: "1.21.2" }),
    makePack({ loader: "neoforge" }),
    makePack({ minecraftVersion: "26.1" }),
  ];
  const malformedRequests = [
    request("1.21.2", "Fabric"),
    request("1.21.1", "FABRIC"),
    request("1.21.1", "fabric "),
    request("1.21.1", " fabric"),
    request(" 1.21.1"),
    request("1.21.1 "),
    request("1.21.01"),
    request("1.21.1\n"),
    request("26.1", "Fabric"),
  ];

  for (const malformed of malformedRequests) {
    const result = resolveTarget(malformed, packs);
    assert.equal(result.status, "unsupported", JSON.stringify(malformed));
    if (result.status === "unsupported") {
      assert.equal(result.code, "unsupported_target");
      assert.deepEqual(result.requested, malformed);
    }
  }
});

test("selects an explicit supported targetPackId only when coordinates also match", () => {
  const first = makePack({ id: "java-fabric-1.21.1-r1", revision: 1 });
  const second = makePack({ id: "java-fabric-1.21.1-r2", revision: 2 });
  const requested = { ...request(), targetPackId: second.id };

  const result = resolveTarget(requested, [first, second]);

  assert.deepEqual(result, { status: "resolved", target: second });
});

test("returns target_not_found deterministically for an unknown explicit ID", () => {
  const requested = { ...request(), targetPackId: "java-fabric-1.21.1-r99" };

  const first = resolveTarget(requested, [makePack()]);
  const second = resolveTarget(requested, [makePack()]);

  assert.equal(first.status, "unsupported");
  if (first.status === "unsupported") {
    assert.equal(first.code, "target_not_found");
    assert.deepEqual(first.requested, requested);
  }
  assert.deepEqual(second, first);
});

test("returns target_mismatch when an explicit ID belongs to other coordinates", () => {
  const pack = makePack({ id: "java-fabric-1.21.1-r1" });
  const requested = {
    ...request("1.21.2", "neoforge"),
    targetPackId: pack.id,
  };

  const first = resolveTarget(requested, [pack]);
  const second = resolveTarget(requested, [pack]);

  assert.equal(first.status, "unsupported");
  if (first.status === "unsupported") {
    assert.equal(first.code, "target_mismatch");
    assert.deepEqual(first.requested, requested);
  }
  assert.deepEqual(second, first);
});

test("rejects every non-supported status with its structured reason", () => {
  const cases = [
    ["draft", "no_qualified_pack"],
    ["candidate", "toolchain_unavailable"],
    ["legacy", "no_qualified_pack"],
    ["rejected", "verification_failed"],
    ["unsupported", "loader_release_unavailable"],
  ] as const;

  for (const [status, code] of cases) {
    const result = resolveTarget(request(), [
      makePack({ status, reason: reason(code) }),
    ]);
    assert.equal(result.status, "unsupported", status);
    if (result.status === "unsupported") {
      assert.equal(result.code, "unsupported_target");
      assert.equal(result.reason.code, code);
    }
  }
});

test("non-supported revisions neither resolve nor create ambiguity", () => {
  const supported = makePack({ id: "java-fabric-1.21.1-r2" });
  const packs = [
    makePack({ id: "java-fabric-1.21.1-r1", status: "legacy" }),
    supported,
    makePack({ id: "java-fabric-1.21.1-r3", status: "rejected" }),
  ];

  assert.deepEqual(resolveTarget(request(), packs), {
    status: "resolved",
    target: supported,
  });
});

test("keeps JDK 21 obfuscated and JDK 25 unobfuscated targets distinct", () => {
  const obfuscated = makePack({ minecraftVersion: "1.21.11" });
  const unobfuscated = makePack({ minecraftVersion: "26.1" });

  const legacyResult = resolveTarget(request("1.21.11"), [
    unobfuscated,
    obfuscated,
  ]);
  const currentResult = resolveTarget(request("26.1"), [
    obfuscated,
    unobfuscated,
  ]);

  assert.deepEqual(legacyResult, { status: "resolved", target: obfuscated });
  assert.deepEqual(currentResult, { status: "resolved", target: unobfuscated });
  assert.equal(obfuscated.java.gradleJvm, 21);
  assert.equal(obfuscated.mappings.kind, "mojang");
  assert.equal(unobfuscated.java.gradleJvm, 25);
  assert.equal(unobfuscated.mappings.kind, "none");
});

for (const capability of capabilities) {
  test(`rejects an unavailable ${capability} capability deterministically`, () => {
    const verification = makeVerification();
    verification.capabilities[capability] = false;
    const pack = makePack({ verification });

    const first = assertTargetCapability(pack, capability);
    const second = assertTargetCapability(pack, capability);

    assert.equal(first.status, "unsupported");
    if (first.status === "unsupported") {
      assert.equal(first.code, "capability_unavailable");
      assert.equal(first.capability, capability);
    }
    assert.deepEqual(second, first);
  });
}

test("accepts a capability backed by immutable qualification evidence", () => {
  const pack = makePack();

  const result = assertTargetCapability(pack, "build");

  assert.equal(result.status, "supported");
  if (result.status === "supported") {
    assert.equal(result.target, pack);
    assert.equal(result.capability, "build");
  }
});

test("rejects capabilities when immutable pack or qualification evidence is missing", () => {
  const noPackHash = makePack({ packSha256: "" });
  const verification = makeVerification();
  verification.evidenceManifest.sha256 = "";
  const noEvidence = makePack({ verification });

  for (const pack of [noPackHash, noEvidence]) {
    const result = assertTargetCapability(pack, "visual");
    assert.equal(result.status, "unsupported");
    if (result.status === "unsupported") {
      assert.equal(result.code, "missing_qualification_evidence");
      assert.equal(result.capability, "visual");
    }
  }
});
