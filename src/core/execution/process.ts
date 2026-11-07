import { mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import { runDockerVerification } from "./docker.ts";
import { executePosixProcess } from "./process/posix.ts";
import {
  acquireHeldProjectLock,
  assertHeldProjectLock,
  canonicalProjectKey,
  type ProjectLockCapability,
  type ProjectLockRelease,
} from "./process/project-lock.ts";
import { executeWindowsProcess } from "./process-win32.ts";
import {
  ALLOWED_GRADLE_TASKS,
  type TargetCapability,
  type TargetVerification,
} from "../targets/target-pack.ts";

export const PROCESS_LIMITS = Object.freeze({
  buildTimeoutMs: 15 * 60 * 1000,
  runtimeTimeoutMs: 10 * 60 * 1000,
  outputBytes: 16 * 1024 * 1024,
  evidenceBytes: 2 * 1024 ** 3,
  gradlePerProject: 1,
  containerCpus: 2,
  containerMemoryBytes: 4 * 1024 ** 3,
  containerPids: 512,
});

export type VerificationProcessStatus =
  "passed" | "failed" | "timed_out" | "cancelled" | "unavailable";

export interface VerificationProcessResult {
  readonly transactionId: string;
  readonly capability: TargetCapability;
  readonly requested: readonly string[];
  readonly executed: {
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly shell: false;
  } | null;
  readonly status: VerificationProcessStatus;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: {
    readonly code: string;
    readonly detail: string;
  };
}

export interface RunVerificationProcessOptions {
  readonly transactionId: string;
  readonly projectRoot: string;
  readonly isolationRoot: string;
  readonly verification: TargetVerification;
  readonly capability: TargetCapability;
  readonly signal?: AbortSignal;
  readonly backend?: "host" | "docker";
  readonly containerRuntime?: "jdk21" | "jdk25" | "node";
  readonly allowHostExecution?: boolean;
  readonly javaHome?: string;
  readonly lockRoot?: string;
  readonly projectLock?: ProjectLockCapability;
}

const allowedTasks = new Set<string>(ALLOWED_GRADLE_TASKS);
const inheritedEnvironmentKeys = [
  "PATH",
  "JAVA_HOME",
  "JDK_HOME",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
] as const;

class ProcessError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ProcessError";
    this.code = code;
  }
}

function validateArgv(argv: readonly string[]): void {
  if (
    argv.length < 3 ||
    argv[0] !== "./gradlew" ||
    argv[1] !== "--no-daemon" ||
    argv.slice(2).some((task) => !allowedTasks.has(task))
  ) {
    throw new ProcessError("command_not_allowed");
  }
}

function isolatedEnvironment(
  isolationRoot: string,
  javaHome?: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of inheritedEnvironmentKeys) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  if (javaHome !== undefined) environment.JAVA_HOME = javaHome;
  environment.HOME = join(isolationRoot, "home");
  environment.GRADLE_USER_HOME = join(isolationRoot, "gradle-user-home");
  environment.TMPDIR = join(isolationRoot, "tmp");
  return environment;
}

export async function runVerificationProcess(
  options: RunVerificationProcessOptions,
): Promise<VerificationProcessResult> {
  const check = options.verification.checks[options.capability];
  const requested = check?.argv ?? [];
  const base = {
    transactionId: options.transactionId,
    capability: options.capability,
    requested,
    executed: null,
    exitCode: null,
    stdout: "",
    stderr: "",
  } as const;

  if (check === undefined) throw new ProcessError("command_not_allowed");
  validateArgv(requested);
  if (options.signal?.aborted) return { ...base, status: "cancelled" };

  const backend = options.backend ?? "docker";
  if (backend === "host" && options.allowHostExecution !== true) {
    return {
      ...base,
      status: "unavailable",
      error: {
        code: "host_execution_not_allowed",
        detail: "Host execution requires allowHostExecution: true",
      },
    };
  }

  let projectRoot: string;
  let lockRoot: string;
  let releaseLock: ProjectLockRelease | undefined;
  try {
    projectRoot = await realpath(resolve(options.projectRoot));
    if (options.projectLock === undefined) {
      const held = await acquireHeldProjectLock(
        resolve(options.lockRoot ?? projectRoot),
        options.signal,
      );
      if (held === null) return { ...base, status: "cancelled" };
      lockRoot = held.key;
      releaseLock = held.release;
    } else {
      lockRoot = await canonicalProjectKey(
        resolve(options.lockRoot ?? options.projectRoot),
      );
    }
  } catch (error: unknown) {
    return {
      ...base,
      status: "unavailable",
      error: {
        code: "process_spawn_unavailable",
        detail: `Cannot resolve project or lock root: ${String(error)}`,
      },
    };
  }

  if (
    options.projectLock !== undefined &&
    !assertHeldProjectLock(options.projectLock, lockRoot)
  ) {
    return {
      ...base,
      status: "unavailable",
      error: {
        code: "project_lock_mismatch",
        detail:
          "The project lock capability does not hold the canonical lock root.",
      },
    };
  }

  try {
    await Promise.all([
      mkdir(join(options.isolationRoot, "home"), { recursive: true }),
      mkdir(join(options.isolationRoot, "gradle-user-home"), {
        recursive: true,
      }),
      mkdir(join(options.isolationRoot, "tmp"), { recursive: true }),
    ]);
    if (options.signal?.aborted) return { ...base, status: "cancelled" };

    if (backend === "docker") return await runDockerVerification(options);
    return await executeHost(options, projectRoot, requested);
  } finally {
    releaseLock?.();
  }
}

function executeHost(
  options: RunVerificationProcessOptions,
  projectRoot: string,
  argv: readonly string[],
): Promise<VerificationProcessResult> {
  const timeoutMs =
    options.capability === "build"
      ? PROCESS_LIMITS.buildTimeoutMs
      : PROCESS_LIMITS.runtimeTimeoutMs;
  if (process.platform === "win32") {
    return executeWindowsProcess({
      transactionId: options.transactionId,
      capability: options.capability,
      projectRoot,
      argv,
      environment: isolatedEnvironment(options.isolationRoot, options.javaHome),
      timeoutMs,
      outputBytes: PROCESS_LIMITS.outputBytes,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  }
  return executePosixProcess({
    transactionId: options.transactionId,
    capability: options.capability,
    projectRoot,
    executedCwd: options.projectRoot,
    argv,
    environment: isolatedEnvironment(options.isolationRoot, options.javaHome),
    timeoutMs,
    outputBytes: PROCESS_LIMITS.outputBytes,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}
