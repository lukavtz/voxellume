import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { runVerificationProcess } from "../../src/core/execution/process.ts";
import {
  TARGET_VERIFICATION_SCHEMA_VERSION,
  type TargetCapability,
  type TargetVerification,
} from "../../src/core/targets/target-pack.ts";

interface Fixture {
  root: string;
  projectRoot: string;
  isolationRoot: string;
}

interface RunOptions {
  argv?: readonly string[];
  capability?: TargetCapability;
  signal?: AbortSignal;
  backend?: "host" | "docker";
  allowHostExecution?: boolean;
  lockRoot?: string;
}

const posixOnly = {
  skip: process.platform === "win32" ? "POSIX process-group fixture" : false,
};

function verification(
  argv: readonly string[],
  capability: TargetCapability,
): TargetVerification {
  return {
    schemaVersion: TARGET_VERIFICATION_SCHEMA_VERSION,
    capabilities: { [capability]: true },
    required: [capability],
    checks: {
      [capability]: { argv, assertions: [], artifactGlobs: [] },
    },
    testedPlatforms: [{ os: process.platform, arch: process.arch }],
  };
}

async function setup(t: TestContext, script?: string): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-process-hardening-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project");
  const isolationRoot = join(root, "isolated");
  await mkdir(projectRoot);
  await mkdir(isolationRoot);
  if (script !== undefined) {
    const wrapper = join(projectRoot, "gradlew");
    await writeFile(wrapper, `#!${process.execPath}\n${script}`);
    await chmod(wrapper, 0o755);
  }
  return { root, projectRoot, isolationRoot };
}

function request(fixture: Fixture, options: RunOptions = {}) {
  const capability = options.capability ?? "build";
  const argv = options.argv ?? ["./gradlew", "--no-daemon", "build"];
  return runVerificationProcess({
    transactionId: "tx-process-hardening",
    projectRoot: fixture.projectRoot,
    isolationRoot: fixture.isolationRoot,
    verification: verification(argv, capability),
    capability,
    containerRuntime: "node",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.backend === undefined ? {} : { backend: options.backend }),
    ...(options.allowHostExecution === undefined
      ? {}
      : { allowHostExecution: options.allowHostExecution }),
    ...(options.lockRoot === undefined ? {} : { lockRoot: options.lockRoot }),
  });
}

function runTrustedHost(fixture: Fixture, options: RunOptions = {}) {
  return request(fixture, {
    ...options,
    backend: "host",
    allowHostExecution: true,
  });
}

function errorCode(error: unknown): unknown {
  if (error !== null && typeof error === "object" && "code" in error) {
    return error.code;
  }
  return undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function waitFor(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await exists(path))) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${path}`);
    await delay(10);
  }
}

function killForCleanup(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Expected when the supervisor already reaped the descendant.
  }
}

function assertProcessGone(pid: number): void {
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}

test(
  "host backend fails closed without an explicit trusted-host override",
  posixOnly,
  async (t) => {
    const fixture = await setup(
      t,
      'require("node:fs").writeFileSync("ran", "yes");',
    );
    const marker = join(fixture.projectRoot, "ran");

    for (const backend of [undefined, "host"] as const) {
      const result = await request(fixture, {
        backend: backend ?? "docker",
      });
      assert.equal(result.status, "unavailable");
      assert.equal(result.executed, null);
      assert.equal(result.exitCode, null);
      assert.ok(result.error?.code);
      if (backend === "host") {
        assert.match(result.error?.detail ?? "", /host/i);
      }
      assert.notEqual(result.status, "passed");
      assert.equal(await exists(marker), false);
    }

    const trusted = await runTrustedHost(fixture);
    assert.equal(
      trusted.status,
      "passed",
      trusted.error?.detail ?? "expected trusted host execution to pass",
    );
    assert.equal(await exists(marker), true);
  },
);

for (const [name, exitCode, expectedStatus] of [
  ["passed", 0, "passed"],
  ["failed", 9, "failed"],
] as const) {
  test(
    `${name} wrapper exit cleans up its complete process group with redirected stdio`,
    posixOnly,
    async (t) => {
      const fixture = await setup(
        t,
        `
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const output = fs.openSync("descendant-output.log", "w");
const child = spawn(process.execPath, ["-e", "require('node:net').createServer().listen(0)"], {
  stdio: ["ignore", output, output],
});
fs.closeSync(output);
fs.writeFileSync("descendant-pid", String(child.pid));
process.exit(${exitCode});
`,
      );
      let descendantPid: number | undefined;
      t.after(() => {
        if (descendantPid !== undefined) killForCleanup(descendantPid);
      });

      const result = await runTrustedHost(fixture);
      descendantPid = Number(
        await readFile(join(fixture.projectRoot, "descendant-pid"), "utf8"),
      );
      assert.equal(result.status, expectedStatus);
      assert.equal(result.exitCode, exitCode);
      assertProcessGone(descendantPid);
      if (expectedStatus === "failed") assert.notEqual(result.status, "passed");
    },
  );
}

test(
  "real path and symlink alias share one canonical process lock",
  posixOnly,
  async (t) => {
    const fixture = await setup(
      t,
      `
const fs = require("node:fs");
const watcher = fs.watch(".", (_event, filename) => {
  if (filename === "release") {
    watcher.close();
    process.exit(0);
  }
});
fs.appendFileSync("starts", process.pid + "\\n");
`,
    );
    const release = join(fixture.projectRoot, "release");
    const starts = join(fixture.projectRoot, "starts");
    const alias = join(fixture.root, "project-alias");
    await symlink(fixture.projectRoot, alias, "dir");

    const first = runTrustedHost(fixture);
    await waitFor(starts);
    const controller = new AbortController();
    const second = runTrustedHost(
      { ...fixture, projectRoot: alias },
      { signal: controller.signal },
    );
    controller.abort();
    await writeFile(release, "release\n");
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(firstResult.status, "passed");
    assert.equal(secondResult.status, "cancelled");
    assert.equal((await readFile(starts, "utf8")).trim().split("\n").length, 1);
  },
);

test(
  "trusted lockRoot real path and symlink alias serialize distinct staging roots",
  posixOnly,
  async (t) => {
    const script = `
const fs = require("node:fs");
const watcher = fs.watch(".", (_event, filename) => {
  if (filename === "release") {
    watcher.close();
    process.exit(0);
  }
});
fs.writeFileSync("started", process.pid + "\\n");
`;
    const firstFixture = await setup(t, script);
    const secondFixture = await setup(t, script);
    const lockRoot = join(firstFixture.root, "canonical-project");
    const lockAlias = join(firstFixture.root, "canonical-project-alias");
    await mkdir(lockRoot);
    await symlink(lockRoot, lockAlias, "dir");

    const first = runTrustedHost(firstFixture, { lockRoot });
    await waitFor(join(firstFixture.projectRoot, "started"));
    const second = runTrustedHost(secondFixture, { lockRoot: lockAlias });
    const secondStarted = join(secondFixture.projectRoot, "started");
    const deadline = Date.now() + 1_000;
    let secondStartedBeforeRelease = await exists(secondStarted);
    while (!secondStartedBeforeRelease && Date.now() < deadline) {
      await delay(10);
      secondStartedBeforeRelease = await exists(secondStarted);
    }

    await writeFile(join(firstFixture.projectRoot, "release"), "release\n");
    const firstResult = await first;
    await waitFor(join(secondFixture.projectRoot, "started"));
    await writeFile(join(secondFixture.projectRoot, "release"), "release\n");
    const secondResult = await second;

    assert.equal(firstResult.status, "passed");
    assert.equal(secondResult.status, "passed");
    assert.equal(secondStartedBeforeRelease, false);
  },
);

test(
  "abort cancels a process waiting for the project lock",
  posixOnly,
  async (t) => {
    const fixture = await setup(
      t,
      `
const fs = require("node:fs");
const watcher = fs.watch(".", (_event, filename) => {
  if (filename === "release") {
    watcher.close();
    process.exit(0);
  }
});
fs.appendFileSync("starts", process.pid + "\\n");
`,
    );
    const release = join(fixture.projectRoot, "release");
    const starts = join(fixture.projectRoot, "starts");
    const first = runTrustedHost(fixture);
    await waitFor(starts);

    const controller = new AbortController();
    const second = runTrustedHost(fixture, { signal: controller.signal });
    let settled = false;
    void second.finally(() => {
      settled = true;
    });
    controller.abort();
    await Promise.race([
      second,
      delay(1_000, undefined, { ref: false }).then(() => {
        throw new Error("project lock cancellation did not settle within 1s");
      }),
    ]);
    const settledBeforeRelease = settled;
    await writeFile(release, "release\n");
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(settledBeforeRelease, true);
    assert.equal(firstResult.status, "passed");
    assert.equal(secondResult.status, "cancelled");
    assert.equal(secondResult.executed, null);
    assert.notEqual(secondResult.status, "passed");
    assert.equal((await readFile(starts, "utf8")).trim().split("\n").length, 1);
  },
);

test(
  "spawn ENOENT returns unavailable diagnostics and never a false pass",
  posixOnly,
  async (t) => {
    const fixture = await setup(t);
    const result = await runTrustedHost(fixture);

    assert.equal(result.status, "unavailable");
    assert.equal(result.executed, null);
    assert.equal(result.exitCode, null);
    assert.equal(result.error?.code, "process_spawn_unavailable");
    assert.match(result.error?.detail ?? "", /ENOENT/);
    assert.match(result.error?.detail ?? "", /\.\/gradlew/);
    assert.notEqual(result.status, "passed");
  },
);
