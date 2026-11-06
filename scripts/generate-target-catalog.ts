import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, sha256 } from "../src/core/targets/canonical-json.ts";

const RELEASE_MANIFEST_URL =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const BLOCKBENCH_VERSION = "5.2.2";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUTPUT_ROOT = join(ROOT, "target-packs");
const DISCOVERY_PATH = join(OUTPUT_ROOT, "discovery.snapshot.json");
const DOCS_CACHE_PATH = join(OUTPUT_ROOT, "docs-cache.json");

type LoaderId = "fabric" | "neoforge" | "forge" | "quilt";

interface Artifact {
  coordinates: string;
  sha256: string;
  url: string;
}

interface DiscoveryCell {
  minecraft: string;
  loaderId: LoaderId;
  candidateEligible: boolean;
  discoveryStatus: string;
  qualificationStatus: string;
  javaMajor: number;
  loader: {
    version: string;
    artifact: Artifact;
    profile?: { url: string; sha256: string };
  } | null;
  apiDependencies: { id: string; version: string; artifact: Artifact }[];
  mappings: {
    kind: string;
    artifacts: Artifact[];
    parchmentLayer?: Artifact;
  };
  gradle: {
    version: string;
    distributionUrl: string;
    distributionSha256: string;
    plugins: { id: string; version: string }[];
  } | null;
  template: {
    repository: string;
    revision: string;
    archive: Artifact;
  } | null;
  reason?: { code: string; detail: string };
  warnings: string[];
}

interface Discovery {
  schemaVersion: string;
  retrievedAt: string;
  runtimeEvidenceExecuted: boolean;
  releases: Record<
    string,
    {
      releaseJsonUrl: string;
      releaseJsonSha256: string;
      obfuscation: "obfuscated" | "unobfuscated";
      dataPackVersion: string | number;
      resourcePackVersion: string | number;
      javaMajor: number;
      releaseArticle: { url: string; sha256: string };
    }
  >;
  catalogs: { url: string; sha256: string }[];
  cells: DiscoveryCell[];
  errors: { loader: LoaderId; minecraft: string; sources: string[] }[];
}

interface DocsCache {
  schemaVersion: "voxellume-target-docs-cache-1.0.0";
  responses: { url: string; sha256: string }[];
}

const LOADER_DOCS: Record<LoaderId, string> = {
  fabric: "https://docs.fabricmc.net/develop/loader/",
  neoforge: "https://docs.neoforged.net/docs/gettingstarted/",
  forge: "https://github.com/MinecraftForge/Documentation",
  quilt: "https://wiki.quiltmc.org/en/introduction/setting-up",
};

const PLUGIN_DOCS: Record<LoaderId, string> = {
  fabric: "https://docs.fabricmc.net/develop/loom/",
  neoforge: "https://docs.neoforged.net/toolchain/docs/plugins/mdg/",
  forge: "https://github.com/MinecraftForge/ForgeGradle",
  quilt: "https://github.com/QuiltMC/quilt-loom",
};

const API_DOCS: Record<string, string> = {
  "fabric-api": "https://docs.fabricmc.net/develop/",
  qsl: "https://github.com/QuiltMC/quilt-standard-libraries",
  "quilted-fabric-api": "https://github.com/QuiltMC/quilted-fabric-api",
};

const BASELINE_TEMPLATES: Record<string, string> = {
  "java-fabric-1.21.1-r1": "4c47210589a9ff72a6075c8dd1d73315dcc3e010",
  "java-neoforge-1.21.1-r1": "e93d7f09d4eec12c76d1d7be9bf4eaad0246e9e0",
};

const BASELINE_LIMITATIONS: Record<string, string> = {
  "java-fabric-1.21.1-r1":
    "Baseline build evidence: Fabric Loom 1.20.0-alpha.19 requires JVM 25 or newer, but this target requires JDK 21; task discovery and clean build failed during configuration.",
  "java-neoforge-1.21.1-r1":
    "Baseline build evidence: NeoForm Runtime decompile failed with Vineflower 1.10.1 exit code 1 on clean build and warm-cache retry; no production JAR was produced.",
};

const METADATA_FILES: Record<LoaderId, string> = {
  fabric: "fabric.mod.json",
  neoforge: "META-INF/neoforge.mods.toml",
  forge: "META-INF/mods.toml",
  quilt: "quilt.mod.json",
};

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function artifactVersion(coordinates: string): string {
  const [artifact = coordinates] = coordinates.split("@");
  const version = artifact.split(":")[2];
  return required(version, `artifact version in ${coordinates}`);
}

function mappingArtifacts(cell: DiscoveryCell) {
  if (cell.mappings.kind === "none") return [];
  if (cell.mappings.parchmentLayer) {
    const artifact = cell.mappings.parchmentLayer;
    return [
      {
        coordinates: `${artifact.coordinates}@zip`,
        version: artifactVersion(artifact.coordinates),
        artifactSha256: artifact.sha256,
      },
    ];
  }
  return cell.mappings.artifacts.map((artifact) => {
    const side = artifact.coordinates.endsWith(":client_mappings")
      ? "client"
      : artifact.coordinates.endsWith(":server_mappings")
        ? "server"
        : null;
    return {
      coordinates: side
        ? `net.minecraft:${side}:${cell.minecraft}:mappings@txt`
        : artifact.coordinates,
      version: side ? cell.minecraft : artifactVersion(artifact.coordinates),
      artifactSha256: artifact.sha256,
    };
  });
}

function targetFor(cell: DiscoveryCell, discovery: Discovery) {
  const id = `java-${cell.loaderId}-${cell.minecraft}-r1`;
  const release = required(discovery.releases[cell.minecraft], cell.minecraft);
  const candidate = cell.candidateEligible;
  const loader = cell.loader;
  const baselineRevision = BASELINE_TEMPLATES[id];
  if (baselineRevision && cell.template?.revision !== baselineRevision) {
    throw new Error(`${id} baseline template revision changed`);
  }

  const target: Record<string, unknown> = {
    schemaVersion: "target-pack-1.0.0",
    id,
    edition: "java",
    status: candidate ? "candidate" : "unsupported",
    revision: 1,
    packSha256: "",
    minecraft: {
      version: cell.minecraft,
      releaseManifestUrl: RELEASE_MANIFEST_URL,
      releaseJsonUrl: release.releaseJsonUrl,
      releaseJsonSha256: release.releaseJsonSha256,
      obfuscation: release.obfuscation,
      dataPackVersion: Number(release.dataPackVersion),
      resourcePackVersion: Number(release.resourcePackVersion),
    },
    loader: {
      id: cell.loaderId,
      version: loader?.version ?? null,
      coordinates: loader?.artifact.coordinates ?? null,
      artifactSha256: loader?.artifact.sha256 ?? null,
      apiDependencies: cell.apiDependencies.map((dependency) => ({
        id: dependency.id,
        version: dependency.version,
        coordinates: dependency.artifact.coordinates,
        artifactSha256: dependency.artifact.sha256,
      })),
    },
    mappings: {
      kind: cell.mappings.parchmentLayer
        ? "parchment-layer"
        : cell.mappings.kind,
      artifacts: mappingArtifacts(cell),
    },
    java: {
      gradleJvm: cell.javaMajor,
      toolchain: cell.javaMajor,
      release: cell.javaMajor,
      architecture: "64-bit",
    },
    gradle: cell.gradle
      ? {
          version: cell.gradle.version,
          distributionUrl: cell.gradle.distributionUrl,
          distributionSha256: cell.gradle.distributionSha256,
          plugins: cell.gradle.plugins.map(({ id, version }) => ({
            id,
            version,
          })),
        }
      : null,
    metadata: { file: METADATA_FILES[cell.loaderId] },
    resources: {
      modelFormat: "java-block-item-json",
      blockbench: {
        projectFormat: "Java Block/Item",
        applicationVersion: BLOCKBENCH_VERSION,
      },
    },
    knownLimitations: candidate
      ? [
          ...cell.warnings,
          ...(BASELINE_LIMITATIONS[id] ? [BASELINE_LIMITATIONS[id]] : []),
          "No successful build, server, client, GameTest, or visual qualification evidence has been collected.",
        ]
      : cell.warnings,
  };

  if (candidate) {
    const template = required(cell.template, `${id} template`);
    target.template = {
      repository: template.repository.startsWith("https://")
        ? template.repository
        : template.archive.url,
      revision: template.revision,
      contentSha256: template.archive.sha256,
    };
  } else {
    const failure = required(
      discovery.errors.find(
        (error) =>
          error.loader === cell.loaderId && error.minecraft === cell.minecraft,
      ),
      `${id} discovery error`,
    );
    const catalogHashes = new Map(
      discovery.catalogs.map((catalog) => [catalog.url, catalog.sha256]),
    );
    target.reason = {
      ...required(cell.reason, `${id} reason`),
      evidence: failure.sources.map((url) => ({
        url,
        sha256: required(catalogHashes.get(url), `catalog hash for ${url}`),
      })),
    };
  }

  const { packSha256: _excluded, ...unsignedTarget } = target;
  target.packSha256 = sha256(canonicalJson(unsignedTarget));
  return target;
}

function verificationFor(cell: DiscoveryCell) {
  if (!cell.candidateEligible) {
    return {
      schemaVersion: "target-verification-1.0.0",
      capabilities: {},
      required: [],
      checks: {},
      testedPlatforms: [],
    };
  }

  const check = (
    tasks: string[],
    assertion: string,
    artifactGlobs: string[],
  ) => ({
    argv: ["./gradlew", "--no-daemon", ...tasks],
    assertions: [assertion],
    artifactGlobs,
  });
  const checks: Record<string, unknown> = {
    build: check(
      ["clean", "build"],
      "Qualification requires exit code 0 and a production JAR.",
      ["build/libs/*.jar", "build/reports/**"],
    ),
    server: check(
      ["runServer"],
      "Qualification requires the dedicated server startup assertion.",
      ["run/logs/*.log"],
    ),
    client: check(
      ["runClient"],
      "Qualification requires the client main-menu and mod-error assertions.",
      ["run/logs/*.log"],
    ),
    visual: check(
      ["runClient"],
      "Qualification requires reviewed inventory, hand, world, GUI, and animation captures.",
      ["verification/screenshots/*.png"],
    ),
  };

  if (cell.loaderId === "fabric") {
    checks.gameTest = check(
      [cell.javaMajor === 25 ? "runClientGameTest" : "runGametest"],
      "Qualification requires all configured GameTests to pass.",
      ["build/reports/gametest/**", "run/logs/*.log"],
    );
  } else if (cell.loaderId === "neoforge" || cell.loaderId === "forge") {
    checks.gameTest = check(
      ["runGameTestServer"],
      "Qualification requires all configured GameTests to pass.",
      ["run/logs/*.log", "build/reports/**"],
    );
  }

  return {
    schemaVersion: "target-verification-1.0.0",
    capabilities: {
      build: false,
      server: false,
      client: false,
      gameTest: false,
      visual: false,
    },
    required: ["build", "server", "client", "gameTest", "visual"],
    checks,
    testedPlatforms: [],
  };
}

function docsFor(
  cell: DiscoveryCell,
  discovery: Discovery,
  docsHashes: ReadonlyMap<string, string>,
) {
  const release = required(discovery.releases[cell.minecraft], cell.minecraft);
  const hash = (url: string) =>
    required(docsHashes.get(url), `documentation response hash for ${url}`);
  const loaderApi = cell.loader
    ? [
        {
          name: `${cell.loaderId === "neoforge" ? "NeoForge" : cell.loaderId === "forge" ? "Forge" : cell.loaderId === "quilt" ? "Quilt Loader" : "Fabric Loader"} ${cell.loader.version}`,
          url: LOADER_DOCS[cell.loaderId],
          revision: cell.loader.version,
          responseSha256: hash(LOADER_DOCS[cell.loaderId]),
        },
        ...cell.apiDependencies.map((dependency) => {
          const url = required(
            API_DOCS[dependency.id],
            `documentation URL for ${dependency.id}`,
          );
          return {
            name: `${dependency.id} ${dependency.version}`,
            url,
            revision: dependency.version,
            responseSha256: hash(url),
          };
        }),
      ]
    : [];
  const catalogs = new Map<string, string>();
  for (const catalog of discovery.catalogs) {
    const relevant =
      (cell.loaderId === "fabric" && catalog.url.includes("fabricmc.net")) ||
      (cell.loaderId === "neoforge" && catalog.url.includes("neoforged.net")) ||
      (cell.loaderId === "forge" &&
        catalog.url.includes("minecraftforge.net")) ||
      (cell.loaderId === "quilt" && catalog.url.includes("quiltmc.org"));
    if (relevant) catalogs.set(catalog.url, catalog.sha256);
  }
  catalogs.set(release.releaseJsonUrl, release.releaseJsonSha256);
  if (cell.loader?.profile) {
    catalogs.set(cell.loader.profile.url, cell.loader.profile.sha256);
  }

  return {
    schemaVersion: "target-docs-1.0.0",
    retrievedAt: discovery.retrievedAt,
    minecraftRelease: {
      url: release.releaseArticle.url,
      revision: cell.minecraft,
      responseSha256: release.releaseArticle.sha256,
    },
    loaderApi,
    gradlePlugins: (cell.gradle?.plugins ?? []).map((plugin) => {
      const url = PLUGIN_DOCS[cell.loaderId];
      return {
        id: plugin.id,
        version: plugin.version,
        url,
        revision: plugin.version,
        responseSha256: hash(url),
      };
    }),
    catalogs: [...catalogs]
      .map(([url, responseSha256]) => ({ url, responseSha256 }))
      .sort((left, right) => left.url.localeCompare(right.url)),
  };
}

async function readDocsCache(): Promise<DocsCache> {
  try {
    return JSON.parse(await readFile(DOCS_CACHE_PATH, "utf8")) as DocsCache;
  } catch {
    return {
      schemaVersion: "voxellume-target-docs-cache-1.0.0",
      responses: [],
    };
  }
}

async function updateDocsCache(discovery: Discovery): Promise<DocsCache> {
  const cache = await readDocsCache();
  const known = new Map(
    cache.responses.map((entry) => [entry.url, entry.sha256]),
  );
  const urls = new Set<string>([
    ...Object.values(LOADER_DOCS),
    ...Object.values(PLUGIN_DOCS),
    ...Object.values(API_DOCS),
  ]);
  for (const cell of discovery.cells) {
    if (cell.loader) urls.add(LOADER_DOCS[cell.loaderId]);
    for (const dependency of cell.apiDependencies) {
      urls.add(required(API_DOCS[dependency.id], `docs for ${dependency.id}`));
    }
    if (cell.gradle) urls.add(PLUGIN_DOCS[cell.loaderId]);
  }

  const missing = [...urls].filter((url) => !known.has(url)).sort();
  const fetched = await Promise.all(
    missing.map(async (url) => {
      const response = await fetch(url, {
        headers: { "user-agent": "Voxellume target documentation evidence" },
      });
      if (!response.ok) {
        throw new Error(
          `Documentation fetch failed: ${response.status} ${url}`,
        );
      }
      return {
        url,
        sha256: sha256(new Uint8Array(await response.arrayBuffer())),
      };
    }),
  );
  for (const entry of fetched) known.set(entry.url, entry.sha256);
  const updated: DocsCache = {
    schemaVersion: "voxellume-target-docs-cache-1.0.0",
    responses: [...known]
      .map(([url, sha256]) => ({ url, sha256 }))
      .sort((left, right) => left.url.localeCompare(right.url)),
  };
  await mkdir(OUTPUT_ROOT, { recursive: true });
  await writeFile(DOCS_CACHE_PATH, prettyJson(updated));
  return updated;
}

async function main() {
  const discovery = JSON.parse(
    await readFile(DISCOVERY_PATH, "utf8"),
  ) as Discovery;
  if (discovery.schemaVersion !== "voxellume-target-discovery-1.0.0") {
    throw new Error("Unsupported discovery schema");
  }
  if (discovery.runtimeEvidenceExecuted || discovery.cells.length !== 68) {
    throw new Error("Discovery must contain 68 cells without runtime evidence");
  }

  const cache = process.argv.includes("--fetch-docs")
    ? await updateDocsCache(discovery)
    : await readDocsCache();
  const docsHashes = new Map(
    cache.responses.map((entry) => [entry.url, entry.sha256]),
  );
  const cells = discovery.cells.toSorted((left, right) =>
    `java-${left.loaderId}-${left.minecraft}-r1`.localeCompare(
      `java-${right.loaderId}-${right.minecraft}-r1`,
    ),
  );
  const javaRoot = join(OUTPUT_ROOT, "java");
  await rm(javaRoot, { recursive: true, force: true });

  for (const cell of cells) {
    const directory = join(javaRoot, cell.loaderId, cell.minecraft);
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeFile(
        join(directory, "target.json"),
        prettyJson(targetFor(cell, discovery)),
      ),
      writeFile(
        join(directory, "docs.json"),
        prettyJson(docsFor(cell, discovery, docsHashes)),
      ),
      writeFile(
        join(directory, "verification.json"),
        prettyJson(verificationFor(cell)),
      ),
    ]);
  }

  const candidates = cells.filter((cell) => cell.candidateEligible).length;
  console.log(
    `Generated ${cells.length} packs: ${candidates} candidate, ${cells.length - candidates} unsupported, 0 supported.`,
  );
}

await main();
