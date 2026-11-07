import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";

const skillNames = [
  "minecraft-design",
  "minecraft-targets",
  "minecraft-implementation",
  "minecraft-assets",
  "minecraft-verification",
  "minecraft-porting",
  "minecraft-release",
] as const;

function headingSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

test("capability documentation links resolve to files and headings", async () => {
  const documents = [
    ...skillNames.map((name) => `skills/${name}/SKILL.md`),
    "agents/mod-orchestrator.md",
    "agents/mod-offline-worker.md",
    "agents/mod-game-worker.md",
    "commands/mod-create.md",
    "commands/mod-verify.md",
    "commands/mod-port.md",
  ];
  for (const document of documents) {
    const body = await readFile(document, "utf8");
    for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1]!;
      if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue;
      const [path, anchor] = target.split("#");
      const resolved = resolve(dirname(document), path!);
      const targetBody = await readFile(resolved, "utf8");
      if (anchor !== undefined) {
        const headings = [...targetBody.matchAll(/^#{1,6}\s+(.+)$/gm)].map(
          (heading) => headingSlug(heading[1]!),
        );
        assert.ok(
          headings.includes(decodeURIComponent(anchor)),
          `${document} links to missing heading ${target}`,
        );
      }
    }
  }
});

test("only the game worker receives process-launching tools", async () => {
  const [orchestrator, offline, game] = await Promise.all([
    readFile("agents/mod-orchestrator.md", "utf8"),
    readFile("agents/mod-offline-worker.md", "utf8"),
    readFile("agents/mod-game-worker.md", "utf8"),
  ]);
  for (const body of [orchestrator, offline, game]) {
    assert.match(body, /^---\nname: mod-/);
    assert.match(body, /^description: \S.+$/m);
  }
  assert.doesNotMatch(orchestrator, /^tools:.*\bbash\b/m);
  assert.doesNotMatch(offline, /^tools:.*\bbash\b/m);
  assert.match(game, /^tools:.*\bbash\b/m);
  assert.doesNotMatch(orchestrator, /^tools:.*\bminecraft_project_verify\b/m);
  assert.doesNotMatch(offline, /^tools:.*\bminecraft_project_verify\b/m);
  assert.match(game, /^tools:.*\bminecraft_project_verify\b/m);
});
