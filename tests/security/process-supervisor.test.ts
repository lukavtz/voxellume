import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { setTimeout as delay } from "node:timers/promises";

import { runDockerVerification } from "../../src/core/execution/docker.ts";
import {
  PROCESS_LIMITS,
  runVerificationProcess,
} from "../../src/core/execution/process.ts";
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

function verification(
  argv: readonly string[],
  capability: TargetCapability = "build",
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

async function setup(t: TestContext, script: string): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-process-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project with spaces");
  const isolationRoot = join(root, "isolated");
  await mkdir(projectRoot);
  await mkdir(isolationRoot);
  if (process.platform === "win32") {
    await writeFile(join(projectRoot, "gradlew-fixture.cjs"), script);
    await writeFile(
      join(projectRoot, "gradlew.bat"),
      `@"${process.execPath}" "%~dp0gradlew-fixture.cjs" %*\r\n`,
    );
  } else {
    const wrapper = join(projectRoot, "gradlew");
    await writeFile(wrapper, `#!${process.execPath}\n${script}`);
    await chmod(wrapper, 0o755);
  }
  return { root, projectRoot, isolationRoot };
}

function run(
  fixture: Fixture,
  options: {
    argv?: readonly string[];
    capability?: TargetCapability;
    signal?: AbortSignal;
    javaHome?: string;
  } = {},
) {
  const capability = options.capability ?? "build";
  return runVerificationProcess({
    transactionId: "tx-process-1",
    projectRoot: fixture.projectRoot,
    isolationRoot: fixture.isolationRoot,
    verification: verification(
      options.argv ?? ["./gradlew", "--no-daemon", "build"],
      capability,
    ),
    capability,
    backend: "host",
    containerRuntime: "node",
    allowHostExecution: true,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.javaHome === undefined ? {} : { javaHome: options.javaHome }),
  });
}

function errorCode(error: unknown): unknown {
  if (error !== null && typeof error === "object" && "code" in error) {
    return error.code;
  }
  return undefined;
}

async function rejectsCode(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.equal(errorCode(error), code);
    return true;
  });
}

function exists(path: string): boolean {
  return existsSync(path);
}

async function waitFor(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await exists(path))) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${path}`);
    await delay(10);
  }
}

test("spawn uses fixed argv with shell:false and an isolated, scrubbed environment", async (t) => {
  const script = `
console.log("argv=" + JSON.stringify(process.argv.slice(2)));
console.log("cwd=" + process.cwd());
for (const key of ["HOME", "GRADLE_USER_HOME", "TMPDIR", "SSH_AUTH_SOCK", "GITHUB_TOKEN", "NPM_TOKEN"])
  console.log(key + "=" + (process.env[key] ?? "<unset>"));
`;
  const fixture = await setup(t, script);
  const secrets = {
    SSH_AUTH_SOCK: "/private/agent.sock",
    GITHUB_TOKEN: "github-secret",
    NPM_TOKEN: "npm-secret",
  };
  const inherited = Object.fromEntries(
    Object.keys(secrets).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, secrets);
  t.after(() => {
    for (const [key, value] of Object.entries(inherited)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const childCwd = await realpath(fixture.projectRoot);
  const result = await run(fixture);
  assert.equal(
    result.status,
    "passed",
    result.error?.detail ?? "expected passed",
  );
  assert.equal(result.exitCode, 0);
  const executed = result.executed;
  assert.ok(executed);
  assert.equal(executed.cwd, fixture.projectRoot);
  assert.deepEqual(executed, {
    argv: ["./gradlew", "--no-daemon", "build"],
    cwd: fixture.projectRoot,
    shell: false,
  });
  const lines = Object.fromEntries(
    result.stdout
      .trim()
      .split("\n")
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  assert.equal(lines.argv, JSON.stringify(["--no-daemon", "build"]));
  assert.equal(await realpath(lines.cwd!), childCwd);
  assert.equal(lines.HOME, join(fixture.isolationRoot, "home"));
  assert.equal(
    lines.GRADLE_USER_HOME,
    join(fixture.isolationRoot, "gradle-user-home"),
  );
  assert.equal(lines.TMPDIR, join(fixture.isolationRoot, "tmp"));
  assert.equal(lines.SSH_AUTH_SOCK, "<unset>");
  assert.equal(lines.GITHUB_TOKEN, "<unset>");
  assert.equal(lines.NPM_TOKEN, "<unset>");
});

test("trusted javaHome overrides inherited JAVA_HOME only", async (t) => {
  const fixture = await setup(
    t,
    'console.log("JAVA_HOME=" + process.env.JAVA_HOME); console.log("GITHUB_TOKEN=" + (process.env.GITHUB_TOKEN ?? "<unset>"));',
  );
  const inherited = {
    JAVA_HOME: process.env.JAVA_HOME,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  };
  process.env.JAVA_HOME = "/untrusted/inherited-jdk";
  process.env.GITHUB_TOKEN = "must-not-leak";
  t.after(() => {
    for (const [key, value] of Object.entries(inherited)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const javaHome = join(fixture.root, "trusted JDK 25");

  const result = await run(fixture, { javaHome });

  assert.equal(
    result.status,
    "passed",
    result.error?.detail ?? "expected passed",
  );
  assert.ok(result.stdout.includes(`JAVA_HOME=${javaHome}`));
  assert.doesNotMatch(result.stdout, /untrusted\/inherited-jdk/);
  assert.match(result.stdout, /GITHUB_TOKEN=<unset>/);
});

test("process accepts exact clean build task sequence", async (t) => {
  const fixture = await setup(
    t,
    "console.log(JSON.stringify(process.argv.slice(2)));",
  );

  const result = await run(fixture, {
    argv: ["./gradlew", "--no-daemon", "clean", "build"],
  });

  assert.equal(
    result.status,
    "passed",
    result.error?.detail ?? "expected passed",
  );
  assert.deepEqual(result.executed?.argv, [
    "./gradlew",
    "--no-daemon",
    "clean",
    "build",
  ]);
  assert.equal(
    result.stdout.trim(),
    JSON.stringify(["--no-daemon", "clean", "build"]),
  );
});

test("process revalidates executable and task allowlists before any mutation", async (t) => {
  const fixture = await setup(
    t,
    'require("node:fs").writeFileSync("ran", "yes");',
  );
  const marker = join(fixture.projectRoot, "ran");
  const cases = [
    ["shell executable", ["/bin/sh", "-c", "touch ran"]],
    ["unknown task", ["./gradlew", "--no-daemon", "publish"]],
    ["shell task", ["./gradlew", "--no-daemon", "build; touch ran"]],
    ["empty task list", ["./gradlew", "--no-daemon"]],
    ["unknown extra task", ["./gradlew", "--no-daemon", "clean", "publish"]],
    ["extra flag", ["./gradlew", "--no-daemon", "build", "--stacktrace"]],
    ["flag before task", ["./gradlew", "--no-daemon", "--info", "build"]],
    ["extra argv", ["./gradlew", "build", ";", "touch ran"]],
  ] as const;
  for (const [name, argv] of cases) {
    await t.test(name, async () => {
      await rejectsCode(run(fixture, { argv }), "command_not_allowed");
      assert.equal(await exists(marker), false);
    });
  }
});

test("Docker applies the same variable task-sequence allowlist", async (t) => {
  const fixture = await setup(t, "");
  const request = (argv: readonly string[]) =>
    runDockerVerification({
      transactionId: "tx-docker-argv",
      projectRoot: join(fixture.root, "missing-project"),
      isolationRoot: fixture.isolationRoot,
      verification: verification(argv),
      capability: "build",
    });

  for (const argv of [
    ["./gradlew", "--no-daemon", "build"],
    ["./gradlew", "--no-daemon", "clean", "build"],
  ] as const) {
    const result = await request(argv);
    assert.equal(result.status, "unavailable");
    assert.equal(result.error?.code, "backend_unavailable");
  }

  for (const argv of [
    ["./gradlew", "--no-daemon"],
    ["./gradlew", "--no-daemon", "clean", "publish"],
    ["./gradlew", "--no-daemon", "clean", "build", "--stacktrace"],
  ] as const) {
    await assert.rejects(request(argv), { message: "command_not_allowed" });
  }
});

test("nonzero execution is failed, never passed", async (t) => {
  const fixture = await setup(
    t,
    'process.stderr.write("boom\\n"); process.exit(7);',
  );
  const result = await run(fixture);
  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, 7);
  assert.match(result.stderr, /boom/);
  assert.notEqual(result.status, "passed");
});

test("one Gradle process per project serializes concurrent checks", async (t) => {
  const fixture = await setup(
    t,
    `
const fs = require("node:fs");
fs.appendFileSync("starts", process.pid + "\\n");
// Real child timers exercise the supervisor's actual cross-process lock.
const timer = setInterval(() => {
  if (fs.existsSync("release")) {
    clearInterval(timer);
    fs.appendFileSync("finishes", process.pid + "\\n");
    process.exit(0);
  }
}, 10);
`,
  );
  const release = join(fixture.projectRoot, "release");
  const starts = join(fixture.projectRoot, "starts");
  const first = run(fixture);
  await waitFor(starts);
  const second = run(fixture);
  await yieldToEventLoop();
  assert.equal(readFileSync(starts, "utf8").trim().split("\n").length, 1);
  writeFileSync(release, "release\n");
  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["passed", "passed"],
  );
  assert.equal((await readFile(starts, "utf8")).trim().split("\n").length, 2);
});

test("enforces the approved time, output, evidence, and container limits", () => {
  assert.deepEqual(PROCESS_LIMITS, {
    buildTimeoutMs: 15 * 60 * 1000,
    runtimeTimeoutMs: 10 * 60 * 1000,
    outputBytes: 16 * 1024 * 1024,
    evidenceBytes: 2 * 1024 ** 3,
    gradlePerProject: 1,
    containerCpus: 2,
    containerMemoryBytes: 4 * 1024 ** 3,
    containerPids: 512,
  });
});

test("output overflow fails closed with bounded captured output", async (t) => {
  const fixture = await setup(
    t,
    'process.stdout.write("x".repeat(16 * 1024 * 1024 + 1));',
  );
  const result = await run(fixture);
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "output_limit_exceeded");
  assert.ok(Buffer.byteLength(result.stdout) <= PROCESS_LIMITS.outputBytes);
  assert.notEqual(result.status, "passed");
});

test("runtime timeout kills execution and returns timed_out, never passed", async (t) => {
  const fixture = await setup(
    t,
    'require("node:fs").writeFileSync("ready", "yes"); setInterval(() => {}, 1000);',
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = run(fixture, {
    capability: "server",
    argv: ["./gradlew", "--no-daemon", "runServer"],
  });
  const ready = join(fixture.projectRoot, "ready");
  const deadline = Date.now() + 5_000;
  while (!(await exists(ready))) {
    assert.ok(Date.now() < deadline, "server did not start");
    await yieldToEventLoop();
  }
  t.mock.timers.tick(PROCESS_LIMITS.runtimeTimeoutMs);
  const result = await pending;
  assert.equal(result.status, "timed_out");
  assert.equal(result.exitCode, null);
  assert.notEqual(result.status, "passed");
});

test("cancellation before spawn starts nothing", async (t) => {
  const fixture = await setup(
    t,
    'require("node:fs").writeFileSync("ran", "yes");',
  );
  const controller = new AbortController();
  controller.abort();
  const result = await run(fixture, { signal: controller.signal });
  assert.equal(result.status, "cancelled");
  assert.equal(await exists(join(fixture.projectRoot, "ran")), false);
  assert.notEqual(result.status, "passed");
});

test("cancellation kills the complete process group and waits for descendants", async (t) => {
  const fixture = await setup(
    t,
    `
const fs = require("node:fs");
const child = require("node:child_process").spawn(process.execPath, ["-e",
  "setInterval(() => {}, 1000)"
], { stdio: "ignore" });
fs.writeFileSync("child-pid", String(child.pid));
fs.writeFileSync("ready", "yes");
setInterval(() => {}, 1000);
`,
  );
  const pidPath = join(fixture.projectRoot, "child-pid");
  const controller = new AbortController();
  const pending = run(fixture, { signal: controller.signal });
  await waitFor(pidPath);
  const childPid = Number(await readFile(pidPath, "utf8"));
  t.after(() => {
    try {
      process.kill(childPid, "SIGKILL");
    } catch {
      // Expected when the supervisor reaped the descendant.
    }
  });
  controller.abort();
  const result = await pending;
  assert.equal(result.status, "cancelled");
  assert.equal(result.exitCode, null);
  assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });
  assert.notEqual(result.status, "passed");
});
