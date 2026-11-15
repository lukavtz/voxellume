import { join, basename, relative } from "node:path";
import { stat } from "node:fs/promises";

import { executeProcess, type ProcessInvocation } from "../exec/run-process.ts";
import { CodedError, failureOf } from "../errors.ts";
import { resolveInsideRoot } from "../fs-guard.ts";
import { ok, type ToolResult } from "../results.ts";

export const TASK_IDS = [
  "build",
  "clean",
  "test",
  "runServer",
  "runClient",
  "runGametest",
  "genSources",
] as const;

export type TaskId = (typeof TASK_IDS)[number];

export const TASK_ARGS = {
  build: ["build"],
  clean: ["clean"],
  test: ["test"],
  runServer: ["runServer"],
  runClient: ["runClient"],
  runGametest: ["runGametest"],
  genSources: ["genSources"],
} as const satisfies Record<TaskId, readonly string[]>;

export const EXTRA_ARG_ALLOWLIST = [
  "--offline",
  "--info",
  "--stacktrace",
] as const;

export type RunStatus =
  | "exited"
  | "stopped_by_log"
  | "timed_out"
  | "cancelled"
  | "output_limit_reached"
  | "spawn_failed";

export interface RunRequest {
  readonly projectRoot: string;
  readonly task: TaskId;
  readonly extraArgs?: readonly string[];
  readonly timeoutSeconds?: number;
  readonly stopOnLog?: string;
}

export interface RunResult {
  readonly task: TaskId;
  readonly argv: readonly string[];
  readonly status: RunStatus;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly logPath: string;
  readonly tail: readonly string[];
}

const DEFAULT_TIMEOUT_SECONDS = 900;
const MAX_TIMEOUT_SECONDS = 3600;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const CMD_UNSAFE = /[&|<>^%!"]/;
const ENV_ALLOWLIST = new Set(
  [
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "windir",
    "ComSpec",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "USERNAME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TZ",
    "JAVA_HOME",
    "GRADLE_USER_HOME",
    "GRADLE_OPTS",
    "JAVA_TOOL_OPTIONS",
    "_JAVA_OPTIONS",
    "PROCESSOR_ARCHITECTURE",
    "NUMBER_OF_PROCESSORS",
    "OS",
  ].map((key) => key.toLowerCase()),
);

function isTaskId(value: unknown): value is TaskId {
  return typeof value === "string" && Object.hasOwn(TASK_ARGS, value);
}

function validateExtraArgs(
  extraArgs: readonly string[] | undefined,
): readonly string[] {
  if (extraArgs === undefined) return [];
  if (!Array.isArray(extraArgs)) {
    throw new CodedError("invalid_request", "extraArgs must be an array");
  }
  for (const argument of extraArgs) {
    if (!(EXTRA_ARG_ALLOWLIST as readonly string[]).includes(argument)) {
      throw new CodedError("unsafe_argument", String(argument));
    }
  }
  return extraArgs;
}

function resolveTimeout(seconds: number | undefined): number {
  if (seconds === undefined) return DEFAULT_TIMEOUT_SECONDS;
  if (
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    seconds > MAX_TIMEOUT_SECONDS
  ) {
    throw new CodedError(
      "invalid_request",
      `timeoutSeconds must be an integer between 1 and ${MAX_TIMEOUT_SECONDS}`,
    );
  }
  return seconds;
}

function compileStopPattern(source: string | undefined): RegExp | undefined {
  if (source === undefined) return undefined;
  if (typeof source !== "string" || source.length > 200) {
    throw new CodedError(
      "invalid_request",
      "stopOnLog must be a string of at most 200 characters",
    );
  }
  try {
    return new RegExp(source);
  } catch (error) {
    throw new CodedError(
      "invalid_request",
      `stopOnLog is not a regular expression: ${String(error)}`,
    );
  }
}

function scrubEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    const lower = key.toLowerCase();
    if (ENV_ALLOWLIST.has(lower) || lower.startsWith("xdg_")) env[key] = value;
  }
  return env;
}

async function resolveProjectRoot(
  root: string,
  projectRoot: string,
): Promise<string> {
  const resolved = await resolveInsideRoot(root, projectRoot);
  const info = await stat(resolved).catch(() => {
    throw new CodedError("project_not_found", `${projectRoot} does not exist`);
  });
  if (!info.isDirectory()) {
    throw new CodedError(
      "project_not_found",
      `${projectRoot} is not a directory`,
    );
  }
  return resolved;
}

async function wrapperFor(
  root: string,
): Promise<{ readonly file: string; readonly name: string }> {
  const name = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const candidate = join(
    root,
    process.platform === "win32" ? "gradlew.bat" : "gradlew",
  );
  try {
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    throw new CodedError(
      "project_not_found",
      `${basename(candidate)} is absent in ${root}`,
    );
  }
  return { file: candidate, name };
}

function logStamp(): string {
  return new Date().toISOString().replace(/:/g, "-");
}

interface RunPlan {
  readonly task: TaskId;
  readonly projectRoot: string;
  readonly wrapper: { readonly file: string; readonly name: string };
  readonly extraArgs: readonly string[];
  readonly timeoutMs: number;
  readonly stopPattern: RegExp | undefined;
}

/** Validate the request and the project layout before anything is spawned. */
async function planRun(
  request: RunRequest,
  options: { readonly cwd: string },
): Promise<RunPlan> {
  if (!isTaskId(request.task)) {
    throw new CodedError("task_not_allowed", String(request.task));
  }
  const extraArgs = validateExtraArgs(request.extraArgs);
  const timeoutMs = resolveTimeout(request.timeoutSeconds) * 1000;
  const stopPattern = compileStopPattern(request.stopOnLog);
  const projectRoot = await resolveProjectRoot(
    options.cwd,
    request.projectRoot,
  );
  const wrapper = await wrapperFor(projectRoot);
  if (process.platform === "win32" && CMD_UNSAFE.test(wrapper.file)) {
    throw new CodedError(
      "unsafe_argument",
      relative(options.cwd, wrapper.file).split("\\").join("/"),
    );
  }
  return {
    task: request.task,
    projectRoot,
    wrapper,
    extraArgs,
    timeoutMs,
    stopPattern,
  };
}

function invocationFor(
  plan: RunPlan,
  argv: readonly string[],
  relativeLog: string,
  signal: AbortSignal | undefined,
): ProcessInvocation {
  return {
    file: plan.wrapper.file,
    args: argv.slice(1),
    cwd: plan.projectRoot,
    env: scrubEnvironment(process.env),
    timeoutMs: plan.timeoutMs,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    logPath: join(plan.projectRoot, relativeLog),
    ...(plan.stopPattern === undefined
      ? {}
      : { stopPattern: plan.stopPattern }),
    ...(signal === undefined ? {} : { signal }),
    ...(process.platform === "win32"
      ? { windowsCommandPrefix: ["cmd.exe", "/d", "/c"] }
      : {}),
  };
}

export async function run(
  request: RunRequest,
  options: { readonly cwd: string; readonly signal?: AbortSignal },
): Promise<ToolResult<RunResult>> {
  try {
    const plan = await planRun(request, options);
    const argv = [
      plan.wrapper.name,
      "--no-daemon",
      "--console=plain",
      ...TASK_ARGS[plan.task],
      ...plan.extraArgs,
    ];
    const relativeLog = join(
      ".voxellume",
      "logs",
      `${plan.task}-${logStamp()}.log`,
    );
    const outcome = await executeProcess(
      invocationFor(plan, argv, relativeLog, options.signal),
    );
    return ok({
      task: plan.task,
      argv,
      status: outcome.status,
      exitCode: outcome.exitCode,
      durationMs: outcome.durationMs,
      logPath: relativeLog.split("\\").join("/"),
      tail: outcome.tail,
    });
  } catch (error) {
    return failureOf(error);
  }
}
