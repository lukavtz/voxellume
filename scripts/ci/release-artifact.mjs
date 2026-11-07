import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const outputRoot = join(root, ".artifacts", "release");
const requireSupported = process.argv.includes("--require-supported");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function json(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

async function verifySupportManifest() {
  const pkg = await json("package.json");
  const manifest = await json("support-manifest.json");
  const expected = [];
  const statusCounts = {};
  for (const loader of await readdir(join(root, "target-packs", "java"), {
    withFileTypes: true,
  })) {
    if (!loader.isDirectory()) continue;
    for (const minecraft of await readdir(
      join(root, "target-packs", "java", loader.name),
      { withFileTypes: true },
    )) {
      if (!minecraft.isDirectory()) continue;
      const base = `target-packs/java/${loader.name}/${minecraft.name}`;
      const pack = await json(`${base}/target.json`);
      const verification = await json(`${base}/verification.json`);
      statusCounts[pack.status] = (statusCounts[pack.status] ?? 0) + 1;
      expected.push({
        id: pack.id,
        packSha256: pack.packSha256,
        qualificationEvidence: verification.evidenceManifest ?? null,
      });
      if (pack.status === "supported") {
        const evidence = verification.evidenceManifest;
        assert.ok(evidence, `${pack.id}: supported pack lacks evidence`);
        const evidencePath = join(root, evidence.path);
        const relativeEvidence = relative(root, evidencePath);
        assert.ok(
          !isAbsolute(relativeEvidence) && !relativeEvidence.startsWith(".."),
          `${pack.id}: evidence escapes repository`,
        );
        const bytes = await readFile(evidencePath);
        assert.equal(
          sha256(bytes),
          evidence.sha256,
          `${pack.id}: evidence hash mismatch`,
        );
      }
    }
  }
  expected.sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(manifest.schemaVersion, "voxellume-support-manifest-1.0.0");
  assert.deepEqual(manifest.package, {
    name: pkg.name,
    version: pkg.version,
    revision: pkg.version,
  });
  assert.equal(expected.length, 68);
  assert.deepEqual(manifest.targetPacks, expected);
  return { pkg, manifest, statusCounts };
}

async function pack(destination) {
  await mkdir(destination, { recursive: true });
  execFileSync(
    "corepack",
    [
      "pnpm",
      "pack",
      "--pack-gzip-level",
      "9",
      "--pack-destination",
      destination,
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production", SOURCE_DATE_EPOCH: "0" },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const archives = (await readdir(destination)).filter((name) =>
    name.endsWith(".tgz"),
  );
  assert.equal(archives.length, 1);
  return join(destination, archives[0]);
}

async function inventory(directory) {
  const entries = [];
  async function walk(relative) {
    for (const entry of (
      await readdir(join(directory, relative), { withFileTypes: true })
    ).toSorted((a, b) => a.name.localeCompare(b.name))) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else {
        const info = await stat(join(directory, child));
        assert.ok(
          entry.isFile(),
          `Unexpected non-file package entry: ${child}`,
        );
        entries.push({
          path: child,
          mode: info.mode & 0o777,
          sha256: sha256(await readFile(join(directory, child))),
        });
      }
    }
  }
  await walk("");
  return entries;
}

async function normalizedInventory(archive, destination) {
  await mkdir(destination, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "-C", destination], {
    cwd: root,
    stdio: "inherit",
  });
  return inventory(destination);
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const { pkg, manifest, statusCounts } = await verifySupportManifest();
await writeFile(
  join(outputRoot, "support-status.json"),
  `${JSON.stringify({ schemaVersion: "voxellume-release-readiness-1.0.0", targetStatusCounts: statusCounts, supportedTargets: statusCounts.supported ?? 0 }, null, 2)}\n`,
);
if (requireSupported)
  assert.ok(
    (statusCounts.supported ?? 0) > 0,
    "Release blocked: catalog has zero supported target packs",
  );
const first = await pack(join(outputRoot, "first"));
const second = await pack(join(outputRoot, "second"));
const firstBytes = await readFile(first);
const secondBytes = await readFile(second);
const firstHash = sha256(firstBytes);
const secondHash = sha256(secondBytes);
const firstInventory = await normalizedInventory(
  first,
  join(outputRoot, "normalized-first"),
);
const secondInventory = await normalizedInventory(
  second,
  join(outputRoot, "normalized-second"),
);
assert.deepEqual(
  firstInventory,
  secondInventory,
  "Normalized package outputs differ",
);
const byteIdentical = firstHash === secondHash;
const filename = `${pkg.name}-${pkg.version}.tgz`;
const artifact = join(outputRoot, filename);
await copyFile(first, artifact);
const artifactBytes = await readFile(artifact);
assert.equal(sha256(artifactBytes), firstHash);
await writeFile(join(outputRoot, "SHA256SUMS"), `${firstHash}  ${filename}\n`);
await writeFile(
  join(outputRoot, "package-files.json"),
  `${JSON.stringify(firstInventory, null, 2)}\n`,
);
await writeFile(
  join(outputRoot, "reproducibility.json"),
  `${JSON.stringify(
    {
      schemaVersion: "voxellume-reproducibility-1.0.0",
      byteIdentical,
      normalizedIdentical: true,
      normalization:
        "Sorted package relative paths, executable modes, and file SHA-256; ignored gzip and tar timestamps/ownership.",
      firstSha256: firstHash,
      secondSha256: secondHash,
    },
    null,
    2,
  )}\n`,
);

const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const provenance = {
  schemaVersion: "voxellume-package-provenance-1.0.0",
  package: { name: pkg.name, version: pkg.version, revision },
  artifact: { path: filename, sha256: firstHash },
  inputs: {
    packageJsonSha256: sha256(await readFile(join(root, "package.json"))),
    lockfileSha256: sha256(await readFile(join(root, "pnpm-lock.yaml"))),
    supportManifestSha256: sha256(
      await readFile(join(root, "support-manifest.json")),
    ),
  },
  targetStatusCounts: statusCounts,
  supportManifestEntries: manifest.targetPacks.length,
  toolVersions: { node: process.version, pnpm: pkg.packageManager },
  reproducibility: { byteIdentical, normalizedIdentical: true },
  attestation:
    "Unsigned CI provenance; no OIDC identity or signature is claimed.",
};
await writeFile(
  join(outputRoot, "provenance.json"),
  `${JSON.stringify(provenance, null, 2)}\n`,
);
await rm(join(outputRoot, "first"), { recursive: true, force: true });
await rm(join(outputRoot, "second"), { recursive: true, force: true });
await rm(join(outputRoot, "normalized-first"), {
  recursive: true,
  force: true,
});
await rm(join(outputRoot, "normalized-second"), {
  recursive: true,
  force: true,
});
console.log(`${filename} ${firstHash}`);
console.log(`Target statuses: ${JSON.stringify(statusCounts)}`);
console.log(
  `Byte-identical packs: ${byteIdentical}; normalized inventories identical: true`,
);
