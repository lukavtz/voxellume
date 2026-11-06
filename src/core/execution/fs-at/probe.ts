import { probeWin32NativeDirFd } from "../fs-at-win32.ts";
import { errorDetail, loadPosixBackend, type NativeBackend } from "./native.ts";
import {
  NATIVE_DIRFD_UNAVAILABLE,
  NativeDirFdError,
  type NativeDirFdProbe,
} from "./types.ts";

let cachedProbe: NativeDirFdProbe | undefined;
let nativeBackend: NativeBackend | undefined;

export function probeNativeDirFd(): NativeDirFdProbe {
  if (cachedProbe !== undefined) return cachedProbe;
  if (process.platform === "win32") {
    cachedProbe = probeWin32NativeDirFd();
    return cachedProbe;
  }

  try {
    nativeBackend = loadPosixBackend();
    cachedProbe = {
      ok: true,
      backend: "koffi",
      platform: process.platform as "darwin" | "linux",
      architecture: process.arch,
    };
  } catch (error) {
    nativeBackend = undefined;
    cachedProbe = {
      ok: false,
      code: NATIVE_DIRFD_UNAVAILABLE,
      detail: errorDetail(error),
    };
  }
  return cachedProbe;
}

export function backend(): NativeBackend {
  const probe = probeNativeDirFd();
  if (!probe.ok || nativeBackend === undefined) {
    throw new NativeDirFdError(
      NATIVE_DIRFD_UNAVAILABLE,
      "Native directory-fd operations are unavailable",
      probe.ok ? "native backend did not initialize" : probe.detail,
    );
  }
  return nativeBackend;
}
