import type { TargetCapability } from "../../targets/target-pack.ts";
import type { VerificationProcessResult } from "../process.ts";
import {
  createSuspendedProcess,
  prepareWindowsProcess,
} from "./create-process.ts";
import { assignProcessToJob, createJob, terminateFailedLaunch } from "./job.ts";
import {
  closeAll,
  errorDetail,
  type NativeBackend,
  type NativeState,
  nativeBackend,
  WindowsSetupError,
} from "./native.ts";
import { monitorWindowsProcess } from "./stdio.ts";

export interface WindowsProcessOptions {
  readonly transactionId: string;
  readonly capability: TargetCapability;
  readonly projectRoot: string;
  readonly argv: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly outputBytes: number;
  readonly signal?: AbortSignal;
}

function unavailable(
  options: WindowsProcessOptions,
  code: string,
  detail: string,
  executed: boolean,
): VerificationProcessResult {
  return {
    transactionId: options.transactionId,
    capability: options.capability,
    requested: options.argv,
    executed: executed
      ? { argv: options.argv, cwd: options.projectRoot, shell: false }
      : null,
    status: "unavailable",
    exitCode: null,
    stdout: "",
    stderr: "",
    error: { code, detail },
  };
}

export async function executeWindowsProcess(
  options: WindowsProcessOptions,
): Promise<VerificationProcessResult> {
  if (options.signal?.aborted) {
    return {
      transactionId: options.transactionId,
      capability: options.capability,
      requested: options.argv,
      executed: null,
      status: "cancelled",
      exitCode: null,
      stdout: "",
      stderr: "",
    };
  }

  let native: NativeBackend;
  try {
    native = nativeBackend();
  } catch (error) {
    return unavailable(
      options,
      "process_backend_unavailable",
      errorDetail(error),
      false,
    );
  }

  const state: NativeState = {
    job: null,
    completionPort: null,
    process: null,
    thread: null,
    stdin: null,
    stdoutRead: null,
    stdoutWrite: null,
    stderrRead: null,
    stderrWrite: null,
  };

  try {
    const launch = prepareWindowsProcess(options);
    createJob(native, state);
    createSuspendedProcess(native, state, options, launch);
    assignProcessToJob(native, state);
  } catch (error) {
    const processCreated = state.process !== null;
    terminateFailedLaunch(native, state);
    closeAll(native, state);
    const setupError =
      error instanceof WindowsSetupError
        ? error
        : new WindowsSetupError(
            "process_backend_unavailable",
            errorDetail(error),
          );
    return unavailable(
      options,
      setupError.code,
      setupError.message,
      processCreated,
    );
  }

  return monitorWindowsProcess(native, state, options);
}
