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
  acquireHeldProjectLock,
  assertHeldProjectLock,
  canonicalProjectKey,
  type ProjectLockCapability,
} from "../../src/core/execution/process/project-lock.ts";
import { acquireProjectLock as acquireTransactionLock } from "../../src/core/spec/transactions/lock.ts";
import {
  TARGET_VERIFICATION_SCHEMA_VERSION,
  type TargetVerification,
} from "../../src/core/targets/target-pack.ts";

const posixOnly = {
  skip: process.platform === "win32" ? "POSIX process fixture" : false,
};

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function project(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-project-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rootProject = join(root, "project");
  await mkdir(rootProject);
  return rootProject;
}

const verification: TargetVerification = {
  schemaVersion: TARGET_VERIFICATION_SCHEMA_VERSION,
  capabilities: { build: true },
  required: ["build"],
  checks: {
    build: {
      argv: ["./gradlew", "--no-daemon", "build"],
      assertions: [],
      artifactGlobs: [],
    },
  },
  testedPlatforms: [{ os: process.platform, arch: process.arch }],
};

async function executableProject(t: TestContext): Promise<{
  projectRoot: string;
  isolationRoot: string;
  marker: string;
}> {
  const projectRoot = await project(t);
  const isolationRoot = join(projectRoot, "..", "isolation");
  await mkdir(isolationRoot);
  const marker = join(projectRoot, "spawned");
  await writeFile(
    join(projectRoot, "gradlew"),
    `#!${process.execPath}\nrequire("node:fs").writeFileSync("spawned", "yes");`,
  );
  await chmod(join(projectRoot, "gradlew"), 0o755);
  return { projectRoot, isolationRoot, marker };
}

function runProcess(
  fixture: { projectRoot: string; isolationRoot: string },
  projectLock?: ProjectLockCapability,
) {
  return runVerificationProcess({
    transactionId: "project-lock-test",
    projectRoot: fixture.projectRoot,
    isolationRoot: fixture.isolationRoot,
    verification,
    capability: "build",
    backend: "host",
    allowHostExecution: true,
    containerRuntime: "node",
    ...(projectLock === undefined ? {} : { projectLock }),
  });
}

test("held locks share canonical aliases and cancel queued acquisitions", async (t) => {
  const projectRoot = await project(t);
  const alias = join(projectRoot, "..", "project-alias");
  await symlink(projectRoot, alias, "dir");
  const canonical = await canonicalProjectKey(alias);
  const first = await acquireHeldProjectLock(projectRoot);
  assert.ok(first);
  assert.equal(first.key, canonical);
  assert.equal(assertHeldProjectLock(first.capability, canonical), true);

  const cancelled = new AbortController();
  const waiting = acquireHeldProjectLock(alias, cancelled.signal);
  cancelled.abort();
  assert.equal(await waiting, null);

  let secondAcquired = false;
  const secondPromise = acquireHeldProjectLock(alias).then((second) => {
    secondAcquired = true;
    return second;
  });
  await delay(20);
  assert.equal(secondAcquired, false);
  first.release();
  assert.equal(assertHeldProjectLock(first.capability, canonical), false);
  const second = await secondPromise;
  assert.ok(second);
  assert.equal(second.key, canonical);
  second.release();
});

test("missing new-project paths use their real parent and basename", async (t) => {
  const projectRoot = await project(t);
  const parent = join(projectRoot, "..");
  const missing = join(parent, "new-project");
  const held = await acquireHeldProjectLock(missing);
  assert.ok(held);
  assert.equal(
    held.key,
    await canonicalProjectKey(join(parent, ".", "new-project")),
  );
  const waiting = acquireHeldProjectLock(missing);
  let acquired = false;
  void waiting.then(() => {
    acquired = true;
  });
  await delay(20);
  assert.equal(acquired, false);
  held.release();
  assert.ok(await waiting);
});

test(
  "transaction and process callers exclude each other through the shared lock",
  posixOnly,
  async (t) => {
    const fixture = await executableProject(t);
    const release = await acquireTransactionLock(fixture.projectRoot);
    const running = runProcess(fixture);
    await delay(50);
    assert.equal(await exists(fixture.marker), false);
    release();
    const result = await running;
    assert.equal(result.status, "passed", result.error?.detail ?? "");
    assert.equal(await exists(fixture.marker), true);
  },
);

test(
  "forged, wrong-root, and released capabilities fail before spawn",
  posixOnly,
  async (t) => {
    const fixture = await executableProject(t);
    const otherRoot = await project(t);
    const wrong = await acquireHeldProjectLock(otherRoot);
    assert.ok(wrong);
    const released = await acquireHeldProjectLock(fixture.projectRoot);
    assert.ok(released);
    released.release();
    const forged = {} as ProjectLockCapability;

    for (const projectLock of [forged, wrong.capability, released.capability]) {
      const result = await runProcess(fixture, projectLock);
      assert.equal(result.status, "unavailable");
      assert.equal(result.error?.code, "project_lock_mismatch");
      assert.equal(result.executed, null);
    }
    assert.equal(await exists(fixture.marker), false);
    wrong.release();
  },
);

test(
  "a validated held capability runs without reacquiring its project lock",
  posixOnly,
  async (t) => {
    const fixture = await executableProject(t);
    const held = await acquireHeldProjectLock(fixture.projectRoot);
    assert.ok(held);
    try {
      const result = await runProcess(fixture, held.capability);
      assert.equal(result.status, "passed", result.error?.detail ?? "");
      assert.equal(await exists(fixture.marker), true);
    } finally {
      held.release();
    }
  },
);
