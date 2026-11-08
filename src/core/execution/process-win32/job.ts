import {
  closeHandle,
  isNullHandle,
  type NativeBackend,
  type NativeState,
  WindowsSetupError,
  win32Error,
} from "./native.ts";

const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
const JobObjectAssociateCompletionPortInformation = 7;
const JobObjectExtendedLimitInformation = 9;
export const TERMINATION_EXIT_CODE = 1;

export function createJob(native: NativeBackend, state: NativeState): void {
  state.job = native.CreateJobObjectW(null, null) as NativeState["job"];
  if (isNullHandle(state.job)) {
    throw new WindowsSetupError(
      "process_job_unavailable",
      win32Error(native, "CreateJobObjectW"),
    );
  }
  const limits = {
    BasicLimitInformation: {
      PerProcessUserTimeLimit: 0n,
      PerJobUserTimeLimit: 0n,
      LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
      MinimumWorkingSetSize: 0n,
      MaximumWorkingSetSize: 0n,
      ActiveProcessLimit: 0,
      Affinity: 0n,
      PriorityClass: 0,
      SchedulingClass: 0,
    },
    IoInfo: {
      ReadOperationCount: 0n,
      WriteOperationCount: 0n,
      OtherOperationCount: 0n,
      ReadTransferCount: 0n,
      WriteTransferCount: 0n,
      OtherTransferCount: 0n,
    },
    ProcessMemoryLimit: 0n,
    JobMemoryLimit: 0n,
    PeakProcessMemoryUsed: 0n,
    PeakJobMemoryUsed: 0n,
  };
  if (
    !native.SetInformationJobObject(
      state.job,
      JobObjectExtendedLimitInformation,
      native.ffi.as(
        limits,
        native.ffi.pointer(native.JOBOBJECT_EXTENDED_LIMIT_INFORMATION),
      ),
      native.ffi.sizeof(native.JOBOBJECT_EXTENDED_LIMIT_INFORMATION),
    )
  ) {
    throw new WindowsSetupError(
      "process_job_unavailable",
      win32Error(native, "SetInformationJobObject(ExtendedLimit)"),
    );
  }

  state.completionPort = native.CreateIoCompletionPort(
    native.invalidHandleValue,
    null,
    0,
    1,
  ) as NativeState["completionPort"];
  if (isNullHandle(state.completionPort)) {
    throw new WindowsSetupError(
      "process_job_unavailable",
      win32Error(native, "CreateIoCompletionPort"),
    );
  }
  const association = {
    CompletionKey: null,
    CompletionPort: state.completionPort,
  };
  if (
    !native.SetInformationJobObject(
      state.job,
      JobObjectAssociateCompletionPortInformation,
      native.ffi.as(
        association,
        native.ffi.pointer(native.JOBOBJECT_ASSOCIATE_COMPLETION_PORT),
      ),
      native.ffi.sizeof(native.JOBOBJECT_ASSOCIATE_COMPLETION_PORT),
    )
  ) {
    throw new WindowsSetupError(
      "process_job_unavailable",
      win32Error(native, "SetInformationJobObject(CompletionPort)"),
    );
  }
}

export function assignProcessToJob(
  native: NativeBackend,
  state: NativeState,
): void {
  // The primary thread is still suspended, so neither it nor any descendant
  // can execute before assignment. No breakaway limit is ever enabled.
  if (!native.AssignProcessToJobObject(state.job, state.process)) {
    throw new WindowsSetupError(
      "process_job_unavailable",
      win32Error(native, "AssignProcessToJobObject"),
    );
  }
}

export function terminateFailedLaunch(
  native: NativeBackend,
  state: NativeState,
): void {
  if (state.process !== null) {
    native.TerminateProcess(state.process, TERMINATION_EXIT_CODE);
  }
  if (state.job !== null) {
    native.TerminateJobObject(state.job, TERMINATION_EXIT_CODE);
  }
}

export function closeJob(native: NativeBackend, state: NativeState): void {
  state.job = closeHandle(native, state.job);
}
