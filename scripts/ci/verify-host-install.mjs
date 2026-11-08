import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tarball = resolve(
  process.argv[2] ?? ".artifacts/release/voxellume-0.1.0.tgz",
);
const evidence = resolve(process.argv[3] ?? ".artifacts/host-install");
await mkdir(evidence, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "voxellume-host-install-"));
const home = join(temporary, "home");
const ompPackage = join(temporary, "omp-package");
await mkdir(home, { recursive: true });
await mkdir(ompPackage, { recursive: true });
await execFileAsync("tar", [
  "-xzf",
  tarball,
  "-C",
  ompPackage,
  "--strip-components=1",
]);
const env = {
  PATH: process.env.PATH,
  HOME: home,
  TMPDIR: temporary,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  DSH_HOME: join(home, ".dsh"),
  DSH_TELEMETRY_MODE: "DISABLED",
  CI: "1",
  NO_COLOR: "1",
};
const results = [];
const omp = resolve("node_modules/.bin/omp");
const dsh = resolve("node_modules/.bin/dsh");

async function run(id, command, args, outputFile) {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: process.cwd(),
      env,
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (outputFile) await writeFile(join(evidence, outputFile), stdout);
    await writeFile(
      join(evidence, `${id}.log`),
      `$ ${command} ${args.join(" ")}\n${stdout}${stderr}`,
    );
    results.push({
      id,
      status: "passed",
      exitCode: 0,
      durationMs: Date.now() - started,
    });
    return stdout;
  } catch (error) {
    await writeFile(
      join(evidence, `${id}.log`),
      `$ ${command} ${args.join(" ")}\n${error.stdout ?? ""}${error.stderr ?? ""}${error.message}\n`,
    );
    results.push({
      id,
      status: "failed",
      exitCode: error.code ?? null,
      durationMs: Date.now() - started,
    });
    throw error;
  } finally {
    await writeFile(
      join(evidence, "results.json"),
      `${JSON.stringify(
        {
          schemaVersion: "voxellume-host-install-1.0.0",
          tarballSha256: createHash("sha256")
            .update(await readFile(tarball))
            .digest("hex"),
          results,
        },
        null,
        2,
      )}\n`,
    );
  }
}

try {
  const ompList = await run(
    "omp-install",
    omp,
    ["plugin", "install", ompPackage, "--json"],
    "omp-install.json",
  );
  assert.ok(
    ompList.includes("voxellume"),
    "OMP install result does not name voxellume",
  );
  const installed = await run(
    "omp-list",
    omp,
    ["plugin", "list", "--json"],
    "omp-list.json",
  );
  assert.ok(
    installed.includes("voxellume"),
    "OMP plugin list does not contain voxellume",
  );
  await run("omp-uninstall", omp, [
    "plugin",
    "uninstall",
    "voxellume",
    "--json",
  ]);

  await run("dsh-install", dsh, [
    "plugin",
    "--profile",
    "voxellume-test",
    "add",
    tarball,
    "--ignore-scripts",
    "--config.auto-install-peers=false",
  ]);
  const dump = await run(
    "dsh-dump-config",
    dsh,
    ["--profile", "voxellume-test", "--dump-config"],
    "dsh-config.yml",
  );
  assert.ok(
    dump.includes("voxellume"),
    "Harness dump-config does not contain voxellume",
  );
  await run("dsh-remove", dsh, [
    "plugin",
    "--profile",
    "voxellume-test",
    "remove",
    "voxellume",
    "--ignore-scripts",
  ]);
  console.log(
    "Exact tarball installed, discovered, and removed in isolated OMP and Harness profiles.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
