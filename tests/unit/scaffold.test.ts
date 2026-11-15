import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import { scaffold, type ModMetadata } from "../../src/core/tools/scaffold.ts";

const fixtureRoot = fileURLToPath(
  new URL("../fixtures/template-min", import.meta.url),
);
const fixturePins = fileURLToPath(
  new URL("../fixtures/pins.json", import.meta.url),
);

const mod: ModMetadata = {
  modId: "ruby_tools",
  javaPackage: "dev.example.ruby",
  name: "Ruby Tools",
  version: "2.3.4",
  description: "Adds ruby tools.",
  authors: ["Voxellume"],
  license: "MIT",
};

let packageRoot = "";
let work = "";

before(async () => {
  packageRoot = await mkdtemp(join(tmpdir(), "voxellume-pkg-"));
  work = await mkdtemp(join(tmpdir(), "voxellume-work-"));
  await mkdir(join(packageRoot, "targets"), { recursive: true });
  await mkdir(join(packageRoot, "templates"), { recursive: true });
  await writeFile(
    join(packageRoot, "targets", "pins.json"),
    await readFile(fixturePins),
  );
  await cp(fixtureRoot, join(packageRoot, "templates", "fabric-1.21.1"), {
    recursive: true,
  });
});

after(async () => {
  await rm(packageRoot, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await listFiles(root, relative)));
    else files.push(relative);
  }
  return files.sort();
}

async function readAll(
  root: string,
  files: readonly string[],
): Promise<string> {
  const parts: string[] = [];
  for (const file of files)
    parts.push(await readFile(join(root, file), "utf8"));
  return parts.join("\n");
}

test("scaffold rewrites a project from the pinned template", async () => {
  const result = await scaffold(
    { destination: "ruby", pinId: "java-fabric-1.21.1", mod },
    { packageRoot, cwd: work },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.pinId, "java-fabric-1.21.1");
  assert.deepEqual(result.value.notes, [
    "class names kept as ExampleMod/ExampleModClient",
  ]);

  const files = await listFiles(join(work, "ruby"));
  assert.deepEqual([...result.value.files], files);
  assert.ok(files.includes("src/main/java/dev/example/ruby/ExampleMod.java"));
  assert.ok(
    files.includes(
      "src/client/java/dev/example/ruby/client/ExampleModClient.java",
    ),
  );
  assert.ok(files.includes("src/main/resources/assets/ruby_tools/icon.png"));

  const java = await readFile(
    join(
      work,
      "ruby",
      "src",
      "main",
      "java",
      "dev",
      "example",
      "ruby",
      "ExampleMod.java",
    ),
    "utf8",
  );
  assert.ok(java.includes("package dev.example.ruby;"));
  assert.ok(java.includes('"ruby_tools"'));

  const metadata = JSON.parse(
    await readFile(
      join(work, "ruby", "src", "main", "resources", "fabric.mod.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  assert.equal(metadata["id"], "ruby_tools");
  assert.equal(metadata["name"], "Ruby Tools");
  assert.equal(metadata["description"], "Adds ruby tools.");
  assert.equal(metadata["license"], "MIT");
  assert.deepEqual(metadata["authors"], ["Voxellume"]);
  assert.deepEqual(metadata["entrypoints"], {
    main: ["dev.example.ruby.ExampleMod"],
    client: ["dev.example.ruby.client.ExampleModClient"],
  });
  assert.deepEqual(metadata["mixins"], ["ruby_tools.mixins.json"]);

  const properties = await readFile(
    join(work, "ruby", "gradle.properties"),
    "utf8",
  );
  assert.ok(properties.includes("version=2.3.4"));
  assert.ok(properties.includes("group=dev.example.ruby"));

  const everything = await readAll(
    join(work, "ruby"),
    files.filter(
      (f) =>
        f.endsWith(".json") || f.endsWith(".java") || f.endsWith(".properties"),
    ),
  );
  for (const stale of [
    "com.example",
    "Example Mod",
    '"modid"',
    "assets/modid",
  ]) {
    assert.equal(everything.includes(stale), false, `stale token ${stale}`);
  }
});

test("scaffold refuses a non-empty destination", async () => {
  const destination = join(work, "busy");
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, "keep.txt"), "keep", "utf8");
  const result = await scaffold(
    { destination, mod },
    { packageRoot, cwd: work },
  );
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "destination_not_empty");
});

test("scaffold writes into an existing empty destination", async () => {
  await mkdir(join(work, "empty"), { recursive: true });
  const result = await scaffold(
    { destination: "empty", mod },
    { packageRoot, cwd: work },
  );
  assert.equal(result.status, "ok");
});

test("scaffold rejects a destination outside the working directory", async () => {
  const result = await scaffold(
    { destination: join(work, "..", "outside"), mod },
    { packageRoot, cwd: work },
  );
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "destination_outside_root");
});

test("scaffold rejects an unknown pin", async () => {
  const result = await scaffold(
    { destination: "x", pinId: "java-fabric-9.9.9", mod },
    { packageRoot, cwd: work },
  );
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "pin_not_found");
});

test("scaffold rejects a pin without a template", async () => {
  const result = await scaffold(
    { destination: "y", pinId: "java-fabric-1.20.1", mod },
    { packageRoot, cwd: work },
  );
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "template_missing");
});

test("scaffold rejects an absent template directory", async () => {
  packageRoot = await mkdtemp(join(tmpdir(), "voxellume-pkg-"));
  await mkdir(join(packageRoot, "targets"), { recursive: true });
  await writeFile(
    join(packageRoot, "targets", "pins.json"),
    await readFile(fixturePins),
  );
  const result = await scaffold(
    { destination: "z", mod },
    { packageRoot, cwd: work },
  );
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "template_missing");
});

test("scaffold rejects malformed mod metadata", async () => {
  const cases: ModMetadata[] = [
    { ...mod, modId: "Bad-Id" },
    { ...mod, modId: "x" },
    { ...mod, javaPackage: "com" },
    { ...mod, javaPackage: "Com.Example" },
    { ...mod, name: " " },
    { ...mod, version: "" },
    { ...mod, description: "" },
    { ...mod, license: "" },
    { ...mod, authors: [] },
    { ...mod, authors: [" "] },
  ];
  for (const invalid of cases) {
    const result = await scaffold(
      { destination: "invalid", mod: invalid },
      { packageRoot, cwd: work },
    );
    assert.equal(result.status, "error", JSON.stringify(invalid));
    if (result.status !== "error") return;
    assert.equal(result.error.code, "invalid_request");
  }
});

test("scaffold rejects a version containing a line break", async () => {
  const result = await scaffold(
    {
      destination: "newline-version",
      mod: {
        ...mod,
        version: "1.0.0\norg.gradle.jvmargs=-javaagent:/tmp/x.jar",
      },
    },
    { packageRoot, cwd: work },
  );
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "invalid_request");
});

test("scaffold escapes a quoted mod name for JSON", async () => {
  packageRoot = await mkdtemp(join(tmpdir(), "voxellume-pkg-"));
  await mkdir(join(packageRoot, "targets"), { recursive: true });
  await writeFile(
    join(packageRoot, "targets", "pins.json"),
    await readFile(fixturePins),
  );
  await cp(fixtureRoot, join(packageRoot, "templates", "fabric-1.21.1"), {
    recursive: true,
  });
  const result = await scaffold(
    {
      destination: "quoted",
      mod: { ...mod, name: 'A "quoted" name' },
    },
    { packageRoot, cwd: work },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  const metadata = JSON.parse(
    await readFile(
      join(work, "quoted", "src", "main", "resources", "fabric.mod.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  assert.equal(metadata["name"], 'A "quoted" name');
});

test("scaffold reports internal_error for a throw it cannot classify", async () => {
  const root = await mkdtemp(join(tmpdir(), "voxellume-pkg-"));
  await mkdir(join(root, "targets"), { recursive: true });
  await writeFile(
    join(root, "targets", "pins.json"),
    await readFile(fixturePins),
  );
  await cp(fixtureRoot, join(root, "templates", "fabric-1.21.1"), {
    recursive: true,
  });
  try {
    // A non-string cwd makes path resolution throw a TypeError: no coded error
    // applies, so the envelope must carry internal_error instead of rejecting.
    const result = await scaffold(
      { destination: "unclassified", mod },
      { packageRoot: root, cwd: undefined as never },
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.error.code, "internal_error");
    assert.equal(result.error.detail.includes("\n"), false);
    assert.equal(result.error.detail.includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
