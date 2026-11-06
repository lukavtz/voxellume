import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  PROCESS_LIMITS,
  type RunVerificationProcessOptions,
  type VerificationProcessResult,
  type VerificationProcessStatus,
} from "./process.ts";
import { ALLOWED_GRADLE_TASKS } from "../targets/target-pack.ts";

// Official Docker Hub multi-architecture indexes, resolved from
// registry-1.docker.io on 2026-11-06.
export const DOCKER_JDK21_IMAGE =
  "eclipse-temurin:21-jdk@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a";
export const DOCKER_JDK25_IMAGE =
  "eclipse-temurin:25-jdk@sha256:83f4a7fc27df94dcc7b8de04d14cbbba8da14406f921e966969c3b09000aa507";
export const DOCKER_NODE_IMAGE =
  "node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9";

const containerImages = {
  jdk21: DOCKER_JDK21_IMAGE,
  jdk25: DOCKER_JDK25_IMAGE,
  node: DOCKER_NODE_IMAGE,
} as const;

const dockerEnvironment = (isolationRoot: string): NodeJS.ProcessEnv => ({
  ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
  DOCKER_CONFIG: join(isolationRoot, "docker-config"),
});

function baseResult(
  options: RunVerificationProcessOptions,
  requested: readonly string[],
) {
  return {
    transactionId: options.transactionId,
    capability: options.capability,
    requested,
    executed: null,
    exitCode: null,
    stdout: "",
    stderr: "",
  } as const;
}

function validateMountPath(path: string): void {
  if (path.includes(",") || path.includes(":")) {
    throw new Error("Docker bind-mount paths cannot contain commas or colons");
  }
}

export async function runDockerVerification(
  options: RunVerificationProcessOptions,
): Promise<VerificationProcessResult> {
  const check = options.verification.checks[options.capability];
  const requested = check?.argv ?? [];
  const base = baseResult(options, requested);
  if (
    check === undefined ||
    requested.length < 3 ||
    requested[0] !== "./gradlew" ||
    requested[1] !== "--no-daemon" ||
    requested
      .slice(2)
      .some((task) => !ALLOWED_GRADLE_TASKS.includes(task as never))
  ) {
    throw new Error("command_not_allowed");
  }
  if (options.signal?.aborted) return { ...base, status: "cancelled" };

  let projectRoot: string;
  let isolationRoot: string;
  try {
    projectRoot = await realpath(resolve(options.projectRoot));
    isolationRoot = resolve(options.isolationRoot);
    await Promise.all(
      ["home", "gradle-user-home", "docker-config"].map((directory) =>
        mkdir(join(isolationRoot, directory), { recursive: true }),
      ),
    );
    isolationRoot = await realpath(isolationRoot);
    validateMountPath(projectRoot);
    validateMountPath(isolationRoot);
  } catch (error: unknown) {
    return {
      ...base,
      status: "unavailable",
      error: {
        code: "backend_unavailable",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
  if (options.signal?.aborted) return { ...base, status: "cancelled" };

  const containerName = `voxellume-${createHash("sha256")
    .update(options.transactionId)
    .digest("hex")
    .slice(0, 24)}`;
  const runtime = options.containerRuntime ?? "jdk21";
  const javaEnvironment =
    runtime === "node"
      ? []
      : [
          "--env",
          "JAVA_HOME=/opt/java/openjdk",
          "--env",
          "PATH=/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        ];
  // Docker Desktop's VM supplies isolation where host UID mapping is unsupported.
  const user =
    typeof process.getuid === "function" && typeof process.getgid === "function"
      ? ["--user", `${process.getuid()}:${process.getgid()}`]
      : [];
  const argv = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network",
    "none",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=268435456,mode=1777",
    "--cpus",
    String(PROCESS_LIMITS.containerCpus),
    "--memory",
    String(PROCESS_LIMITS.containerMemoryBytes),
    "--pids-limit",
    String(PROCESS_LIMITS.containerPids),
    ...user,
    "--mount",
    `type=bind,src=${projectRoot},dst=/workspace/project`,
    "--mount",
    `type=bind,src=${join(isolationRoot, "home")},dst=/home/voxellume`,
    "--mount",
    `type=bind,src=${join(isolationRoot, "gradle-user-home")},dst=/gradle-user-home`,
    "--workdir",
    "/workspace/project",
    "--env",
    "HOME=/home/voxellume",
    "--env",
    "GRADLE_USER_HOME=/gradle-user-home",
    "--env",
    "TMP=/tmp",
    "--env",
    "TEMP=/tmp",
    "--env",
    "TMPDIR=/tmp",
    ...javaEnvironment,
    containerImages[runtime],
    ...requested,
  ];

  return executeDocker(
    options,
    projectRoot,
    isolationRoot,
    containerName,
    argv,
    requested,
  );
}

function executeDocker(
  options: RunVerificationProcessOptions,
  projectRoot: string,
  isolationRoot: string,
  containerName: string,
  argv: readonly string[],
  requested: readonly string[],
): Promise<VerificationProcessResult> {
  const { promise, resolve: resolveResult } =
    Promise.withResolvers<VerificationProcessResult>();
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const environment = dockerEnvironment(isolationRoot);
  let capturedBytes = 0;
  let spawnFailed = false;
  let outputExceeded = false;
  let timedOut = false;
  let cancelled = false;
  let cleanup: Promise<void> | undefined;

  const child = spawn("docker", argv, {
    cwd: projectRoot,
    env: environment,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stopContainer = (): Promise<void> => {
    if (cleanup !== undefined) return cleanup;
    const { promise, resolve: resolveCleanup } = Promise.withResolvers<void>();
    cleanup = promise;
    const remover = spawn("docker", ["rm", "--force", containerName], {
      env: environment,
      shell: false,
      stdio: "ignore",
    });
    const timer = setTimeout(() => remover.kill("SIGKILL"), 10_000);
    const done = (): void => {
      clearTimeout(timer);
      resolveCleanup();
    };
    remover.once("error", done);
    remover.once("close", done);
    return cleanup;
  };

  const killClient = (): void => {
    if (child.pid !== undefined && process.platform !== "win32") {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The Docker CLI may already have exited.
      }
    } else {
      child.kill("SIGKILL");
    }
  };
  const terminate = (): void => {
    killClient();
    void stopContainer();
  };
  const capture = (target: Buffer[], chunk: Buffer): void => {
    const remaining = PROCESS_LIMITS.outputBytes - capturedBytes;
    if (remaining > 0) {
      target.push(chunk.subarray(0, remaining));
      capturedBytes += Math.min(remaining, chunk.length);
    }
    if (chunk.length > remaining && !outputExceeded) {
      outputExceeded = true;
      terminate();
    }
  };

  child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk));
  child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk));
  child.once("error", () => {
    spawnFailed = true;
  });
  const timer = setTimeout(
    () => {
      timedOut = true;
      terminate();
    },
    options.capability === "build"
      ? PROCESS_LIMITS.buildTimeoutMs
      : PROCESS_LIMITS.runtimeTimeoutMs,
  );
  const onAbort = (): void => {
    cancelled = true;
    terminate();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();

  child.once("close", (code) => {
    void stopContainer().then(() => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      const diagnostic = stderrText.toLowerCase();
      const infrastructureFailure =
        code === 125 ||
        diagnostic.includes("docker: error response from daemon") ||
        diagnostic.includes("error during connect") ||
        diagnostic.includes("failed to connect to the docker api") ||
        diagnostic.includes("cannot connect to the docker daemon") ||
        diagnostic.includes("docker daemon is not running") ||
        diagnostic.includes("mounts denied") ||
        diagnostic.includes("permission denied while trying to connect");
      const unavailable =
        spawnFailed || (!cancelled && !timedOut && infrastructureFailure);
      const status: VerificationProcessStatus = cancelled
        ? "cancelled"
        : timedOut
          ? "timed_out"
          : outputExceeded
            ? "failed"
            : unavailable
              ? "unavailable"
              : code === 0
                ? "passed"
                : "failed";
      const error = outputExceeded
        ? {
            code: "output_limit_exceeded",
            detail: `Process output exceeded ${PROCESS_LIMITS.outputBytes} bytes`,
          }
        : unavailable
          ? {
              code: "backend_unavailable",
              detail: stderrText || "Docker execution is unavailable",
            }
          : undefined;
      resolveResult({
        transactionId: options.transactionId,
        capability: options.capability,
        requested,
        executed: unavailable
          ? null
          : { argv: ["docker", ...argv], cwd: projectRoot, shell: false },
        status,
        exitCode:
          status === "passed" || (status === "failed" && !outputExceeded)
            ? code
            : null,
        stdout: stdoutText,
        stderr: stderrText,
        ...(error === undefined ? {} : { error }),
      });
    });
  });
  return promise;
}
