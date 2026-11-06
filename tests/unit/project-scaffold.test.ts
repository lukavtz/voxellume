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
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { scaffoldProject } from "../../src/core/projects/scaffold-project.ts";
import type {
  TargetPack,
  TargetPackStatus,
} from "../../src/core/targets/target-pack.ts";

const packUrl = new URL(
  "../../target-packs/java/fabric/1.21.1/target.json",
  import.meta.url,
);

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

async function target(status: TargetPackStatus): Promise<TargetPack> {
  const pack = JSON.parse(await readFile(packUrl, "utf8")) as TargetPack;
  return {
    ...pack,
    status,
    ...(status === "rejected" || status === "unsupported"
      ? {
          reason: {
            code: "verification_failed" as const,
            detail: "Synthetic scaffold refusal fixture.",
            evidence: [
              {
                url: "https://example.invalid/qualification.json",
                sha256:
                  "9b2e18a69c684e429f52ef93dc829b865b4e2986a6a21ea57a2c77a84ab15e21",
              },
            ],
          },
        }
      : {}),
  };
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(directory: string, prefix = ""): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path, name);
      else {
        assert.ok(entry.isFile(), `unexpected fixture entry: ${path}`);
        result[name] = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
      }
    }
  }
  await visit(root);
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function project(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-scaffold-unit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = join(root, "project");
  await mkdir(join(destination, ".git"), { recursive: true });
  await writeFile(join(destination, ".git", "HEAD"), "ref: refs/heads/user\n");
  await writeFile(join(destination, "user.txt"), "user-owned\n");
  return destination;
}

for (const status of [
  "draft",
  "candidate",
  "legacy",
  "rejected",
  "unsupported",
] as const) {
  test(`refuses ${status} targets before filesystem or Git mutation`, async (t) => {
    const destination = await project(t);
    const before = await snapshot(destination);
    const result = await scaffoldProject({
      destination,
      target: await target(status),
      // A nonexistent template root proves status is checked before template I/O.
      targetPackRoot: join(destination, "missing-target-pack"),
      mod,
    });

    assert.deepEqual(result, {
      status: "unsupported",
      code: "unsupported_target",
      targetPackId: "java-fabric-1.21.1-r1",
      targetStatus: status,
    });
    assert.deepEqual(await snapshot(destination), before);
  });
}

test("refuses an existing generated-file conflict without partial writes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "voxellume-scaffold-conflict-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = join(root, "project");
  const targetPackRoot = join(root, "pack");
  await mkdir(destination, { recursive: true });
  await mkdir(join(targetPackRoot, "templates"), { recursive: true });
  await writeFile(join(destination, "build.gradle"), "user build\n");
  await writeFile(join(destination, "user.txt"), "preserve me\n");
  await mkdir(join(destination, ".git"));
  await writeFile(join(destination, ".git", "HEAD"), "ref: refs/heads/user\n");
  await writeFile(
    join(targetPackRoot, "templates", "build.gradle"),
    "generated build\n",
  );
  await writeFile(
    join(targetPackRoot, "templates", "settings.gradle"),
    "rootProject.name = 'ruby_tools'\n",
  );
  const before = await snapshot(destination);

  const result = await scaffoldProject({
    destination,
    target: await target("supported"),
    targetPackRoot,
    mod,
  });

  assert.deepEqual(result, {
    status: "conflict",
    code: "existing_file_conflict",
    conflicts: ["build.gradle"],
  });
  assert.deepEqual(await snapshot(destination), before);
});
