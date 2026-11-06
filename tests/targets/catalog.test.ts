import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadTargetPacks } from "../../src/core/targets/load-target-packs.ts";

const catalogRoot = fileURLToPath(
  new URL("../../target-packs/", import.meta.url),
);
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
const statuses = [
  "draft",
  "candidate",
  "supported",
  "legacy",
  "rejected",
  "unsupported",
] as const;
const reasonCodes: Record<string, true> = {
  unknown_minecraft_release: true,
  unknown_loader: true,
  no_qualified_pack: true,
  loader_release_unavailable: true,
  api_unavailable: true,
  mappings_unavailable: true,
  toolchain_unavailable: true,
  verification_failed: true,
};
const primarySourceHosts: Record<string, true> = {
  "piston-meta.mojang.com": true,
  "piston-data.mojang.com": true,
  "www.minecraft.net": true,
  "meta.fabricmc.net": true,
  "maven.fabricmc.net": true,
  "docs.fabricmc.net": true,
  "maven.neoforged.net": true,
  "docs.neoforged.net": true,
  "maven.minecraftforge.net": true,
  "files.minecraftforge.net": true,
  "docs.minecraftforge.net": true,
  "maven.quiltmc.org": true,
  "meta.quiltmc.org": true,
  "wiki.quiltmc.org": true,
  "maven.parchmentmc.org": true,
  "parchmentmc.org": true,
  "services.gradle.org": true,
  "docs.gradle.org": true,
  "github.com": true,
};
const sha256 = /^[0-9a-f]{64}$/;

const packs = await loadTargetPacks(catalogRoot);
const packsById = new Map(packs.map((pack) => [pack.id, pack]));
const discovery = JSON.parse(
  await readFile(
    new URL("../../target-packs/discovery.snapshot.json", import.meta.url),
    "utf8",
  ),
) as {
  cells: {
    loaderId: string;
    minecraft: string;
    template: { archive: { sha256: string } } | null;
  }[];
};
const discoveryTemplates = new Map<string, string>(
  discovery.cells.flatMap((cell) =>
    cell.template
      ? ([
          [`${cell.loaderId}/${cell.minecraft}`, cell.template.archive.sha256],
        ] as const)
      : [],
  ),
);
assert.equal(discoveryTemplates.size, 67);

function packById(id: string) {
  const pack = packsById.get(id);
  assert.ok(pack, `missing target pack ${id}`);
  return pack;
}

test("catalog contains exactly one deterministic r1 pack for every release and loader", async () => {
  const expectedIds = releases.flatMap((minecraftVersion) =>
    loaders.map((loader) => `java-${loader}-${minecraftVersion}-r1`),
  );

  assert.equal(packs.length, 68);
  assert.deepEqual(
    packs.map((pack) => pack.id),
    expectedIds.toSorted(),
  );
  assert.equal(new Set(packs.map((pack) => pack.id)).size, 68);

  const coordinates = packs.map(
    (pack) => `${pack.edition}/${pack.loader.id}/${pack.minecraft.version}`,
  );
  assert.equal(new Set(coordinates).size, 68);

  for (const minecraftVersion of releases) {
    for (const loader of loaders) {
      const id = `java-${loader}-${minecraftVersion}-r1`;
      const pack = packById(id);
      assert.equal(pack.id, id);
      assert.equal(pack.edition, "java");
      assert.equal(pack.loader.id, loader);
      assert.equal(pack.minecraft.version, minecraftVersion);
      assert.equal(pack.revision, 1);
    }
  }

  assert.deepEqual(await loadTargetPacks(catalogRoot), packs);
});

test("every pack has an explicit status and unsuccessful outcomes cite primary sources", () => {
  for (const pack of packs) {
    assert.ok(
      statuses.includes(pack.status),
      `${pack.id} has unknown status ${pack.status}`,
    );

    if (pack.status === "supported") {
      assert.match(pack.packSha256, sha256);
      const { evidenceManifest } = pack.verification;
      assert.ok(evidenceManifest);
      assert.ok(evidenceManifest.path.length > 0);
      assert.match(evidenceManifest.sha256, sha256);
    }

    if (pack.status !== "rejected" && pack.status !== "unsupported") {
      continue;
    }

    const { reason } = pack;
    assert.ok(reason);
    assert.ok(reasonCodes[reason.code], `${pack.id} reason code`);
    assert.ok(reason.detail.trim().length > 0, `${pack.id} reason detail`);
    assert.ok(reason.evidence.length > 0, `${pack.id} reason evidence`);
    for (const evidence of reason.evidence) {
      const source = new URL(evidence.url);
      assert.equal(source.protocol, "https:");
      assert.ok(
        primarySourceHosts[source.hostname],
        `${pack.id} cites non-primary source ${source.hostname}`,
      );
      assert.match(evidence.sha256, sha256);
    }
  }
});

test("every template hash identifies its source discovery archive bytes", () => {
  for (const pack of packs) {
    if (!pack.template) continue;
    const key = `${pack.loader.id}/${pack.minecraft.version}`;
    const archiveSha256 = discoveryTemplates.get(key);
    assert.ok(archiveSha256, `${pack.id} has no source discovery template`);
    assert.equal(
      pack.template.contentSha256,
      archiveSha256,
      `${pack.id} template hash must cover the source archive bytes`,
    );
  }
});

test("Fabric 1.21.1 r1 is a candidate with the verified immutable pins", () => {
  const pack = packById("java-fabric-1.21.1-r1");

  assert.equal(pack.status, "candidate");
  assert.deepEqual(pack.minecraft, {
    version: "1.21.1",
    releaseManifestUrl:
      "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    releaseJsonUrl:
      "https://piston-meta.mojang.com/v1/packages/82ba6501da174a665c1787775f946487422f2432/1.21.1.json",
    releaseJsonSha256:
      "3636c26c20f1f0b7472ebef1a624ba1a6a2c4b003858c13224929898b5321437",
    obfuscation: "obfuscated",
    dataPackVersion: 48,
    resourcePackVersion: 34,
  });
  assert.deepEqual(pack.loader, {
    id: "fabric",
    version: "0.20.1",
    coordinates: "net.fabricmc:fabric-loader:0.20.1",
    artifactSha256:
      "d0c5a082e07410aaff9de7ab196aa6b4236002870f9ba3ad5c1260fcce5110ad",
    apiDependencies: [
      {
        id: "fabric-api",
        version: "0.116.17+1.21.1",
        coordinates: "net.fabricmc.fabric-api:fabric-api:0.116.17+1.21.1",
        artifactSha256:
          "79ac44b40780acbd884b34c50be1e39af682847e5f5cb3b1fddeeaa768dce800",
      },
    ],
  });
  assert.deepEqual(pack.mappings, {
    kind: "mojang",
    artifacts: [
      {
        coordinates: "net.minecraft:client:1.21.1:mappings@txt",
        version: "1.21.1",
        artifactSha256:
          "140c47931cccc8fc9e4c22d7603e2d714d1a953a146f51ea7397d95c955536ec",
      },
      {
        coordinates: "net.minecraft:server:1.21.1:mappings@txt",
        version: "1.21.1",
        artifactSha256:
          "9d0b04bead421c8229aff14b534432bbc927bea642e7c8593d1276b8df8ba53f",
      },
    ],
  });
  assert.deepEqual(pack.java, {
    gradleJvm: 21,
    toolchain: 21,
    release: 21,
    architecture: "64-bit",
  });
  assert.deepEqual(pack.gradle, {
    version: "9.8.2",
    distributionUrl:
      "https://services.gradle.org/distributions/gradle-9.8.2-bin.zip",
    distributionSha256:
      "21bd5da2de49b642904077f38c0efdc7778e92b3ed0889392dca61b97e389607",
    plugins: [
      {
        id: "net.fabricmc.fabric-loom-remap",
        version: "1.20.0-alpha.19",
      },
    ],
  });
  assert.deepEqual(pack.template, {
    repository: "https://github.com/FabricMC/fabric-example-mod",
    revision: "4c47210589a9ff72a6075c8dd1d73315dcc3e010",
    contentSha256:
      "cfe3150f5e031a88a3cb33d3799810567b4b4cc6338481aad86c685c6dd76793",
  });
});

test("NeoForge 1.21.1 r1 is a candidate with the verified immutable pins", () => {
  const pack = packById("java-neoforge-1.21.1-r1");

  assert.equal(pack.status, "candidate");
  assert.deepEqual(pack.minecraft, {
    version: "1.21.1",
    releaseManifestUrl:
      "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    releaseJsonUrl:
      "https://piston-meta.mojang.com/v1/packages/82ba6501da174a665c1787775f946487422f2432/1.21.1.json",
    releaseJsonSha256:
      "3636c26c20f1f0b7472ebef1a624ba1a6a2c4b003858c13224929898b5321437",
    obfuscation: "obfuscated",
    dataPackVersion: 48,
    resourcePackVersion: 34,
  });
  assert.deepEqual(pack.loader, {
    id: "neoforge",
    version: "21.1.265",
    coordinates: "net.neoforged:neoforge:21.1.265:universal",
    artifactSha256:
      "c12cf1a6cb0aa7792b13174b06088a4f54d8bcc92f6a32fcb03310b456936847",
    apiDependencies: [],
  });
  assert.deepEqual(pack.mappings, {
    kind: "parchment-layer",
    artifacts: [
      {
        coordinates: "org.parchmentmc.data:parchment-1.21.1:2024.11.17@zip",
        version: "2024.11.17",
        artifactSha256:
          "7c240a37ab432213033b1113d75cb80dc22bffa631d979818b2da1585fa24a08",
      },
    ],
  });
  assert.deepEqual(pack.java, {
    gradleJvm: 21,
    toolchain: 21,
    release: 21,
    architecture: "64-bit",
  });
  assert.deepEqual(pack.gradle, {
    version: "9.2.1",
    distributionUrl:
      "https://services.gradle.org/distributions/gradle-9.2.1-bin.zip",
    distributionSha256:
      "72f44c9f8ebcb1af43838f45ee5c4aa9c5444898b3468ab3f4af7b6076c5bc3f",
    plugins: [{ id: "net.neoforged.moddev", version: "2.0.148" }],
  });
  assert.deepEqual(pack.template, {
    repository: "https://github.com/NeoForgeMDKs/MDK-1.21.1-ModDevGradle",
    revision: "e93d7f09d4eec12c76d1d7be9bf4eaad0246e9e0",
    contentSha256:
      "1101d5f9baf5eb4dd31f826e4eef7f7380a01a776ce1af230133e32a95e46e13",
  });
});
