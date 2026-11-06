import type { VerificationProcessResult } from "../process.ts";
import type { WindowsProcessOptions } from "./index.ts";
import { closeJob, TERMINATION_EXIT_CODE } from "./job.ts";
import {
  closeAll,
  closeHandle,
  errorDetail,
  type Handle,
  type NativeBackend,
  type NativeState,
  win32Error,
} from "./native.ts";

const JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO = 4;
const INFINITE = 0xffffffff;
const WAIT_FAILED = 0xffffffff;

export function monitorWindowsProcess(
  native: NativeBackend,
  state: NativeState,
  options: WindowsProcessOptions,
): Promise<VerificationProcessResult> {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let capturedBytes = 0;
  let outputExceeded = false;
  let timedOut = false;
  let cancelled = false;
  let primaryDone = false;
  let completionDone = false;
  let pipesDone = 0;
  let settled = false;
  let exitCode: number | null = null;
  let runtimeError: { code: string; detail: string } | null = null;

  const { promise, resolve: resolveResult } =
    Promise.withResolvers<VerificationProcessResult>();
  const killTree = (): void => {
    if (state.job === null) return;
    if (!native.TerminateJobObject(state.job, TERMINATION_EXIT_CODE)) {
      runtimeError ??= {
        code: "process_job_termination_failed",
        detail: win32Error(native, "TerminateJobObject"),
      };
    }
    // Also covers TerminateJobObject failure and supervisor teardown.
    closeJob(native, state);
  };
  const recordError = (code: string, detail: string): void => {
    runtimeError ??= { code, detail };
    killTree();
  };

  const maybeFinish = (): void => {
    if (settled || !primaryDone || !completionDone || pipesDone !== 2) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    closeAll(native, state);
    const status = cancelled
      ? "cancelled"
      : timedOut
        ? "timed_out"
        : outputExceeded
          ? "failed"
          : runtimeError !== null
            ? "unavailable"
            : exitCode === 0
              ? "passed"
              : "failed";
    resolveResult({
      transactionId: options.transactionId,
      capability: options.capability,
      requested: options.argv,
      executed: { argv: options.argv, cwd: options.projectRoot, shell: false },
      status,
      exitCode:
        status === "passed" || (status === "failed" && !outputExceeded)
          ? exitCode
          : null,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
      ...(outputExceeded
        ? {
            error: {
              code: "output_limit_exceeded",
              detail: `Process output exceeded ${options.outputBytes} bytes`,
            },
          }
        : (runtimeError ?? {})),
    });
  };

  const capture = (target: Buffer[], chunk: Buffer): void => {
    const remaining = options.outputBytes - capturedBytes;
    if (remaining > 0) {
      target.push(chunk.subarray(0, remaining));
      capturedBytes += Math.min(remaining, chunk.length);
    }
    if (chunk.length > remaining && !outputExceeded) {
      outputExceeded = true;
      killTree();
    }
  };

  const pumpOutput = (handle: Handle, target: Buffer[]): void => {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const bytesRead = [0];
    const read = (): void => {
      try {
        native.ReadFile.async(
          handle,
          buffer,
          buffer.length,
          bytesRead,
          null,
          (error: unknown, ok: unknown) => {
            if (settled) return;
            if (error !== null && error !== undefined) {
              pipesDone += 1;
              recordError("process_output_failed", errorDetail(error));
              maybeFinish();
              return;
            }
            // A synchronous pipe ReadFile reports EOF/broken pipe as FALSE.
            // Treat it as stream closure; process/job waits still govern status.
            if (!ok) {
              pipesDone += 1;
              maybeFinish();
              return;
            }
            if (bytesRead[0]! > 0) {
              capture(target, Buffer.from(buffer.subarray(0, bytesRead[0])));
            }
            read();
          },
        );
      } catch (error) {
        pipesDone += 1;
        recordError("process_output_failed", errorDetail(error));
        maybeFinish();
      }
    };
    read();
  };

  const completionBytes = [0];
  const completionKey = [0n];
  const completionOverlapped: unknown[] = [null];
  const waitForJobMessage = (): void => {
    try {
      native.GetQueuedCompletionStatus.async(
        state.completionPort,
        completionBytes,
        completionKey,
        completionOverlapped,
        INFINITE,
        (error: unknown, ok: unknown) => {
          if (settled || completionDone) return;
          if ((error !== null && error !== undefined) || !ok) {
            completionDone = true;
            recordError(
              "process_job_wait_failed",
              error === null || error === undefined
                ? win32Error(native, "GetQueuedCompletionStatus")
                : errorDetail(error),
            );
            maybeFinish();
            return;
          }
          if (completionBytes[0] === JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO) {
            completionDone = true;
            maybeFinish();
            return;
          }
          waitForJobMessage();
        },
      );
    } catch (error) {
      completionDone = true;
      recordError("process_job_wait_failed", errorDetail(error));
      maybeFinish();
    }
  };

  const timer = setTimeout(() => {
    timedOut = true;
    killTree();
  }, options.timeoutMs);
  const onAbort = (): void => {
    cancelled = true;
    killTree();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();

  try {
    native.WaitForSingleObject.async(
      state.process,
      INFINITE,
      (error: unknown, waitResult: unknown) => {
        if (settled || primaryDone) return;
        primaryDone = true;
        if (
          (error !== null && error !== undefined) ||
          waitResult === WAIT_FAILED
        ) {
          recordError(
            "process_wait_failed",
            error === null || error === undefined
              ? win32Error(native, "WaitForSingleObject")
              : errorDetail(error),
          );
        } else {
          const code = [0];
          if (!native.GetExitCodeProcess(state.process, code)) {
            recordError(
              "process_wait_failed",
              win32Error(native, "GetExitCodeProcess"),
            );
          } else {
            exitCode = code[0]!;
          }
        }
        state.thread = closeHandle(native, state.thread);
        state.process = closeHandle(native, state.process);
        // Normal primary exit also kills every remaining descendant.
        closeJob(native, state);
        maybeFinish();
      },
    );
  } catch (error) {
    primaryDone = true;
    recordError("process_wait_failed", errorDetail(error));
    maybeFinish();
  }

  pumpOutput(state.stdoutRead!, stdout);
  pumpOutput(state.stderrRead!, stderr);
  waitForJobMessage();

  try {
    if (!cancelled && native.ResumeThread(state.thread) === 0xffffffff) {
      recordError("process_spawn_failed", win32Error(native, "ResumeThread"));
    }
  } catch (error) {
    recordError("process_spawn_failed", errorDetail(error));
  }
  return promise;
}
