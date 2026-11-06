import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  type BigIntStats,
} from "node:fs";
import { createRequire } from "node:module";
import type koffi from "koffi";

import { NativeDirFdError, type RootStat } from "./types.ts";

type Koffi = typeof koffi;
type OpenAt = (
  dirfd: number,
  path: string,
  flags: number,
  ...variadic: unknown[]
) => number;
type RenameAt = (
  oldDirFd: number,
  oldPath: string,
  newDirFd: number,
  newPath: string,
) => number;
type RenameAtFlags = (
  oldDirFd: number,
  oldPath: string,
  newDirFd: number,
  newPath: string,
  flags: number,
) => number;
type UnlinkAt = (dirfd: number, path: string, flags: number) => number;
type Flock = (fd: number, operation: number) => number;

export interface NativeBackend {
  readonly openat: OpenAt;
  readonly renameat: RenameAt;
  readonly renameNoReplace: RenameAtFlags;
  readonly unlinkat: UnlinkAt;
  readonly flock: Flock;
  readonly errno: () => number;
  readonly errnos: Record<string, number>;
}

const require = createRequire(import.meta.url);
const O_CLOEXEC = process.platform === "darwin" ? 0x01000000 : 0x00080000;
export const DIRECTORY_FLAGS =
  fsConstants.O_RDONLY |
  fsConstants.O_DIRECTORY |
  fsConstants.O_NOFOLLOW |
  O_CLOEXEC;
export const LEAF_FLAGS =
  fsConstants.O_RDONLY |
  fsConstants.O_NOFOLLOW |
  fsConstants.O_NONBLOCK |
  O_CLOEXEC;
export const TEMPORARY_FLAGS =
  fsConstants.O_WRONLY |
  fsConstants.O_CREAT |
  fsConstants.O_EXCL |
  fsConstants.O_NOFOLLOW |
  O_CLOEXEC;
export const NO_REPLACE_FLAG = process.platform === "darwin" ? 0x4 : 0x1;

export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function loadPosixBackend(): NativeBackend {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error(`POSIX openat backend cannot load on ${process.platform}`);
  }

  // Resolve the exact optional prebuilt before loading Koffi. Its cnoke installer
  // is disabled by package.json; there is deliberately no source-build fallback.
  const koffiEntry = require.resolve("koffi");
  const koffiRequire = createRequire(koffiEntry);
  koffiRequire.resolve(`@koromix/koffi-${process.platform}-${process.arch}`);
  const ffi = require("koffi") as Koffi;
  const libc = ffi.load(null);

  return {
    // openat MUST remain variadic: a fixed mode_t declaration corrupts arm64 calls.
    openat: libc.func(
      "int openat(int dirfd, const char *path, int flags, ...)",
    ) as OpenAt,
    renameat: libc.func(
      "int renameat(int oldfd, const char *oldpath, int newfd, const char *newpath)",
    ) as RenameAt,
    renameNoReplace: (process.platform === "darwin"
      ? libc.func(
          "int renameatx_np(int oldfd, const char *oldpath, int newfd, const char *newpath, unsigned int flags)",
        )
      : libc.func(
          "int renameat2(int oldfd, const char *oldpath, int newfd, const char *newpath, int flags)",
        )) as RenameAtFlags,
    unlinkat: libc.func(
      "int unlinkat(int dirfd, const char *path, int flags)",
    ) as UnlinkAt,
    flock: libc.func("int flock(int fd, int operation)") as Flock,
    errno: ffi.errno,
    errnos: ffi.os.errno,
  };
}

function errnoCode(
  native: NativeBackend,
  errno: number,
  missingCode: string,
): string {
  if (errno === native.errnos.ENOENT) return missingCode;
  if (errno === native.errnos.ELOOP) return "unsafe_symlink";
  if (errno === native.errnos.ENOTDIR) return "not_directory";
  if (errno === native.errnos.EEXIST) return "already_exists";
  return "native_io_error";
}

export function nativeCall(
  native: NativeBackend,
  operation: string,
  path: string,
  call: () => number,
  missingCode = "not_found",
  allowMissing = false,
): number | null {
  let result: number;
  try {
    result = call();
  } catch (error) {
    throw new NativeDirFdError(
      "native_call_failed",
      `Native ${operation} call failed for ${path}`,
      errorDetail(error),
    );
  }
  if (result !== -1) return result;

  // errno is thread-local; read it immediately after the synchronous FFI call.
  const errno = native.errno();
  if (allowMissing && errno === native.errnos.ENOENT) return null;
  const code = errnoCode(native, errno, missingCode);
  throw new NativeDirFdError(
    code,
    `Native ${operation} failed for ${path}: ${code}`,
    `errno ${errno}`,
    errno,
  );
}

export function openAt(
  native: NativeBackend,
  dirfd: number,
  path: string,
  flags: number,
  missingCode = "not_found",
  allowMissing = false,
  create = false,
): number | null {
  try {
    return nativeCall(
      native,
      "openat",
      path,
      () =>
        create
          ? native.openat(dirfd, path, flags, "uint", 0o600)
          : native.openat(dirfd, path, flags),
      missingCode,
      allowMissing,
    );
  } catch (error) {
    if (
      error instanceof NativeDirFdError &&
      error.code === "not_directory" &&
      (flags & fsConstants.O_DIRECTORY) !== 0
    ) {
      // macOS reports ENOTDIR for O_DIRECTORY|O_NOFOLLOW on a symlink. Repeat
      // beneath the same pinned parent without O_DIRECTORY: symlinks then report
      // ELOOP, while genuine non-directories retain the original diagnostic.
      const probe = nativeCall(
        native,
        "openat",
        path,
        () => native.openat(dirfd, path, LEAF_FLAGS),
        missingCode,
        true,
      );
      if (probe !== null) closeQuietly(probe);
    }
    throw error;
  }
}

export function closeQuietly(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // Cleanup must not mask the operation's original failure.
  }
}

export function statFd(fd: number): RootStat {
  const stat = fstatSync(fd, { bigint: true });
  return toRootStat(stat);
}

function toRootStat(stat: BigIntStats): RootStat {
  return {
    kind: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other",
    revision: `${stat.dev.toString(16)}:${stat.ino.toString(16)}:${stat.size.toString(16)}:${stat.mtimeNs.toString(16)}:${stat.ctimeNs.toString(16)}`,
    nlink: Number(stat.nlink),
    size: Number(stat.size),
  };
}

export function wrapNodeError(
  error: unknown,
  operation: string,
  path: string,
): NativeDirFdError {
  if (error instanceof NativeDirFdError) return error;
  const nodeError = error as NodeJS.ErrnoException;
  const code =
    nodeError.code === "ENOENT"
      ? "not_found"
      : nodeError.code === "ELOOP"
        ? "unsafe_symlink"
        : nodeError.code === "EEXIST"
          ? "already_exists"
          : nodeError.code === "ENOTDIR"
            ? "not_directory"
            : "native_io_error";
  return new NativeDirFdError(
    code,
    `${operation} failed for ${path}: ${code}`,
    errorDetail(error),
  );
}
