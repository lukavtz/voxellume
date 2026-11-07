import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const execFileAsync = promisify(execFile);

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(new URL(path, root), "utf8")) as T;
}

interface PackageContract {
  name: string;
  version: string;
  scripts: Record<string, string>;
}

interface TargetPack {
  id: string;
  packSha256: string;
}

interface Verification {
  evidenceManifest?: { path: string; sha256: string };
}

interface SupportManifest {
  schemaVersion: string;
  package: { name: string; version: string; revision: string };
  targetPacks: {
    id: string;
    packSha256: string;
    qualificationEvidence: { path: string; sha256: string } | null;
  }[];
}

test("prepack emits every host entry and excludes development content", async () => {
  const { stdout } = await execFileAsync(
    "corepack",
    ["pnpm", "pack", "--dry-run"],
    {
      cwd: fileURLToPath(root),
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  for (const required of [
    "dist/adapters/omp/index.js",
    "dist/adapters/omp/index.d.ts",
    "dist/adapters/dsh/index.js",
    "dist/adapters/dsh/index.d.ts",
    "dist/adapters/mcp/server.js",
    "dist/adapters/mcp/server.d.ts",
    "dist/core/results.js",
    "dist/core/results.d.ts",
    "cordis.patch.yml",
    "skills/minecraft-design/SKILL.md",
    "agents/mod-orchestrator.md",
    "commands/mod-create.md",
    "support-manifest.json",
  ]) {
    assert.ok(
      stdout.includes(`\n${required}\n`),
      `tarball is missing ${required}`,
    );
  }
  for (const excluded of [
    "tests/",
    "fixtures/",
    ".artifacts/",
    "run/",
    "node_modules/",
    "pnpm-lock.yaml",
    "scripts/",
  ]) {
    assert.equal(
      stdout.includes(excluded),
      false,
      `tarball includes ${excluded}`,
    );
  }
  const pkg = await readJson<PackageContract>("package.json");
  for (const script of ["postinstall", "install", "prepare"]) {
    assert.equal(pkg.scripts[script], undefined);
  }
});

test("support manifest records every actual pack without inventing qualification evidence", async () => {
  const pkg = await readJson<PackageContract>("package.json");
  const manifest = await readJson<SupportManifest>("support-manifest.json");
  const expected = [];

  for (const loader of (
    await readdir(new URL("target-packs/java/", root))
  ).sort()) {
    for (const minecraft of (
      await readdir(new URL(`target-packs/java/${loader}/`, root))
    ).sort()) {
      const base = `target-packs/java/${loader}/${minecraft}/`;
      const pack = await readJson<TargetPack>(`${base}target.json`);
      const verification = await readJson<Verification>(
        `${base}verification.json`,
      );
      expected.push({
        id: pack.id,
        packSha256: pack.packSha256,
        qualificationEvidence: verification.evidenceManifest ?? null,
      });
    }
  }
  expected.sort((left, right) => left.id.localeCompare(right.id));

  assert.equal(manifest.schemaVersion, "voxellume-support-manifest-1.0.0");
  assert.deepEqual(manifest.package, {
    name: pkg.name,
    version: pkg.version,
    revision: pkg.version,
  });
  assert.equal(manifest.targetPacks.length, 68);
  assert.deepEqual(manifest.targetPacks, expected);
});
