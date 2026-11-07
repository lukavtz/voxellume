import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const targetRoot = new URL("target-packs/java/", root);
const [command, ...args] = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function loadPacks() {
  const packs = [];
  for (const loader of (
    await readdir(targetRoot, { withFileTypes: true })
  ).toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (!loader.isDirectory()) continue;
    const loaderRoot = new URL(`${loader.name}/`, targetRoot);
    for (const minecraft of (
      await readdir(loaderRoot, { withFileTypes: true })
    ).toSorted((a, b) => a.name.localeCompare(b.name))) {
      if (!minecraft.isDirectory()) continue;
      const pack = JSON.parse(
        await readFile(
          new URL(`${minecraft.name}/target.json`, loaderRoot),
          "utf8",
        ),
      );
      const verification = JSON.parse(
        await readFile(
          new URL(`${minecraft.name}/verification.json`, loaderRoot),
          "utf8",
        ),
      );
      packs.push({
        ...pack,
        verification,
        directory: `target-packs/java/${loader.name}/${minecraft.name}`,
      });
    }
  }
  return packs.toSorted((a, b) => a.id.localeCompare(b.id));
}

function selectAffected(packs, base) {
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", `${base}...HEAD`],
    {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter(Boolean);
  const shared = changed.some(
    (file) =>
      /^(?:src|tests|scripts|fixtures|templates)\//.test(file) ||
      ["package.json", "pnpm-lock.yaml", "support-manifest.json"].includes(
        file,
      ),
  );
  if (shared) return packs;
  const directories = new Set(
    changed.map((file) => file.split("/").slice(0, 4).join("/")),
  );
  return packs.filter((pack) => directories.has(pack.directory));
}

async function writePlan(packs) {
  const output = option("--output") ?? ".artifacts/target-matrix/plan.json";
  await mkdir(new URL("./", new URL(output, root)), { recursive: true });
  await writeFile(new URL(output, root), `${JSON.stringify(packs, null, 2)}\n`);
}

if (command === "plan") {
  let packs = await loadPacks();
  const requested = option("--pack");
  const base = option("--base");
  if (requested) {
    packs = packs.filter((pack) => pack.id === requested);
    assert.equal(packs.length, 1, `Unknown target pack ${requested}`);
  } else if (base) packs = selectAffected(packs, base);
  const matrix = packs.map((pack) => ({
    id: pack.id,
    java: pack.java.gradleJvm,
    status: pack.status,
  }));
  const plan = {
    schemaVersion: "voxellume-ci-target-plan-1.0.0",
    matrix,
    supportedCount: matrix.filter((pack) => pack.status === "supported").length,
    supportedJava: [
      ...new Set(
        matrix
          .filter((pack) => pack.status === "supported")
          .map((pack) => pack.java),
      ),
    ].toSorted(),
  };
  await writePlan(plan);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `matrix=${JSON.stringify({ include: matrix })}\n`,
    );
    await appendFile(process.env.GITHUB_OUTPUT, `count=${matrix.length}\n`);
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `supported_count=${plan.supportedCount}\n`,
    );
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `supported_java=${JSON.stringify(plan.supportedJava)}\n`,
    );
  }
} else if (command === "cell") {
  const id = option("--pack");
  assert.ok(id, "--pack is required");
  const pack = (await loadPacks()).find((candidate) => candidate.id === id);
  assert.ok(pack, `Unknown target pack ${id}`);
  const output =
    option("--output") ?? `.artifacts/target-matrix/${id}/result.json`;
  const statuses = Object.fromEntries(
    pack.verification.required.map((check) => [
      check,
      {
        checked: false,
        status:
          pack.status === "rejected"
            ? "failed"
            : pack.status === "unsupported"
              ? "unsupported"
              : "unavailable",
        reason:
          pack.status === "supported"
            ? "No CI runtime executor is configured; archived evidence cannot substitute for a fresh run."
            : `Pack status is ${pack.status}; only supported packs may execute qualification commands.`,
      },
    ]),
  );
  const result = {
    schemaVersion: "voxellume-ci-target-cell-1.0.0",
    pack: {
      id: pack.id,
      revision: pack.revision,
      status: pack.status,
      packSha256: pack.packSha256,
    },
    java: pack.java,
    checks: statuses,
    successArtifactsCreated: false,
    knownLimitations: pack.knownLimitations,
  };
  const destination = new URL(output, root);
  await mkdir(new URL("./", destination), { recursive: true });
  const bytes = `${JSON.stringify(result, null, 2)}\n`;
  await writeFile(destination, bytes);
  await writeFile(
    new URL("SHA256SUMS", new URL("./", destination)),
    `${createHash("sha256").update(bytes).digest("hex")}  result.json\n`,
  );
  if (pack.status === "supported") {
    console.error(
      `${id}: fresh runtime execution unavailable; refusing to reuse archived evidence as a CI pass.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `${id}: recorded ${pack.status}; no runtime check executed and no success artifact created.`,
    );
  }
} else if (command === "runtime") {
  const java = Number(option("--java"));
  assert.ok(java === 21 || java === 25, "--java must be 21 or 25");
  const packs = (await loadPacks()).filter(
    (pack) => pack.status === "supported" && pack.java.gradleJvm === java,
  );
  const result = {
    schemaVersion: "voxellume-ci-runtime-1.0.0",
    java,
    status: packs.length === 0 ? "unavailable" : "failed",
    checked: false,
    packs: packs.map((pack) => pack.id),
    reason:
      packs.length === 0
        ? "No supported packs require this JDK."
        : "No real server/client/GameTest/production-JAR/visual executor is configured.",
  };
  const output =
    option("--output") ?? `.artifacts/runtime-visual/jdk-${java}/result.json`;
  const destination = new URL(output, root);
  await mkdir(new URL("./", destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`);
  if (packs.length > 0) process.exitCode = 1;
} else {
  throw new Error("Usage: target-cell.mjs plan|cell|runtime [options]");
}
