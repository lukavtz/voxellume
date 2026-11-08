import { createRequire } from "node:module";

import type koffi from "koffi";
import type { KoffiFunc, TypeObject } from "koffi";

type Koffi = typeof koffi;
export type Handle = bigint;
type NativeFunction = KoffiFunc<(...args: unknown[]) => unknown>;

export interface NativeBackend {
  readonly ffi: Koffi;
  readonly SECURITY_ATTRIBUTES: TypeObject;
  readonly STARTUPINFOW: TypeObject;
  readonly PROCESS_INFORMATION: TypeObject;
  readonly JOBOBJECT_EXTENDED_LIMIT_INFORMATION: TypeObject;
  readonly JOBOBJECT_ASSOCIATE_COMPLETION_PORT: TypeObject;
  readonly invalidHandleValue: Handle;
  readonly CloseHandle: NativeFunction;
  readonly GetLastError: NativeFunction;
  readonly SetHandleInformation: NativeFunction;
  readonly CreatePipe: NativeFunction;
  readonly CreateFileW: NativeFunction;
  readonly CreateJobObjectW: NativeFunction;
  readonly SetInformationJobObject: NativeFunction;
  readonly CreateIoCompletionPort: NativeFunction;
  readonly GetQueuedCompletionStatus: NativeFunction;
  readonly CreateProcessW: NativeFunction;
  readonly AssignProcessToJobObject: NativeFunction;
  readonly ResumeThread: NativeFunction;
  readonly TerminateProcess: NativeFunction;
  readonly TerminateJobObject: NativeFunction;
  readonly WaitForSingleObject: NativeFunction;
  readonly GetExitCodeProcess: NativeFunction;
  readonly ReadFile: NativeFunction;
}

export interface ProcessInformation {
  hProcess: Handle;
  hThread: Handle;
  dwProcessId: number;
  dwThreadId: number;
}

export interface NativeState {
  job: Handle | null;
  completionPort: Handle | null;
  process: Handle | null;
  thread: Handle | null;
  stdin: Handle | null;
  stdoutRead: Handle | null;
  stdoutWrite: Handle | null;
  stderrRead: Handle | null;
  stderrWrite: Handle | null;
}

export class WindowsSetupError extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    super(detail);
    this.name = "WindowsSetupError";
    this.code = code;
  }
}

const require = createRequire(import.meta.url);
let cachedNative: NativeBackend | undefined;

function loadNativeBackend(): NativeBackend {
  if (process.platform !== "win32") {
    throw new Error(
      `Windows process backend cannot load on ${process.platform}`,
    );
  }

  // Only the exact optional prebuilt is loadable; never compile a fallback.
  const koffiEntry = require.resolve("koffi");
  const koffiRequire = createRequire(koffiEntry);
  koffiRequire.resolve(`@koromix/koffi-win32-${process.arch}`);
  const ffi = require("koffi") as Koffi;
  const kernel32 = ffi.load("kernel32.dll");
  const VOXELLUME_PROCESS_HANDLE = ffi.pointer(
    "VOXELLUME_PROCESS_HANDLE",
    ffi.opaque(),
  );

  const SECURITY_ATTRIBUTES = ffi.struct("SECURITY_ATTRIBUTES", {
    nLength: "uint32_t",
    lpSecurityDescriptor: "void *",
    bInheritHandle: "int32_t",
  });
  const STARTUPINFOW = ffi.struct("STARTUPINFOW", {
    cb: "uint32_t",
    lpReserved: "const char16_t *",
    lpDesktop: "const char16_t *",
    lpTitle: "const char16_t *",
    dwX: "uint32_t",
    dwY: "uint32_t",
    dwXSize: "uint32_t",
    dwYSize: "uint32_t",
    dwXCountChars: "uint32_t",
    dwYCountChars: "uint32_t",
    dwFillAttribute: "uint32_t",
    dwFlags: "uint32_t",
    wShowWindow: "uint16_t",
    cbReserved2: "uint16_t",
    lpReserved2: "void *",
    hStdInput: VOXELLUME_PROCESS_HANDLE,
    hStdOutput: VOXELLUME_PROCESS_HANDLE,
    hStdError: VOXELLUME_PROCESS_HANDLE,
  });
  const PROCESS_INFORMATION = ffi.struct("PROCESS_INFORMATION", {
    hProcess: VOXELLUME_PROCESS_HANDLE,
    hThread: VOXELLUME_PROCESS_HANDLE,
    dwProcessId: "uint32_t",
    dwThreadId: "uint32_t",
  });
  const JOBOBJECT_BASIC_LIMIT_INFORMATION = ffi.struct(
    "JOBOBJECT_BASIC_LIMIT_INFORMATION",
    {
      PerProcessUserTimeLimit: "int64_t",
      PerJobUserTimeLimit: "int64_t",
      LimitFlags: "uint32_t",
      MinimumWorkingSetSize: "uintptr_t",
      MaximumWorkingSetSize: "uintptr_t",
      ActiveProcessLimit: "uint32_t",
      Affinity: "uintptr_t",
      PriorityClass: "uint32_t",
      SchedulingClass: "uint32_t",
    },
  );
  const IO_COUNTERS = ffi.struct("IO_COUNTERS", {
    ReadOperationCount: "uint64_t",
    WriteOperationCount: "uint64_t",
    OtherOperationCount: "uint64_t",
    ReadTransferCount: "uint64_t",
    WriteTransferCount: "uint64_t",
    OtherTransferCount: "uint64_t",
  });
  const JOBOBJECT_EXTENDED_LIMIT_INFORMATION = ffi.struct(
    "JOBOBJECT_EXTENDED_LIMIT_INFORMATION",
    {
      BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION,
      IoInfo: IO_COUNTERS,
      ProcessMemoryLimit: "uintptr_t",
      JobMemoryLimit: "uintptr_t",
      PeakProcessMemoryUsed: "uintptr_t",
      PeakJobMemoryUsed: "uintptr_t",
    },
  );
  const JOBOBJECT_ASSOCIATE_COMPLETION_PORT = ffi.struct(
    "JOBOBJECT_ASSOCIATE_COMPLETION_PORT",
    { CompletionKey: "void *", CompletionPort: VOXELLUME_PROCESS_HANDLE },
  );

  for (const [type, expected] of [
    [SECURITY_ATTRIBUTES, 24],
    [STARTUPINFOW, 104],
    [PROCESS_INFORMATION, 24],
    [JOBOBJECT_BASIC_LIMIT_INFORMATION, 64],
    [IO_COUNTERS, 48],
    [JOBOBJECT_EXTENDED_LIMIT_INFORMATION, 144],
    [JOBOBJECT_ASSOCIATE_COMPLETION_PORT, 16],
  ] as const) {
    if (ffi.sizeof(type) !== expected) {
      throw new Error(
        `Win32 layout mismatch: ${type.name} is ${ffi.sizeof(type)}, expected ${expected}`,
      );
    }
  }

  return {
    ffi,
    SECURITY_ATTRIBUTES,
    STARTUPINFOW,
    PROCESS_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOBOBJECT_ASSOCIATE_COMPLETION_PORT,
    invalidHandleValue: -1n,
    CloseHandle: kernel32.func(
      "int32_t __stdcall CloseHandle(VOXELLUME_PROCESS_HANDLE object)",
    ),
    GetLastError: kernel32.func("uint32_t __stdcall GetLastError()"),
    SetHandleInformation: kernel32.func(
      "int32_t __stdcall SetHandleInformation(VOXELLUME_PROCESS_HANDLE object, uint32_t mask, uint32_t flags)",
    ),
    CreatePipe: kernel32.func(
      "int32_t __stdcall CreatePipe(_Out_ VOXELLUME_PROCESS_HANDLE *readPipe, _Out_ VOXELLUME_PROCESS_HANDLE *writePipe, SECURITY_ATTRIBUTES *attributes, uint32_t size)",
    ),
    CreateFileW: kernel32.func(
      "VOXELLUME_PROCESS_HANDLE __stdcall CreateFileW(const char16_t *name, uint32_t access, uint32_t share, SECURITY_ATTRIBUTES *attributes, uint32_t disposition, uint32_t flags, VOXELLUME_PROCESS_HANDLE templateFile)",
    ),
    CreateJobObjectW: kernel32.func(
      "VOXELLUME_PROCESS_HANDLE __stdcall CreateJobObjectW(void *attributes, const char16_t *name)",
    ),
    SetInformationJobObject: kernel32.func(
      "int32_t __stdcall SetInformationJobObject(VOXELLUME_PROCESS_HANDLE job, int32_t informationClass, void *information, uint32_t informationLength)",
    ),
    CreateIoCompletionPort: kernel32.func(
      "VOXELLUME_PROCESS_HANDLE __stdcall CreateIoCompletionPort(VOXELLUME_PROCESS_HANDLE file, VOXELLUME_PROCESS_HANDLE existingPort, uintptr_t completionKey, uint32_t concurrentThreads)",
    ),
    GetQueuedCompletionStatus: kernel32.func(
      "int32_t __stdcall GetQueuedCompletionStatus(VOXELLUME_PROCESS_HANDLE port, _Out_ uint32_t *bytes, _Out_ uintptr_t *completionKey, _Out_ void **overlapped, uint32_t milliseconds)",
    ),
    CreateProcessW: kernel32.func(
      "int32_t __stdcall CreateProcessW(const char16_t *applicationName, char16_t *commandLine, void *processAttributes, void *threadAttributes, int32_t inheritHandles, uint32_t creationFlags, void *environment, const char16_t *currentDirectory, STARTUPINFOW *startupInfo, _Out_ PROCESS_INFORMATION *processInformation)",
    ),
    AssignProcessToJobObject: kernel32.func(
      "int32_t __stdcall AssignProcessToJobObject(VOXELLUME_PROCESS_HANDLE job, VOXELLUME_PROCESS_HANDLE process)",
    ),
    ResumeThread: kernel32.func(
      "uint32_t __stdcall ResumeThread(VOXELLUME_PROCESS_HANDLE thread)",
    ),
    TerminateProcess: kernel32.func(
      "int32_t __stdcall TerminateProcess(VOXELLUME_PROCESS_HANDLE process, uint32_t exitCode)",
    ),
    TerminateJobObject: kernel32.func(
      "int32_t __stdcall TerminateJobObject(VOXELLUME_PROCESS_HANDLE job, uint32_t exitCode)",
    ),
    WaitForSingleObject: kernel32.func(
      "int32_t __stdcall WaitForSingleObject(VOXELLUME_PROCESS_HANDLE object, uint32_t milliseconds)",
    ),
    GetExitCodeProcess: kernel32.func(
      "int32_t __stdcall GetExitCodeProcess(VOXELLUME_PROCESS_HANDLE process, _Out_ uint32_t *exitCode)",
    ),
    ReadFile: kernel32.func(
      "int32_t __stdcall ReadFile(VOXELLUME_PROCESS_HANDLE file, void *buffer, uint32_t bytesToRead, _Out_ uint32_t *bytesRead, void *overlapped)",
    ),
  };
}

export function nativeBackend(): NativeBackend {
  cachedNative ??= loadNativeBackend();
  return cachedNative;
}

export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isNullHandle(handle: Handle | null): boolean {
  return handle === null || handle === 0n;
}

export function isInvalidFileHandle(handle: Handle | null): boolean {
  return (
    isNullHandle(handle) || handle === -1n || handle === 0xffffffffffffffffn
  );
}

export function win32Error(native: NativeBackend, operation: string): string {
  return `${operation} failed with Win32 error ${String(native.GetLastError())}`;
}

export function closeHandle(
  native: NativeBackend,
  handle: Handle | null,
): null {
  if (!isNullHandle(handle) && !isInvalidFileHandle(handle)) {
    native.CloseHandle(handle);
  }
  return null;
}

export function closeAll(native: NativeBackend, state: NativeState): void {
  state.stdin = closeHandle(native, state.stdin);
  state.stdoutRead = closeHandle(native, state.stdoutRead);
  state.stdoutWrite = closeHandle(native, state.stdoutWrite);
  state.stderrRead = closeHandle(native, state.stderrRead);
  state.stderrWrite = closeHandle(native, state.stderrWrite);
  state.thread = closeHandle(native, state.thread);
  state.process = closeHandle(native, state.process);
  state.job = closeHandle(native, state.job);
  state.completionPort = closeHandle(native, state.completionPort);
}
