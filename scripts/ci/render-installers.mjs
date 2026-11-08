import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const [outputDirectory, commit, tarSha256, zipSha256, ...extra] =
  process.argv.slice(2);
if (
  extra.length !== 0 ||
  !outputDirectory ||
  !/^[0-9a-f]{40}$/.test(commit ?? "") ||
  !/^[0-9a-f]{64}$/.test(tarSha256 ?? "") ||
  !/^[0-9a-f]{64}$/.test(zipSha256 ?? "")
) {
  console.error(
    "Usage: node scripts/ci/render-installers.mjs <output-directory> <40-character-commit> <tar-sha256> <zip-sha256>",
  );
  process.exit(1);
}

const root = fileURLToPath(new URL("../../", import.meta.url));
await mkdir(outputDirectory, { recursive: true });
for (const [filename, hashPlaceholder, archiveSha256] of [
  ["install.sh", "__VOXELLUME_TAR_SHA256__", tarSha256],
  ["install.ps1", "__VOXELLUME_ZIP_SHA256__", zipSha256],
]) {
  const template = await readFile(join(root, filename), "utf8");
  const rendered = template
    .replaceAll("__VOXELLUME_COMMIT__", commit)
    .replaceAll(hashPlaceholder, archiveSha256);
  await writeFile(join(outputDirectory, filename), rendered);
}
