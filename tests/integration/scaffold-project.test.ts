import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import { scaffoldProject } from "../../src/core/projects/scaffold-project.ts";
import type { TargetPack } from "../../src/core/targets/target-pack.ts";

const mod = {
  modId: "ruby_tools",
  namespace: "ruby_tools",
  javaPackage: "dev.voxellume.ruby_tools",
  name: "Ruby Tools",
  version: "1.2.3",
  description: "Ruby tools for deterministic scaffold tests.",
  authors: ["Voxellume Tests"],
  license: "MIT",
};

const fabricTemplate: Record<string, string> = {
  "build.gradle": `plugins {
    id 'net.fabricmc.fabric-loom-remap' version '1.20.0-alpha.19'
}

loom {
    splitEnvironmentSourceSets()
    mods {
        "example_mod" {
            sourceSet sourceSets.main
            sourceSet sourceSets.client
        }
    }
}

sourceSets {
    datagen {
        java.srcDir 'src/datagen/java'
        resources.srcDir 'src/datagen/resources'
    }
}

jar {
    exclude '**/*.bbmodel', 'development/**'
}
`,
  "settings.gradle": "rootProject.name = 'example_mod'\n",
  "gradle.properties":
    "mod_id=example_mod\nmod_version=0.0.1\ngroup=com.example\n",
  "src/main/java/com/example/ExampleMod.java": `package com.example;

public final class ExampleMod {
    public static final String MOD_ID = "example_mod";
}
`,
  "src/datagen/java/com/example/ExampleModDataGenerator.java": `package com.example;

public final class ExampleModDataGenerator {
    public static final String OUTPUT = "src/datagen/resources";
}
`,
  "src/main/resources/fabric.mod.json": `{
  "schemaVersion": 1,
  "id": "example_mod",
  "version": "0.0.1",
  "name": "Example Mod",
  "description": "Example description",
  "authors": ["Example Author"],
  "license": "CC0-1.0",
  "entrypoints": {
    "main": ["com.example.ExampleMod"]
  }
}
`,
  "src/development/resources/example_mod.client-test.json":
    '{"developmentOnly":true}\n',
  "asset-sources/example.bbmodel":
    '{"meta":{"format_version":"5.0","model_format":"java_block"}}\n',
};

const fabricGolden: Record<string, string> = {
  "build.gradle": `plugins {
    id 'net.fabricmc.fabric-loom-remap' version '1.20.0-alpha.19'
}

loom {
    splitEnvironmentSourceSets()
    mods {
        "ruby_tools" {
            sourceSet sourceSets.main
            sourceSet sourceSets.client
        }
    }
}

sourceSets {
    datagen {
        java.srcDir 'src/datagen/java'
        resources.srcDir 'src/datagen/resources'
    }
}

jar {
    exclude '**/*.bbmodel', 'development/**'
}
`,
  "settings.gradle": "rootProject.name = 'ruby_tools'\n",
  "gradle.properties":
    "mod_id=ruby_tools\nmod_version=1.2.3\ngroup=dev.voxellume.ruby_tools\n",
  "src/main/java/dev/voxellume/ruby_tools/RubyTools.java": `package dev.voxellume.ruby_tools;

public final class RubyTools {
    public static final String MOD_ID = "ruby_tools";
}
`,
  "src/datagen/java/dev/voxellume/ruby_tools/RubyToolsDataGenerator.java": `package dev.voxellume.ruby_tools;

public final class RubyToolsDataGenerator {
    public static final String OUTPUT = "src/datagen/resources";
}
`,
  "src/main/resources/fabric.mod.json": `{
  "schemaVersion": 1,
  "id": "ruby_tools",
  "version": "1.2.3",
  "name": "Ruby Tools",
  "description": "Ruby tools for deterministic scaffold tests.",
  "authors": ["Voxellume Tests"],
  "license": "MIT",
  "entrypoints": {
    "main": ["dev.voxellume.ruby_tools.RubyTools"]
  }
}
`,
  "src/development/resources/ruby_tools.client-test.json":
    '{"developmentOnly":true}\n',
  "asset-sources/example.bbmodel":
    '{"meta":{"format_version":"5.0","model_format":"java_block"}}\n',
};

const manifestPath = ".voxellume/scaffold.json";
const modSpecPath = "voxellume.mod.json";

async function writeTree(
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(directory: string, prefix = ""): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path, name);
      else {
        assert.ok(entry.isFile(), `unexpected fixture entry: ${path}`);
        files[name] = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
      }
    }
  }
  await visit(root);
  return Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function snapshotModes(root: string): Promise<Record<string, number>> {
  const modes: Record<string, number> = {};
  for (const name of Object.keys(await snapshot(root))) {
    modes[name] = (await stat(join(root, name))).mode & 0o777;
  }
  return Object.fromEntries(
    Object.entries(modes).sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function supportedTarget(): Promise<TargetPack> {
  // Synthetic supported status exercises scaffolding only; it is not build qualification.
  const target = JSON.parse(
    await readFile(
      new URL(
        "../../target-packs/java/fabric/1.21.1/target.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as TargetPack;
  return { ...target, status: "supported" };
}

async function fixture(
  t: TestContext,
  template: Readonly<Record<string, string>> = fabricTemplate,
): Promise<{
  destination: string;
  targetPackRoot: string;
  target: TargetPack;
}> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-scaffold-integration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = join(root, "project");
  const targetPackRoot = join(root, "pack");
  await mkdir(destination, { recursive: true });
  await writeTree(join(targetPackRoot, "templates"), template);
  return { destination, targetPackRoot, target: await supportedTarget() };
}

async function readGoldenTree(
  destination: string,
  expected: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [name, contents] of Object.entries(expected)) {
    assert.equal(
      await readFile(join(destination, name), "utf8"),
      contents,
      `unexpected golden contents: ${name}`,
    );
  }
  const actualPaths = Object.keys(await snapshot(destination));
  assert.deepEqual(
    actualPaths,
    [...Object.keys(expected), manifestPath, modSpecPath].sort((left, right) =>
      left.localeCompare(right),
    ),
  );
}

test("materializes the supported fixture as exact deterministic golden files", async (t) => {
  const { destination, targetPackRoot, target } = await fixture(t);
  const result = await scaffoldProject({
    destination,
    target,
    targetPackRoot,
    mod,
  });

  assert.equal(result.status, "scaffolded");
  assert.ok("createdPaths" in result);
  assert.deepEqual(
    result.createdPaths,
    [...Object.keys(fabricGolden), manifestPath, modSpecPath].sort(
      (left, right) => left.localeCompare(right),
    ),
  );
  await readGoldenTree(destination, fabricGolden);

  const metadata = JSON.parse(
    await readFile(
      join(destination, "src/main/resources/fabric.mod.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  assert.equal(metadata.id, mod.modId);
  assert.equal(metadata.version, mod.version);
  assert.equal(metadata.name, mod.name);
  assert.deepEqual(metadata.authors, mod.authors);
  assert.equal(metadata.license, mod.license);

  assert.ok("modSpec" in result);
  assert.deepEqual(
    {
      schemaVersion: result.modSpec.schemaVersion,
      modId: result.modSpec.modId,
      namespace: result.modSpec.namespace,
      javaPackage: result.modSpec.javaPackage,
      metadata: result.modSpec.metadata,
      targetPackId: result.modSpec.targetPackId,
      targetPackRevision: result.modSpec.targetPackRevision,
    },
    {
      schemaVersion: "mod-spec-1.0.0",
      modId: mod.modId,
      namespace: mod.namespace,
      javaPackage: mod.javaPackage,
      metadata: {
        name: mod.name,
        version: mod.version,
        description: mod.description,
        authors: mod.authors,
        license: mod.license,
      },
      targetPackId: target.id,
      targetPackRevision: target.revision,
    },
  );

  const buildGradle = await readFile(join(destination, "build.gradle"), "utf8");
  assert.match(buildGradle, /splitEnvironmentSourceSets\(\)/);
  assert.match(buildGradle, /java\.srcDir 'src\/datagen\/java'/);
  assert.match(buildGradle, /resources\.srcDir 'src\/datagen\/resources'/);
  assert.match(buildGradle, /exclude '\*\*\/\*\.bbmodel', 'development\/\*\*'/);
  assert.equal(
    await readFile(
      join(
        destination,
        "src/development/resources/ruby_tools.client-test.json",
      ),
      "utf8",
    ),
    '{"developmentOnly":true}\n',
  );
  assert.equal(
    await readFile(join(destination, "asset-sources/example.bbmodel"), "utf8"),
    fabricGolden["asset-sources/example.bbmodel"],
  );
  assert.ok(!buildGradle.toLowerCase().includes("architectury"));
  assert.ok(!(await snapshot(destination))["common/build.gradle"]);
});

test("regenerates deterministically, prunes stale owned files, and preserves user files", async (t) => {
  const { destination, targetPackRoot, target } = await fixture(t);
  const options = { destination, target, targetPackRoot, mod };
  const first = await scaffoldProject(options);
  assert.equal(first.status, "scaffolded");

  await writeFile(join(destination, "notes.md"), "user-owned notes\n");
  await writeFile(
    join(destination, "src/main/java/dev/voxellume/ruby_tools/RubyTools.java"),
    "stale generated bytes\n",
  );
  const staleDatagen =
    "src/datagen/java/dev/voxellume/ruby_tools/RubyToolsDataGenerator.java";
  await unlink(
    join(
      targetPackRoot,
      "templates/src/datagen/java/com/example/ExampleModDataGenerator.java",
    ),
  );

  const second = await scaffoldProject(options);
  assert.equal(second.status, "scaffolded");
  assert.equal(
    await readFile(join(destination, "notes.md"), "utf8"),
    "user-owned notes\n",
  );
  assert.equal(
    await readFile(
      join(
        destination,
        "src/main/java/dev/voxellume/ruby_tools/RubyTools.java",
      ),
      "utf8",
    ),
    fabricGolden["src/main/java/dev/voxellume/ruby_tools/RubyTools.java"],
  );
  assert.ok(!(await snapshot(destination))[staleDatagen]);

  const secondTree = await snapshot(destination);
  assert.ok("modSpec" in second);
  const secondSpec = second.modSpec;
  const third = await scaffoldProject(options);
  assert.equal(third.status, "scaffolded");
  assert.ok("modSpec" in third);
  assert.deepEqual(third.modSpec, secondSpec);
  assert.deepEqual(await snapshot(destination), secondTree);
  assert.equal(
    await readFile(join(destination, "notes.md"), "utf8"),
    "user-owned notes\n",
  );
});

async function rollbackFixture(t: TestContext) {
  const { destination, targetPackRoot, target } = await fixture(t);
  const options = { destination, target, targetPackRoot, mod };
  const first = await scaffoldProject(options);
  assert.equal(first.status, "scaffolded");

  await writeFile(join(destination, "notes.md"), "user-owned notes\n");
  await writeFile(join(destination, "build.gradle"), "edited owned bytes\n");
  await chmod(join(destination, "build.gradle"), 0o640);
  await unlink(
    join(
      targetPackRoot,
      "templates/src/datagen/java/com/example/ExampleModDataGenerator.java",
    ),
  );
  await writeTree(join(targetPackRoot, "templates"), {
    "new/generated.txt": "new generated output\n",
  });
  return {
    options,
    beforeFiles: await snapshot(destination),
    beforeModes: await snapshotModes(destination),
  };
}

interface RollbackFixtureState {
  readonly options: {
    readonly destination: string;
    readonly targetPackRoot: string;
    readonly target: TargetPack;
    readonly mod: typeof mod;
  };
  readonly beforeFiles: Record<string, string>;
  readonly beforeModes: Record<string, number>;
}

async function assertRestored(
  fixtureState: RollbackFixtureState,
): Promise<void> {
  assert.deepEqual(
    await snapshot(fixtureState.options.destination),
    fixtureState.beforeFiles,
  );
  assert.deepEqual(
    await snapshotModes(fixtureState.options.destination),
    fixtureState.beforeModes,
  );
}

test("aborts before stale deletion and restores the complete prior tree", async (t) => {
  const state = await rollbackFixture(t);
  const controller = new AbortController();
  await assert.rejects(
    scaffoldProject({
      ...state.options,
      signal: controller.signal,
      hooks: {
        beforeMutation(mutation) {
          if (mutation.kind === "delete") controller.abort();
        },
      },
    }),
    { name: "AbortError" },
  );
  await assertRestored(state);
});

test("aborts during writes and removes all newly generated output", async (t) => {
  const state = await rollbackFixture(t);
  const controller = new AbortController();
  await assert.rejects(
    scaffoldProject({
      ...state.options,
      signal: controller.signal,
      hooks: {
        beforeMutation(mutation) {
          if (
            mutation.kind === "write" &&
            mutation.path === "src/main/resources/fabric.mod.json"
          ) {
            controller.abort();
          }
        },
      },
    }),
    { name: "AbortError" },
  );
  await assertRestored(state);
});

test("aborts during chmod and restores owned bytes and modes", async (t) => {
  const state = await rollbackFixture(t);
  const controller = new AbortController();
  await assert.rejects(
    scaffoldProject({
      ...state.options,
      signal: controller.signal,
      hooks: {
        beforeMutation(mutation) {
          if (mutation.kind === "chmod" && mutation.path === "build.gradle") {
            controller.abort();
          }
        },
      },
    }),
    { name: "AbortError" },
  );
  await assertRestored(state);
});

test("an injected write failure restores stale, existing, and new paths", async (t) => {
  const state = await rollbackFixture(t);
  await assert.rejects(
    scaffoldProject({
      ...state.options,
      hooks: {
        beforeMutation(mutation) {
          if (
            mutation.kind === "write" &&
            mutation.path === "src/main/resources/fabric.mod.json"
          ) {
            throw new Error("injected write failure");
          }
        },
      },
    }),
    /injected write failure/,
  );
  await assertRestored(state);
});

test("rollback failure is surfaced instead of reporting cancellation", async (t) => {
  const state = await rollbackFixture(t);
  const controller = new AbortController();
  await assert.rejects(
    scaffoldProject({
      ...state.options,
      signal: controller.signal,
      hooks: {
        beforeMutation(mutation) {
          if (
            mutation.phase === "apply" &&
            mutation.kind === "chmod" &&
            mutation.path === "build.gradle"
          ) {
            controller.abort();
          }
          if (mutation.phase === "rollback" && mutation.kind === "write") {
            throw new Error("injected rollback failure");
          }
        },
      },
    }),
    /injected rollback failure/,
  );
});

test("apply mode changes cannot follow a swapped symlink outside staging", async (t) => {
  const state = await rollbackFixture(t);
  const outside = join(state.options.destination, "..", "outside.txt");
  await writeFile(outside, "outside bytes\n");
  await chmod(outside, 0o600);
  const targetPath = join(state.options.destination, "build.gradle");

  await assert.rejects(
    scaffoldProject({
      ...state.options,
      hooks: {
        beforeMutation: async (mutation) => {
          if (mutation.kind === "chmod" && mutation.path === "build.gradle") {
            await unlink(targetPath);
            await symlink(outside, targetPath);
          }
        },
      },
    }),
  );
  assert.equal((await stat(outside)).mode & 0o777, 0o600);
});

test("rollback mode restoration cannot follow a swapped symlink outside staging", async (t) => {
  const state = await rollbackFixture(t);
  const outside = join(state.options.destination, "..", "outside.txt");
  await writeFile(outside, "outside bytes\n");
  await chmod(outside, 0o600);
  const targetPath = join(state.options.destination, "build.gradle");
  const controller = new AbortController();

  await assert.rejects(
    scaffoldProject({
      ...state.options,
      signal: controller.signal,
      hooks: {
        beforeMutation: async (mutation) => {
          if (
            mutation.phase === "apply" &&
            mutation.kind === "chmod" &&
            mutation.path === "build.gradle"
          ) {
            controller.abort();
          }
          if (
            mutation.phase === "rollback" &&
            mutation.kind === "chmod" &&
            mutation.path === "build.gradle"
          ) {
            await unlink(targetPath);
            await symlink(outside, targetPath);
          }
        },
      },
    }),
  );
  assert.equal((await stat(outside)).mode & 0o777, 0o600);
});

test("uses Architectury common and loader modules only for explicit multi-loader selection", async (t) => {
  const multiLoaderTemplate: Record<string, string> = {
    "settings.gradle": `rootProject.name = 'example_mod'
include 'common', 'fabric', 'neoforge'
`,
    "build.gradle": `plugins {
    id 'dev.architectury.loom' version '1.11.0'
}
`,
    "common/src/main/java/com/example/ExampleModCommon.java":
      "package com.example;\npublic final class ExampleModCommon {}\n",
    "fabric/src/main/resources/fabric.mod.json":
      '{"id":"example_mod","name":"Example Mod"}\n',
    "neoforge/src/main/resources/META-INF/neoforge.mods.toml":
      'modId="example_mod"\ndisplayName="Example Mod"\n',
  };
  const { destination, targetPackRoot, target } = await fixture(
    t,
    multiLoaderTemplate,
  );

  const result = await scaffoldProject({
    destination,
    target,
    targetPackRoot,
    mod,
    loaders: ["fabric", "neoforge"],
  });

  assert.equal(result.status, "scaffolded");
  const tree = await snapshot(destination);
  assert.ok(
    tree["common/src/main/java/dev/voxellume/ruby_tools/RubyToolsCommon.java"],
  );
  assert.ok(tree["fabric/src/main/resources/fabric.mod.json"]);
  assert.ok(tree["neoforge/src/main/resources/META-INF/neoforge.mods.toml"]);
  assert.ok(!tree["src/main/resources/fabric.mod.json"]);
  assert.equal(
    await readFile(join(destination, "settings.gradle"), "utf8"),
    "rootProject.name = 'ruby_tools'\ninclude 'common', 'fabric', 'neoforge'\n",
  );
  assert.equal(
    await readFile(
      join(
        destination,
        "common/src/main/java/dev/voxellume/ruby_tools/RubyToolsCommon.java",
      ),
      "utf8",
    ),
    "package dev.voxellume.ruby_tools;\npublic final class RubyToolsCommon {}\n",
  );
  assert.equal(
    await readFile(
      join(destination, "fabric/src/main/resources/fabric.mod.json"),
      "utf8",
    ),
    '{"id":"ruby_tools","name":"Ruby Tools"}\n',
  );
  assert.equal(
    await readFile(
      join(
        destination,
        "neoforge/src/main/resources/META-INF/neoforge.mods.toml",
      ),
      "utf8",
    ),
    'modId="ruby_tools"\ndisplayName="Ruby Tools"\n',
  );
});
