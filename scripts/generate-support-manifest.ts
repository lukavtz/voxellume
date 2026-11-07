import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const targetRoot = join(root, "target-packs", "java");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
  name: string;
  version: string;
};
const targetPacks = [];

for (const loader of await readdir(targetRoot)) {
  for (const minecraft of await readdir(join(targetRoot, loader))) {
    const directory = join(targetRoot, loader, minecraft);
    const pack = JSON.parse(
      await readFile(join(directory, "target.json"), "utf8"),
    ) as {
      id: string;
      packSha256: string;
    };
    const verification = JSON.parse(
      await readFile(join(directory, "verification.json"), "utf8"),
    ) as { evidenceManifest?: { path: string; sha256: string } };
    targetPacks.push({
      id: pack.id,
      packSha256: pack.packSha256,
      qualificationEvidence: verification.evidenceManifest ?? null,
    });
  }
}

targetPacks.sort((left, right) => left.id.localeCompare(right.id));
const manifest = {
  schemaVersion: "voxellume-support-manifest-1.0.0",
  package: { name: pkg.name, version: pkg.version, revision: pkg.version },
  targetPacks,
};
await writeFile(
  join(root, "support-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
