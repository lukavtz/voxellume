import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import { inspectProject } from "../../src/core/projects/inspect-project.ts";

interface TestPack {
  id: string;
  edition: "java";
  status: string;
  revision: number;
  minecraft: { version: string };
  loader: { id: string };
}

const fabricPack: TestPack = {
  id: "java-fabric-1.21.1-r1",
  edition: "java",
  status: "supported",
  revision: 1,
  minecraft: { version: "1.21.1" },
  loader: { id: "fabric" },
};

const validFiles: Record<string, string> = {
  "settings.gradle": "rootProject.name = 'ruby-tools'\n",
  "gradle.properties": "minecraft_version=1.21.1\nloader_version=0.20.1\n",
  "build.gradle": `plugins {
  id 'net.fabricmc.fabric-loom-remap' version '1.20.0-alpha.19'
}
splitEnvironmentSourceSets()
dependencies {
  modImplementation "net.fabricmc:fabric-api:0.116.17+1.21.1"
}
tasks.register('runGametest')
`,
  "src/main/java/dev/voxellume/ruby_tools/RubyTools.java":
    "package dev.voxellume.ruby_tools; public final class RubyTools {}\n",
  "src/main/resources/fabric.mod.json": `${JSON.stringify(
    {
      schemaVersion: 1,
      id: "ruby_tools",
      version: "1.0.0",
      name: "Ruby Tools",
      depends: { minecraft: "1.21.1" },
    },
    null,
    2,
  )}\n`,
  "src/client/java/dev/voxellume/ruby_tools/client/RubyToolsClient.java":
    "package dev.voxellume.ruby_tools.client; public final class RubyToolsClient {}\n",
  "src/client/resources/ruby-tools.client.mixins.json": "{}\n",
  "notes/user-decisions.txt": "Keep this user-owned file unchanged.\n",
};

async function snapshotTree(
  root: string,
  relative = "",
): Promise<Record<string, string>> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const snapshot: Record<string, string> = {};
  for (const entry of entries) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) {
      Object.assign(snapshot, await snapshotTree(root, path));
    } else {
      assert.ok(entry.isFile());
      snapshot[path] = createHash("sha256")
        .update(await readFile(join(root, path)))
        .digest("hex");
    }
  }
  return Object.fromEntries(
    Object.entries(snapshot).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

async function fixture(
  t: TestContext,
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-inspection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents, { flag: "wx" });
  }
  return root;
}

async function inspectUnchanged(
  projectRoot: string,
  targetPacks: readonly TestPack[],
) {
  const before = await snapshotTree(projectRoot);
  const result = await inspectProject({ projectRoot, targetPacks });
  assert.deepEqual(await snapshotTree(projectRoot), before);
  return result;
}

test("inspects a valid split-source Fabric project through the public seam", async (t) => {
  const projectRoot = await fixture(t, validFiles);

  const result = await inspectUnchanged(projectRoot, [fabricPack]);

  assert.deepEqual(result, {
    status: "inspected",
    target: {
      coordinates: {
        edition: "java",
        minecraftVersion: "1.21.1",
        loader: "fabric",
      },
      pack: fabricPack,
    },
    sourceSets: [
      {
        name: "client",
        java: ["src/client/java"],
        resources: ["src/client/resources"],
      },
      {
        name: "main",
        java: ["src/main/java"],
        resources: ["src/main/resources"],
      },
    ],
    modMetadata: {
      file: "src/main/resources/fabric.mod.json",
      modId: "ruby_tools",
      version: "1.0.0",
    },
    dependencies: [
      {
        configuration: "modImplementation",
        coordinates: "net.fabricmc:fabric-api:0.116.17+1.21.1",
      },
    ],
    availableTasks: ["build", "runClient", "runGametest", "runServer", "test"],
    userOwnedFiles: Object.keys(validFiles).sort(),
    diagnostics: [],
  });
});

test("infers exact coordinates from every non-supported pack without nearest-target fallback", async (t) => {
  const projectRoot = await fixture(t, validFiles);
  const nearbySupported = {
    ...fabricPack,
    id: "java-fabric-1.21.2-r1",
    minecraft: { version: "1.21.2" },
  };

  for (const status of [
    "draft",
    "candidate",
    "legacy",
    "rejected",
    "unsupported",
  ]) {
    const exactPack = { ...fabricPack, status };
    const result = await inspectUnchanged(projectRoot, [
      nearbySupported,
      exactPack,
    ]);

    assert.equal(result.status, "inspected");
    assert.deepEqual(result.target, {
      coordinates: {
        edition: "java",
        minecraftVersion: "1.21.1",
        loader: "fabric",
      },
      pack: exactPack,
    });
    assert.deepEqual(result.diagnostics, []);
  }
});

test("reports missing mod metadata and retains the remaining partial inspection", async (t) => {
  const files = Object.fromEntries(
    Object.entries(validFiles).filter(
      ([path]) => path !== "src/main/resources/fabric.mod.json",
    ),
  );
  const projectRoot = await fixture(t, files);

  const result = await inspectUnchanged(projectRoot, [fabricPack]);

  assert.equal(result.status, "inspected");
  assert.equal(result.target?.pack, fabricPack);
  assert.equal(result.modMetadata, null);
  assert.deepEqual(result.diagnostics, [
    {
      code: "mod_metadata_missing",
      detail: "Mod metadata file was not found for the inferred loader.",
      path: "src/main/resources/fabric.mod.json",
    },
  ]);
  assert.deepEqual(result.userOwnedFiles, Object.keys(files).sort());
});

test("reports malformed mod metadata with a stable path diagnostic", async (t) => {
  const projectRoot = await fixture(t, {
    ...validFiles,
    "src/main/resources/fabric.mod.json": '{ "id": "ruby_tools", ',
  });

  const result = await inspectUnchanged(projectRoot, [fabricPack]);

  assert.equal(result.status, "inspected");
  assert.equal(result.modMetadata, null);
  assert.deepEqual(result.diagnostics, [
    {
      code: "mod_metadata_malformed",
      detail: "Mod metadata file is not valid JSON.",
      path: "src/main/resources/fabric.mod.json",
    },
  ]);
});

test("reports build and metadata target-coordinate mismatches exactly", async (t) => {
  const projectRoot = await fixture(t, {
    ...validFiles,
    "src/main/resources/fabric.mod.json": `${JSON.stringify({
      schemaVersion: 1,
      id: "ruby_tools",
      version: "1.0.0",
      depends: { minecraft: "1.21.2" },
    })}\n`,
  });

  const result = await inspectUnchanged(projectRoot, [fabricPack]);

  assert.equal(result.status, "inspected");
  assert.deepEqual(result.diagnostics, [
    {
      code: "target_mismatch",
      detail:
        'Mod metadata requires Minecraft "1.21.2" but the build declares "1.21.1".',
      path: "src/main/resources/fabric.mod.json",
    },
  ]);
});

test("a foreign project without a Gradle build file returns only a missing-build diagnostic", async (t) => {
  const projectRoot = await fixture(t, {
    "pom.xml": "<project><artifactId>not-a-mod</artifactId></project>\n",
    "README.md": "Foreign project bytes.\n",
  });

  const result = await inspectUnchanged(projectRoot, [fabricPack]);

  assert.deepEqual(result, {
    status: "inspected",
    target: null,
    sourceSets: [],
    modMetadata: null,
    dependencies: [],
    availableTasks: [],
    userOwnedFiles: ["README.md", "pom.xml"],
    diagnostics: [
      {
        code: "build_file_missing",
        detail: "No build.gradle or build.gradle.kts file exists.",
        path: "build.gradle",
      },
    ],
  });
});

test("a malformed Gradle build file returns no inferred target or partial declarations", async (t) => {
  const projectRoot = await fixture(t, {
    ...validFiles,
    "build.gradle": "plugins { id 'net.fabricmc.fabric-loom-remap'\n",
  });

  const result = await inspectUnchanged(projectRoot, [fabricPack]);

  assert.deepEqual(result, {
    status: "inspected",
    target: null,
    sourceSets: [],
    modMetadata: null,
    dependencies: [],
    availableTasks: [],
    userOwnedFiles: Object.keys(validFiles).sort(),
    diagnostics: [
      {
        code: "build_file_malformed",
        detail: "Could not parse Gradle build file.",
        path: "build.gradle",
      },
    ],
  });
});
