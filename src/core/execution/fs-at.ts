import {
  closeWin32Root,
  openWin32Root,
  readWin32RootFile,
  resolveWin32RootPath,
  statWin32RootFile,
  writeWin32RootFileAtomic,
} from "./fs-at-win32.ts";
import {
  readPosixRootFile,
  resolvePosixRootPath,
  statPosixRootFile,
} from "./fs-at/read.ts";
import { closePosixRoot, openPosixRoot } from "./fs-at/root.ts";
import type {
  NativeRoot,
  RootFile,
  RootStat,
  WriteRootFileRequest,
} from "./fs-at/types.ts";
import { writePosixRootFileAtomic } from "./fs-at/write.ts";

export {
  NATIVE_DIRFD_UNAVAILABLE,
  NativeDirFdError,
  type NativeDirFdProbe,
  type NativeRoot,
  type RootEntryKind,
  type RootFile,
  type RootRenamePaths,
  type RootStat,
  type WriteRootFileRequest,
} from "./fs-at/types.ts";
export { probeNativeDirFd } from "./fs-at/probe.ts";

export function openRoot(rootPath: string): NativeRoot {
  if (process.platform === "win32") return openWin32Root(rootPath);
  return openPosixRoot(rootPath);
}

export function closeRoot(rootValue: NativeRoot): void {
  if (process.platform === "win32") {
    closeWin32Root(rootValue);
    return;
  }
  closePosixRoot(rootValue);
}

export function resolveRootPath(
  rootValue: NativeRoot,
  path: string,
  options: { allowMissingLeaf?: boolean } = {},
): string {
  if (process.platform === "win32")
    return resolveWin32RootPath(rootValue, path, options);
  return resolvePosixRootPath(rootValue, path, options);
}

export function statRootFile(rootValue: NativeRoot, path: string): RootStat {
  if (process.platform === "win32") return statWin32RootFile(rootValue, path);
  return statPosixRootFile(rootValue, path);
}

export function readRootFile(rootValue: NativeRoot, path: string): RootFile {
  if (process.platform === "win32") return readWin32RootFile(rootValue, path);
  return readPosixRootFile(rootValue, path);
}

export async function writeRootFileAtomic(
  rootValue: NativeRoot,
  request: WriteRootFileRequest,
): Promise<{ revision: string }> {
  if (process.platform === "win32")
    return writeWin32RootFileAtomic(rootValue, request);
  return writePosixRootFileAtomic(rootValue, request);
}
