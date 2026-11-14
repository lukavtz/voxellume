import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fileURLToPath } from "node:url";

import { apply, inject, name } from "../../src/adapters/dsh/index.ts";

interface RegisteredDefinition {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

test("DSH adapter registers four tools and one prompt section", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "voxellume-dsh-"));
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  const definitions: RegisteredDefinition[] = [];
  const sections: { name: string; order: number; text: string }[] = [];
  const ctx = {
    tools: {
      register: (definition: RegisteredDefinition) => {
        definitions.push(definition);
        return () => {};
      },
    },
    systemPrompt: {
      section: (section: { name: string; order: number; text: string }) => {
        sections.push(section);
        return () => {};
      },
    },
  };

  const previous = process.cwd();
  process.chdir(cwd);
  try {
    await apply(ctx as never);
  } finally {
    process.chdir(previous);
  }

  assert.equal(name, "voxellume");
  assert.deepEqual([...inject], ["tools", "systemPrompt"]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0]?.order, 4000);

  const root = fileURLToPath(new URL("../../skills/", import.meta.url));
  const skillDirs = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.ok(skillDirs.length >= 14);
  for (const skill of skillDirs) {
    const body = await readFile(join(root, skill, "SKILL.md"), "utf8");
    const heading = body.split("\n").find((line) => line.startsWith("# "));
    assert.ok(heading !== undefined, `${skill} has no heading`);
    assert.ok(
      sections[0]?.text.includes(heading),
      `prompt section is missing ${skill}`,
    );
  }

  assert.deepEqual(
    definitions.map((definition) => definition.name),
    [
      "minecraft_target_info",
      "minecraft_project_scaffold",
      "minecraft_run",
      "minecraft_assets_check",
    ],
  );
  const info = definitions[0]!;
  const value = (await info.execute({
    minecraft: "1.21.1",
    loader: "fabric",
  })) as {
    status: string;
    value: { pins: Array<{ id: string }> };
  };
  assert.equal(value.status, "ok");
  assert.equal(value.value.pins[0]?.id, "java-fabric-1.21.1");
});
