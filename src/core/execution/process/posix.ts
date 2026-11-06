import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import type { TargetCapability } from "../../targets/target-pack.ts";
import type { VerificationProcessResult } from "../process.ts";

export interface PosixProcessOptions {
  readonly transactionId: string;
  readonly capability: TargetCapability;
  readonly projectRoot: string;
  readonly executedCwd: string;
  readonly argv: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly outputBytes: number;
  readonly signal?: AbortSignal;
}

function killProcessGroup(pid: number | undefined): boolean {
  if (pid === undefined) return true;
  try {
    process.kill(-pid, "SIGKILL");
    return false;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    return false;
  }
}

async function killAndConfirmProcessGroup(
  pid: number | undefined,
): Promise<void> {
  while (!killProcessGroup(pid)) await delay(10);
}

export function executePosixProcess(
  options: PosixProcessOptions,
): Promise<VerificationProcessResult> {
  const { promise, resolve: resolveResult } =
    Promise.withResolvers<VerificationProcessResult>();
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let capturedBytes = 0;
  let outputExceeded = false;
  let timedOut = false;
  let cancelled = false;
  let spawnError: NodeJS.ErrnoException | undefined;

  const child = spawn(options.argv[0]!, options.argv.slice(1), {
    cwd: options.projectRoot,
    env: options.environment,
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const capture = (target: Buffer[], chunk: Buffer): void => {
    const remaining = options.outputBytes - capturedBytes;
    if (remaining > 0) {
      target.push(chunk.subarray(0, remaining));
      capturedBytes += Math.min(remaining, chunk.length);
    }
    if (chunk.length > remaining && !outputExceeded) {
      outputExceeded = true;
      killProcessGroup(child.pid);
    }
  };

  child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk));
  child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk));
  child.on("error", (error: NodeJS.ErrnoException) => {
    spawnError = error;
  });

  const timer = setTimeout(() => {
    timedOut = true;
    killProcessGroup(child.pid);
  }, options.timeoutMs);

  const onAbort = () => {
    cancelled = true;
    killProcessGroup(child.pid);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();

  child.once("close", (code) => {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    void killAndConfirmProcessGroup(child.pid).then(() => {
      const status = spawnError
        ? "unavailable"
        : cancelled
          ? "cancelled"
          : timedOut
            ? "timed_out"
            : outputExceeded
              ? "failed"
              : code === 0
                ? "passed"
                : "failed";
      resolveResult({
        transactionId: options.transactionId,
        capability: options.capability,
        requested: options.argv,
        executed: spawnError
          ? null
          : { argv: options.argv, cwd: options.executedCwd, shell: false },
        status,
        exitCode:
          status === "passed" || (status === "failed" && !outputExceeded)
            ? code
            : null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        ...(spawnError
          ? {
              error: {
                code: "process_spawn_unavailable",
                detail: `${spawnError.code ?? "SPAWN_ERROR"}: ${spawnError.message}; executable ${options.argv[0]}`,
              },
            }
          : outputExceeded
            ? {
                error: {
                  code: "output_limit_exceeded",
                  detail: `Process output exceeded ${options.outputBytes} bytes`,
                },
              }
            : {}),
      });
    });
  });
  return promise;
}
