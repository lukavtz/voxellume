import { join, basename } from "node:path";
import { stat } from "node:fs/promises";

import { executeProcess } from "../exec/run-process.ts";
import { PathEscapeError, resolveInsideRoot } from "../fs-guard.ts";
import { fail, ok, type ToolResult } from "../results.ts";

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

export const EXTRA_ARG_ALLOWLIST = ["--offline", "--info", "--stacktrace"] as const;

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
const SECRET_KEY = /TOKEN|SECRET|PASSWORD|CREDENTIAL/i;

class RunError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(detail);
    this.name = "RunError";
    this.code = code;
  }
}

function isTaskId(value: unknown): value is TaskId {
  return typeof value === "string" && Object.hasOwn(TASK_ARGS, value);
}

function validateExtraArgs(extraArgs: readonly string[] | undefined): readonly string[] {
  if (extraArgs === undefined) return [];
  if (!Array.isArray(extraArgs)) {
    throw new RunError("invalid_request", "extraArgs must be an array");
  }
  for (const argument of extraArgs) {
    if (!(EXTRA_ARG_ALLOWLIST as readonly string[]).includes(argument)) {
      throw new RunError("unsafe_argument", String(argument));
    }
  }
  return extraArgs;
}

function resolveTimeout(seconds: number | undefined): number {
  if (seconds === undefined) return DEFAULT_TIMEOUT_SECONDS;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_TIMEOUT_SECONDS) {
    throw new RunError(
      "invalid_request",
      `timeoutSeconds must be an integer between 1 and ${MAX_TIMEOUT_SECONDS}`,
    );
  }
  return seconds;
}

function compileStopPattern(source: string | undefined): RegExp | undefined {
  if (source === undefined) return undefined;
  if (typeof source !== "string" || source.length > 200) {
    throw new RunError("invalid_request", "stopOnLog must be a string of at most 200 characters");
  }
  try {
    return new RegExp(source);
  } catch (error) {
    throw new RunError("invalid_request", `stopOnLog is not a regular expression: ${String(error)}`);
  }
}

function scrubEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (!SECRET_KEY.test(key)) env[key] = value;
  }
  return env;
}

async function resolveProjectRoot(root: string, projectRoot: string): Promise<string> {
  const resolved = await resolveInsideRoot(root, projectRoot);
  const info = await stat(resolved).catch(() => {
    throw new RunError("project_not_found", `${projectRoot} does not exist`);
  });
  if (!info.isDirectory()) {
    throw new RunError("project_not_found", `${projectRoot} is not a directory`);
  }
  return resolved;
}

async function wrapperFor(root: string): Promise<{ readonly file: string; readonly name: string }> {
  const name = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const candidate = join(root, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  try {
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    throw new RunError("project_not_found", `${basename(candidate)} is absent in ${root}`);
  }
  return { file: candidate, name };
}

function logStamp(): string {
  return new Date().toISOString().replace(/:/g, "-");
}

export async function run(
  request: RunRequest,
  options: { readonly cwd: string; readonly signal?: AbortSignal },
): Promise<ToolResult<RunResult>> {
  try {
    if (!isTaskId(request.task)) {
      throw new RunError("task_not_allowed", String(request.task));
    }
    const extraArgs = validateExtraArgs(request.extraArgs);
    const timeoutMs = resolveTimeout(request.timeoutSeconds) * 1000;
    const stopPattern = compileStopPattern(request.stopOnLog);

    const projectRoot = await resolveProjectRoot(options.cwd, request.projectRoot);
    const wrapper = await wrapperFor(projectRoot);

    const logicalArgv = [
      wrapper.name,
      "--no-daemon",
      "--console=plain",
      ...TASK_ARGS[request.task],
      ...extraArgs,
    ];

    const relativeLog = join(".voxellume", "logs", `${request.task}-${logStamp()}.log`);
    const outcome = await executeProcess({
      file: wrapper.file,
      args: logicalArgv.slice(1),
      cwd: projectRoot,
      env: scrubEnvironment(process.env),
      timeoutMs,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      logPath: join(projectRoot, relativeLog),
      ...(stopPattern === undefined ? {} : { stopPattern }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(process.platform === "win32" ? { windowsCommandPrefix: ["cmd.exe", "/d", "/c"] } : {}),
    });

    return ok({
      task: request.task,
      argv: logicalArgv,
      status: outcome.status,
      exitCode: outcome.exitCode,
      durationMs: outcome.durationMs,
      logPath: relativeLog.split("\\").join("/"),
      tail: outcome.tail,
    });
  } catch (error) {
    if (error instanceof RunError || error instanceof PathEscapeError) {
      return fail(error.code, error.message);
    }
    throw error;
  }
}
