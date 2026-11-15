import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { executeProcess } from "../../src/core/exec/run-process.ts";
import { run } from "../../src/core/tools/run.ts";

const POSIX_STUB = `#!/bin/sh
cd "$(dirname "$0")"
ARGV="$*"
echo "ARGV:$ARGV"
echo "SECRET:\${VOXELLUME_TEST_SECRET:-unset}"
echo "PLAIN:\${VOXELLUME_TEST_PLAIN:-unset}"
LINES=$(cat stub-lines 2>/dev/null || echo 0)
i=0
while [ "$i" -lt "$LINES" ]; do i=$((i + 1)); echo "line $i"; done
echo "READY"
SLEEP=$(cat stub-sleep 2>/dev/null || echo 0)
[ "$SLEEP" != "0" ] && sleep "$SLEEP"
EXIT=$(cat stub-exit 2>/dev/null || echo 0)
exit "$EXIT"
`;

const WINDOWS_STUB = `@echo off
echo ARGV:%*
set SECRET=%VOXELLUME_TEST_SECRET%
if "%SECRET%"=="" (echo SECRET:unset) else (echo SECRET:%SECRET%)
set PLAIN=%VOXELLUME_TEST_PLAIN%
if "%PLAIN%"=="" (echo PLAIN:unset) else (echo PLAIN:%PLAIN%)
set LINES=0
if exist stub-lines set /p LINES=<stub-lines
set /a COUNT=0
:loop
if %COUNT% GEQ %LINES% goto ready
set /a COUNT=%COUNT%+1
echo line %COUNT%
goto loop
:ready
echo READY
set SLEEP=0
if exist stub-sleep set /p SLEEP=<stub-sleep
if not "%SLEEP%"=="0" ping -n %SLEEP% 127.0.0.1 >nul
set EXIT=0
if exist stub-exit set /p EXIT=<stub-exit
exit /b %EXIT%
`;

async function stubProject(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "voxellume-run-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "gradlew"), POSIX_STUB, "utf8");
  await writeFile(join(root, "gradlew.bat"), WINDOWS_STUB, "utf8");
  await chmod(join(root, "gradlew"), 0o755);
  return root;
}

async function configure(
  root: string,
  values: { lines?: number; sleep?: number; exit?: number },
): Promise<void> {
  if (values.lines !== undefined) {
    await writeFile(join(root, "stub-lines"), String(values.lines), "utf8");
  }
  if (values.sleep !== undefined) {
    await writeFile(join(root, "stub-sleep"), String(values.sleep), "utf8");
  }
  if (values.exit !== undefined) {
    await writeFile(join(root, "stub-exit"), String(values.exit), "utf8");
  }
}

test("run executes an allowlisted build and reports the observed exit code", async (t) => {
  const root = await stubProject(t);
  const result = await run({ projectRoot: root, task: "build" }, { cwd: root });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.status, "exited");
  assert.equal(result.value.exitCode, 0);
  assert.deepEqual(
    [...result.value.argv],
    [
      process.platform === "win32" ? "gradlew.bat" : "./gradlew",
      "--no-daemon",
      "--console=plain",
      "build",
    ],
  );
  assert.ok(result.value.tail.some((line) => line.includes("READY")));
  assert.ok(result.value.tail.some((line) => line.includes("ARGV:")));
  const log = await readFile(join(root, result.value.logPath), "utf8");
  assert.ok(log.includes("READY"));
  const terminator = process.platform === "win32" ? "\r\n" : "\n";
  assert.ok(
    log.includes(`READY${terminator}`),
    `log must keep the child's line ending ${JSON.stringify(terminator)}: ${JSON.stringify(log.slice(-64))}`,
  );
});

test("run reports a non-zero exit code", async (t) => {
  const root = await stubProject(t);
  await configure(root, { exit: 7 });
  const result = await run({ projectRoot: root, task: "build" }, { cwd: root });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.exitCode, 7);
});

test("run keeps only the last 200 log lines in the tail", async (t) => {
  const root = await stubProject(t);
  await configure(root, { lines: 2000 });
  const result = await run({ projectRoot: root, task: "build" }, { cwd: root });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.tail.length, 200);
  assert.ok(result.value.tail.at(-1)?.includes("READY"));
});

test("run stops the process tree when the stop pattern appears", async (t) => {
  const root = await stubProject(t);
  await configure(root, { sleep: 30 });
  const started = Date.now();
  const result = await run(
    { projectRoot: root, task: "runServer", stopOnLog: "READY" },
    { cwd: root },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.status, "stopped_by_log");
  assert.ok(Date.now() - started < 20_000);
});

test("run enforces the timeout", async (t) => {
  const root = await stubProject(t);
  await configure(root, { sleep: 30 });
  const started = Date.now();
  const result = await run(
    { projectRoot: root, task: "build", timeoutSeconds: 1 },
    { cwd: root },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.status, "timed_out");
  assert.ok(Date.now() - started < 15_000);
});

test("run cancels on abort", async (t) => {
  const root = await stubProject(t);
  await configure(root, { sleep: 30 });
  const controller = new AbortController();
  // Real timer on purpose: the abort must land while the child process is alive.
  setTimeout(() => controller.abort(), 300);
  const result = await run(
    { projectRoot: root, task: "build" },
    { cwd: root, signal: controller.signal },
  );
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.status, "cancelled");
  assert.equal(result.value.exitCode, null);
});

test("run rejects arguments outside the allowlist", async (t) => {
  const root = await stubProject(t);
  const result = await run(
    {
      projectRoot: root,
      task: "build",
      extraArgs: ["--init-script", "evil.gradle"],
    },
    { cwd: root },
  );
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "unsafe_argument");
});

test("run rejects tasks outside the allowlist", async (t) => {
  const root = await stubProject(t);
  const result = await run(
    { projectRoot: root, task: "publish" as never },
    { cwd: root },
  );
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "task_not_allowed");
});

test("run rejects a project root outside the working directory", async (t) => {
  const root = await stubProject(t);
  const result = await run(
    { projectRoot: join(root, ".."), task: "build" },
    { cwd: root },
  );
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "destination_outside_root");
});

test("run rejects a directory without a Gradle wrapper", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "voxellume-bare-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const result = await run({ projectRoot: root, task: "build" }, { cwd: root });
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "project_not_found");
});

test("run rejects an invalid stop pattern", async (t) => {
  const root = await stubProject(t);
  const result = await run(
    { projectRoot: root, task: "build", stopOnLog: "(" },
    { cwd: root },
  );
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "invalid_request");
});

test("run drops variables outside the environment allowlist", async (t) => {
  const root = await stubProject(t);
  const previous = process.env.VOXELLUME_TEST_SECRET;
  const previousPlain = process.env.VOXELLUME_TEST_PLAIN;
  process.env.VOXELLUME_TEST_SECRET = "leak";
  process.env.VOXELLUME_TEST_PLAIN = "leak-plain";
  t.after(() => {
    for (const [key, value] of [
      ["VOXELLUME_TEST_SECRET", previous],
      ["VOXELLUME_TEST_PLAIN", previousPlain],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const result = await run({ projectRoot: root, task: "build" }, { cwd: root });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  const tail = result.value.tail.join("\n");
  assert.ok(tail.includes("SECRET:unset"), tail);
  assert.ok(tail.includes("PLAIN:unset"), tail);
  assert.equal(JSON.stringify(result).includes("leak"), false);
});

test(
  "run rejects a win32 wrapper path that cmd.exe would re-parse",
  { skip: process.platform !== "win32" && "win32 only" },
  async (t) => {
    const root = await stubProject(t);
    const project = join(root, "mod&calc");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "gradlew.bat"), WINDOWS_STUB, "utf8");
    const result = await run(
      { projectRoot: project, task: "build" },
      { cwd: root },
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.error.code, "unsafe_argument");
  },
);

test("run reports spawn_failed when the log directory cannot be created", async (t) => {
  const root = await stubProject(t);
  await writeFile(join(root, ".voxellume"), "not a directory", "utf8");
  const result = await run({ projectRoot: root, task: "build" }, { cwd: root });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.value.status, "spawn_failed");
});

test("run reports internal_error for a throw it cannot classify", async (t) => {
  const root = await stubProject(t);
  // A missing projectRoot string throws a TypeError inside path resolution:
  // no coded error applies, so the envelope must carry internal_error.
  const result = await run({ task: "build" } as never, { cwd: root });
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "internal_error");
  assert.notEqual(result.error.code, "spawn_failed");
  assert.ok(result.error.detail.length > 0);
  assert.equal(result.error.detail.includes("\n"), false);
});

test("executeProcess stops reading at the output cap", async (t) => {
  const root = await stubProject(t);
  await configure(root, { lines: 5000 });
  const outcome = await executeProcess({
    file: join(root, process.platform === "win32" ? "gradlew.bat" : "gradlew"),
    args: [],
    cwd: root,
    timeoutMs: 60_000,
    maxOutputBytes: 4096,
    logPath: join(root, "cap.log"),
    env: process.env,
    ...(process.platform === "win32"
      ? { windowsCommandPrefix: ["cmd.exe", "/d", "/c"] }
      : {}),
  });
  assert.equal(outcome.status, "output_limit_reached");
  assert.ok(outcome.tail.length > 0);
});
