import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runProcess } from "./harness.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const omp = join(repositoryRoot, "node_modules", ".bin", "omp");
const dsh = join(repositoryRoot, "node_modules", ".bin", "dsh");

function diagnostic(result: {
  stdout: string;
  stderr: string;
  code: number | null;
}): string {
  return JSON.stringify({
    code: result.code,
    stdout: result.stdout.slice(-1000),
    stderr: result.stderr.slice(-1000),
  });
}

test("real OMP CLI availability is recorded without replacing it with a mock", async (t) => {
  const result = await runProcess(omp, ["--version"], {
    cwd: repositoryRoot,
    env: { ...process.env, DSH_TELEMETRY_MODE: "DISABLED" },
    timeoutMs: 15_000,
  });
  if (result.code !== 0) {
    t.skip(`OMP CLI unavailable: ${diagnostic(result)}`);
    return;
  }
  assert.ok(result.stdout.trim().length > 0, diagnostic(result));
});

test(
  "real DSH CLI installs the exact tarball and composes a fresh profile",
  { timeout: 240_000 },
  async (t) => {
    const version = await runProcess(dsh, ["--version"], {
      cwd: repositoryRoot,
      env: { ...process.env, DSH_TELEMETRY_MODE: "DISABLED" },
      timeoutMs: 15_000,
    });
    if (version.code !== 0) {
      t.skip(`DSH CLI unavailable: ${diagnostic(version)}`);
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "voxellume-e2e-dsh-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const env = {
      ...process.env,
      CI: "1",
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      DSH_HOME: join(root, "dsh-home"),
      DSH_TELEMETRY_MODE: "DISABLED",
    };

    const packed = await runProcess(
      "corepack",
      ["pnpm", "pack", "--pack-destination", root],
      { cwd: repositoryRoot, env, timeoutMs: 120_000 },
    );
    assert.equal(packed.code, 0, diagnostic(packed));
    const tarballs = (await readdir(root)).filter((name) =>
      name.endsWith(".tgz"),
    );
    assert.equal(tarballs.length, 1);
    const tarball = join(root, tarballs[0]!);

    const profile = "voxellume-e2e";
    const installed = await runProcess(
      dsh,
      ["plugin", "--profile", profile, "add", tarball, "--offline"],
      { cwd: repositoryRoot, env, timeoutMs: 120_000 },
    );
    assert.equal(installed.code, 0, diagnostic(installed));

    const profilePackage = JSON.parse(
      await readFile(
        join(root, "dsh-home", "profiles", profile, "package.json"),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string> };
    assert.ok(profilePackage.dependencies?.voxellume);

    const dumped = await runProcess(
      dsh,
      ["--profile", profile, "--dump-config"],
      { cwd: repositoryRoot, env, timeoutMs: 60_000 },
    );
    assert.equal(dumped.code, 0, diagnostic(dumped));
    assert.match(dumped.stdout, /voxellume/);
  },
);
