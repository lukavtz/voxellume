import { resolve } from "node:path";

import type { WindowsProcessOptions } from "./index.ts";
import {
  closeHandle,
  type Handle,
  isInvalidFileHandle,
  type NativeBackend,
  type NativeState,
  type ProcessInformation,
  WindowsSetupError,
  win32Error,
} from "./native.ts";

const CREATE_SUSPENDED = 0x00000004;
const CREATE_UNICODE_ENVIRONMENT = 0x00000400;
const STARTF_USESTDHANDLES = 0x00000100;
const HANDLE_FLAG_INHERIT = 0x00000001;
const GENERIC_READ = 0x80000000;
const FILE_SHARE_READ_WRITE_DELETE = 0x00000007;
const OPEN_EXISTING = 3;

// CommandLineToArgvW quoting: backslashes precede a quote only when doubled;
// trailing backslashes are doubled before the closing quote. Only fixed argv
// elements are quoted; no model-provided command line is accepted.
function quoteWindowsArgument(argument: string): string {
  if (argument.length > 0 && !/[\s"]/u.test(argument)) return argument;
  let quoted = '"';
  let backslashes = 0;
  for (const character of argument) {
    if (character === "\\") {
      backslashes += 1;
    } else if (character === '"') {
      quoted += "\\".repeat(backslashes * 2 + 1) + character;
      backslashes = 0;
    } else {
      quoted += "\\".repeat(backslashes) + character;
      backslashes = 0;
    }
  }
  return quoted + "\\".repeat(backslashes * 2) + '"';
}

function quoteWindowsArgv(argv: readonly string[]): string {
  return argv.map(quoteWindowsArgument).join(" ");
}

function windowsEnvironmentBlock(environment: NodeJS.ProcessEnv): Buffer {
  const entries: string[] = [];
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    if (key.length === 0 || key.includes("=") || key.includes("\0")) {
      throw new WindowsSetupError(
        "process_environment_invalid",
        "Windows environment contains an invalid variable name",
      );
    }
    if (value.includes("\0")) {
      throw new WindowsSetupError(
        "process_environment_invalid",
        `Windows environment variable ${key} contains NUL`,
      );
    }
    entries.push(`${key}=${value}`);
  }
  entries.sort((left, right) => {
    const a = left.toUpperCase();
    const b = right.toUpperCase();
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return Buffer.from(`${entries.join("\0")}\0\0`, "utf16le");
}

function prepareLaunch(options: WindowsProcessOptions): {
  applicationName: string;
  commandLine: string;
  environment: NodeJS.ProcessEnv;
} {
  const environment = { ...options.environment };
  const commandRoot = environment.COMSPEC
    ? undefined
    : (environment.SystemRoot ?? environment.WINDIR);
  const commandInterpreter =
    environment.COMSPEC ??
    (commandRoot === undefined
      ? undefined
      : resolve(commandRoot, "System32", "cmd.exe"));
  if (commandInterpreter === undefined) {
    throw new WindowsSetupError(
      "process_spawn_unavailable",
      "COMSPEC and SystemRoot are both absent; the Gradle batch wrapper cannot start",
    );
  }

  // CreateProcessW cannot execute a batch file directly. The interpreter gets a
  // fixed command, not model text. The wrapper path crosses cmd.exe through an
  // environment variable inside quotes, so spaces/metacharacters in projectRoot
  // are data and are not reparsed as command-line syntax. Delayed expansion is
  // off. Only the already-allowlisted --no-daemon/task arguments are appended.
  environment.VOXELLUME_GRADLE_WRAPPER = resolve(
    options.projectRoot,
    "gradlew.bat",
  );
  const batchCommand = `"%VOXELLUME_GRADLE_WRAPPER%" ${quoteWindowsArgv(options.argv.slice(1))}`;
  const commandLine = `${quoteWindowsArgv([
    commandInterpreter,
    "/d",
    "/v:off",
    "/s",
    "/c",
  ])} "${batchCommand}"`;
  if (commandLine.length >= 32767) {
    throw new WindowsSetupError(
      "process_spawn_unavailable",
      "Windows process command line exceeds 32767 UTF-16 code units",
    );
  }
  return { applicationName: commandInterpreter, commandLine, environment };
}

function createPipe(
  native: NativeBackend,
  attributes: {
    nLength: number;
    lpSecurityDescriptor: null;
    bInheritHandle: number;
  },
): { read: Handle; write: Handle } {
  const read: unknown[] = [null];
  const write: unknown[] = [null];
  if (!native.CreatePipe(read, write, attributes, 0)) {
    throw new WindowsSetupError(
      "process_stdio_unavailable",
      win32Error(native, "CreatePipe"),
    );
  }
  const readHandle = read[0] as Handle;
  const writeHandle = write[0] as Handle;
  if (!native.SetHandleInformation(readHandle, HANDLE_FLAG_INHERIT, 0)) {
    native.CloseHandle(readHandle);
    native.CloseHandle(writeHandle);
    throw new WindowsSetupError(
      "process_stdio_unavailable",
      win32Error(native, "SetHandleInformation"),
    );
  }
  return { read: readHandle, write: writeHandle };
}

export interface PreparedWindowsProcess {
  applicationName: string;
  commandLine: Buffer;
  environment: Buffer;
}

export function prepareWindowsProcess(
  options: WindowsProcessOptions,
): PreparedWindowsProcess {
  const launch = prepareLaunch(options);
  return {
    applicationName: launch.applicationName,
    commandLine: Buffer.from(`${launch.commandLine}\0`, "utf16le"),
    environment: windowsEnvironmentBlock(launch.environment),
  };
}

export function createSuspendedProcess(
  native: NativeBackend,
  state: NativeState,
  options: WindowsProcessOptions,
  launch: PreparedWindowsProcess,
): void {
  const { applicationName, commandLine, environment } = launch;
  const attributes = {
    nLength: native.ffi.sizeof(native.SECURITY_ATTRIBUTES),
    lpSecurityDescriptor: null,
    bInheritHandle: 1,
  };
  const stdoutPipe = createPipe(native, attributes);
  state.stdoutRead = stdoutPipe.read;
  state.stdoutWrite = stdoutPipe.write;
  const stderrPipe = createPipe(native, attributes);
  state.stderrRead = stderrPipe.read;
  state.stderrWrite = stderrPipe.write;
  state.stdin = native.CreateFileW(
    "NUL",
    GENERIC_READ,
    FILE_SHARE_READ_WRITE_DELETE,
    attributes,
    OPEN_EXISTING,
    0,
    null,
  ) as Handle | null;
  if (isInvalidFileHandle(state.stdin)) {
    throw new WindowsSetupError(
      "process_stdio_unavailable",
      win32Error(native, "CreateFileW(NUL)"),
    );
  }

  const startupInfo = {
    cb: native.ffi.sizeof(native.STARTUPINFOW),
    lpReserved: null,
    lpDesktop: null,
    lpTitle: null,
    dwX: 0,
    dwY: 0,
    dwXSize: 0,
    dwYSize: 0,
    dwXCountChars: 0,
    dwYCountChars: 0,
    dwFillAttribute: 0,
    dwFlags: STARTF_USESTDHANDLES,
    wShowWindow: 0,
    cbReserved2: 0,
    lpReserved2: null,
    hStdInput: state.stdin,
    hStdOutput: state.stdoutWrite,
    hStdError: state.stderrWrite,
  };
  const processInformation = {} as ProcessInformation;
  if (
    !native.CreateProcessW(
      applicationName,
      commandLine,
      null,
      null,
      1,
      CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
      environment,
      options.projectRoot,
      startupInfo,
      processInformation,
    )
  ) {
    throw new WindowsSetupError(
      "process_spawn_failed",
      win32Error(native, "CreateProcessW"),
    );
  }
  state.process = processInformation.hProcess;
  state.thread = processInformation.hThread;
  state.stdin = closeHandle(native, state.stdin);
  state.stdoutWrite = closeHandle(native, state.stdoutWrite);
  state.stderrWrite = closeHandle(native, state.stderrWrite);
}
