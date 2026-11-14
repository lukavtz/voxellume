import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { packageRoot } from "../../src/core/root.ts";
import { scaffold, type ModMetadata } from "../../src/core/tools/scaffold.ts";

const mod: ModMetadata = {
  modId: "ruby_tools",
  javaPackage: "dev.voxellume.ruby",
  name: "Ruby Tools",
  version: "2.3.4",
  description: "Adds ruby tools to Minecraft.",
  authors: ["Voxellume"],
  license: "MIT",
};

test("scaffold produces a coherent project from templates/fabric-1.21.1", async () => {
  const work = await mkdtemp(join(tmpdir(), "voxellume-template-"));
  try {
    const result = await scaffold(
      { destination: "ruby", pinId: "java-fabric-1.21.1", mod },
      { packageRoot: packageRoot(), cwd: work },
    );
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;

    const project = join(work, "ruby");
    const properties = await readFile(
      join(project, "gradle.properties"),
      "utf8",
    );
    assert.ok(properties.includes("minecraft_version=1.21.1"));
    assert.ok(properties.includes("loader_version=0.20.1"));
    assert.ok(properties.includes("loom_version=1.17.21"));
    assert.ok(properties.includes("version=2.3.4"));
    assert.ok(properties.includes("group=dev.voxellume.ruby"));
    assert.equal(properties.includes("com.example"), false);

    const metadata = JSON.parse(
      await readFile(
        join(project, "src", "main", "resources", "fabric.mod.json"),
        "utf8",
      ),
    ) as {
      id: string;
      name: string;
      entrypoints: { main: string[]; client: string[] };
      mixins: unknown[];
      icon: string;
    };
    assert.equal(metadata.id, "ruby_tools");
    assert.equal(metadata.name, "Ruby Tools");
    assert.deepEqual(metadata.entrypoints.main, [
      "dev.voxellume.ruby.ExampleMod",
    ]);
    assert.deepEqual(metadata.entrypoints.client, [
      "dev.voxellume.ruby.client.ExampleModClient",
    ]);
    assert.deepEqual(metadata.mixins, [
      "ruby_tools.mixins.json",
      { config: "ruby_tools.client.mixins.json", environment: "client" },
    ]);
    assert.equal(metadata.icon, "assets/ruby_tools/icon.png");

    const templateJar = await readFile(
      join(
        packageRoot(),
        "templates",
        "fabric-1.21.1",
        "gradle",
        "wrapper",
        "gradle-wrapper.jar",
      ),
    );
    const projectJar = await readFile(
      join(project, "gradle", "wrapper", "gradle-wrapper.jar"),
    );
    assert.equal(Buffer.compare(templateJar, projectJar), 0);

    const gradlew = await readFile(join(project, "gradlew"), "utf8");
    assert.ok(gradlew.startsWith("#!/bin/sh"));
    assert.equal(gradlew.includes("\r"), false);
    const gradlewBat = await readFile(join(project, "gradlew.bat"));
    assert.ok(gradlewBat.includes(Buffer.from("\r\n")));

    assert.deepEqual([...result.value.files], await listRecursive(project));

    const main = await readFile(
      join(
        project,
        "src",
        "main",
        "java",
        "dev",
        "voxellume",
        "ruby",
        "ExampleMod.java",
      ),
      "utf8",
    );
    assert.ok(main.includes("package dev.voxellume.ruby;"));
    const mixin = await readFile(
      join(
        project,
        "src",
        "main",
        "java",
        "dev",
        "voxellume",
        "ruby",
        "mixin",
        "ExampleMixin.java",
      ),
      "utf8",
    );
    assert.ok(mixin.includes("package dev.voxellume.ruby.mixin;"));
    assert.ok(mixin.includes("ruby_tools.mixins.json") === false);
    const mixinConfig = JSON.parse(
      await readFile(
        join(project, "src", "main", "resources", "ruby_tools.mixins.json"),
        "utf8",
      ),
    ) as { package: string };
    assert.equal(mixinConfig.package, "dev.voxellume.ruby.mixin");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

async function listRecursive(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory())
      files.push(...(await listRecursive(root, relativePath)));
    else files.push(relativePath);
  }
  return files.sort();
}
