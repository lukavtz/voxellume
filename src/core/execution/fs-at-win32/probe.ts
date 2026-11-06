import {
  NATIVE_DIRFD_UNAVAILABLE,
  NativeDirFdError,
  type NativeDirFdProbe,
} from "../fs-at.ts";
import { loadWin32Native } from "./native.ts";
import {
  STATUS_OBJECT_NAME_NOT_FOUND,
  type Handle,
  type Win32Native,
} from "./types.ts";

let cachedProbe: NativeDirFdProbe | undefined;
let native: Win32Native | undefined;

export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function probeWin32NativeDirFd(): NativeDirFdProbe {
  if (cachedProbe !== undefined) return cachedProbe;
  try {
    native = loadWin32Native();
    cachedProbe = {
      ok: true,
      backend: "koffi",
      platform: "win32",
      architecture: process.arch,
    };
  } catch (error) {
    native = undefined;
    cachedProbe = {
      ok: false,
      code: NATIVE_DIRFD_UNAVAILABLE,
      detail: errorDetail(error),
    };
  }
  return cachedProbe;
}

export function backend(): Win32Native {
  const probe = probeWin32NativeDirFd();
  if (!probe.ok || native === undefined) {
    throw new NativeDirFdError(
      NATIVE_DIRFD_UNAVAILABLE,
      "Native directory-handle operations are unavailable",
      probe.ok ? "NTDLL backend did not initialize" : probe.detail,
    );
  }
  return native;
}

export function statusDetail(status: number): string {
  return `NTSTATUS 0x${(status >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function statusCode(status: number, missingCode: string): string {
  switch (status >>> 0) {
    case 0xc0000034:
      return missingCode;
    case 0xc0000035:
      return "already_exists";
    case 0xc0000022:
      return "access_denied";
    case 0xc0000043:
      return "sharing_violation";
    case 0xc00000ba:
      return "not_regular_file";
    case 0xc0000103:
      return "not_directory";
    case 0xc0000101:
      return "directory_not_empty";
    case 0xc00000d4:
      return "cross_device";
    case 0xc000050b:
      return "unsafe_symlink";
    case 0xc0000056:
      return "delete_pending";
    case 0xc000007f:
      return "no_space";
    case 0xc0000106:
      return "invalid_path";
    case 0xc0000002:
    case 0xc000000d:
    case 0xc0000010:
      return "unsupported";
    default:
      return "native_io_error";
  }
}

export function checkStatus(
  operation: string,
  path: string,
  status: number,
  missingCode = "not_found",
  allowMissing = false,
): void {
  if (status >= 0) return;
  if (allowMissing && status >>> 0 === STATUS_OBJECT_NAME_NOT_FOUND) return;
  const code = statusCode(status, missingCode);
  throw new NativeDirFdError(
    code,
    `Native ${operation} failed for ${path}: ${code}`,
    statusDetail(status),
    status >>> 0,
  );
}

export function nativeCall<T>(
  operation: string,
  path: string,
  call: () => T,
): T {
  try {
    return call();
  } catch (error) {
    if (error instanceof NativeDirFdError) throw error;
    throw new NativeDirFdError(
      "native_call_failed",
      `Native ${operation} call failed for ${path}`,
      errorDetail(error),
    );
  }
}

export function closeQuietly(handle: Handle): void {
  if (native === undefined) return;
  try {
    native.CloseHandle(handle);
  } catch {
    // Cleanup must not mask the operation's original failure.
  }
}

export function closeParent(handle: Handle): void {
  closeQuietly(handle);
}
