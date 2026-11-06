import { randomUUID } from "node:crypto";
import { fsyncSync, writeSync } from "node:fs";
import { join } from "node:path";

import {
  closeQuietly,
  LEAF_FLAGS,
  nativeCall,
  NO_REPLACE_FLAG,
  openAt,
  statFd,
  TEMPORARY_FLAGS,
  wrapNodeError,
} from "./native.ts";
import { backend } from "./probe.ts";
import { openParent, root, validatePath } from "./root.ts";
import {
  NativeDirFdError,
  type NativeRoot,
  type RootStat,
  type WriteRootFileRequest,
} from "./types.ts";

function targetStat(
  parentFd: number,
  base: string,
  forWrite: boolean,
): RootStat | null {
  const native = backend();
  const fd = openAt(native, parentFd, base, LEAF_FLAGS, "not_found", true);
  if (fd === null) return null;
  try {
    const stat = statFd(fd);
    if (forWrite && stat.kind !== "file") {
      throw new NativeDirFdError(
        "not_regular_file",
        `Not a regular file: ${base}`,
      );
    }
    if (forWrite && stat.nlink !== 1) {
      throw new NativeDirFdError(
        "hard_linked_file",
        `Refusing to replace a hard-linked file: ${base}`,
      );
    }
    return stat;
  } finally {
    closeQuietly(fd);
  }
}

function assertRevision(
  current: RootStat | null,
  expected: string | null,
  path: string,
): void {
  if (
    (expected === null && current !== null) ||
    (expected !== null && current?.revision !== expected)
  ) {
    throw new NativeDirFdError(
      "revision_conflict",
      `Revision conflict for ${path}`,
    );
  }
}

const LOCK_EX = 2;
const LOCK_UN = 3;

function acquireReplacementLock(
  parentFd: number,
  base: string,
  path: string,
): number | null {
  const native = backend();
  const fd = openAt(native, parentFd, base, LEAF_FLAGS, "not_found", true);
  if (fd === null) return null;
  try {
    // The locked inode stays open across rename, so cooperating processes that
    // opened the same revision serialize through final validation and rename.
    nativeCall(native, "flock(LOCK_EX)", path, () => native.flock(fd, LOCK_EX));
    return fd;
  } catch (error) {
    closeQuietly(fd);
    throw error;
  }
}

function releaseReplacementLock(fd: number, path: string): void {
  const native = backend();
  try {
    nativeCall(native, "flock(LOCK_UN)", path, () => native.flock(fd, LOCK_UN));
  } catch {
    // Closing the descriptor releases the lock even if explicit unlock fails.
  }
  closeQuietly(fd);
}

function assertTemporary(fd: number, path: string): RootStat {
  const stat = statFd(fd);
  if (stat.kind !== "file" || stat.nlink !== 1) {
    throw new NativeDirFdError(
      "hard_linked_file",
      `Temporary file is not a private regular file: ${path}`,
    );
  }
  return stat;
}

function writeAll(fd: number, contents: Buffer): void {
  let offset = 0;
  while (offset < contents.length) {
    const written = writeSync(
      fd,
      contents,
      offset,
      contents.length - offset,
      null,
    );
    if (written === 0) {
      throw new NativeDirFdError(
        "write_failed",
        "A temporary-file write made no progress",
      );
    }
    offset += written;
  }
}

function fsyncDirectoryBestEffort(fd: number): void {
  try {
    fsyncSync(fd);
  } catch {
    // macOS can reject directory fsync with EINVAL. The file itself was fsynced.
  }
}

export async function writePosixRootFileAtomic(
  rootValue: NativeRoot,
  request: WriteRootFileRequest,
): Promise<{ revision: string }> {
  const openedRoot = root(rootValue);
  const native = backend();
  const parts = validatePath(request.path);
  const base = parts.at(-1)!;
  const parentFd = openParent(openedRoot, parts);
  const temporaryName = `.voxellume-${process.pid}-${randomUUID()}.tmp`;
  const targetPath = join(openedRoot.realPath, ...parts);
  const temporaryPath = join(
    openedRoot.realPath,
    ...parts.slice(0, -1),
    temporaryName,
  );
  let temporaryFd: number | undefined;
  let replacementLockFd: number | undefined;
  let renamed = false;

  try {
    const original = targetStat(parentFd, base, true);
    assertRevision(original, request.expectedRevision, request.path);

    temporaryFd = openAt(
      native,
      parentFd,
      temporaryName,
      TEMPORARY_FLAGS,
      "not_found",
      false,
      true,
    )!;
    assertTemporary(temporaryFd, temporaryPath);
    writeAll(temporaryFd, request.contents);
    fsyncSync(temporaryFd);
    const beforeHook = assertTemporary(temporaryFd, temporaryPath);

    if (request.beforeRename !== undefined) {
      await request.beforeRename({ targetPath, temporaryPath });
    }

    const afterHook = assertTemporary(temporaryFd, temporaryPath);
    if (afterHook.revision !== beforeHook.revision) {
      throw new NativeDirFdError(
        "revision_conflict",
        `Temporary file changed before rename: ${request.path}`,
      );
    }
    if (original !== null) {
      replacementLockFd =
        acquireReplacementLock(parentFd, base, request.path) ?? undefined;
      if (replacementLockFd === undefined) {
        assertRevision(null, request.expectedRevision, request.path);
      }
    }
    const current = targetStat(parentFd, base, true);
    assertRevision(current, request.expectedRevision, request.path);

    if (current === null) {
      // NOREPLACE/EXCL closes the create race: no implicit overwrite is possible.
      nativeCall(native, "renameat_noreplace", request.path, () =>
        native.renameNoReplace(
          parentFd,
          temporaryName,
          parentFd,
          base,
          NO_REPLACE_FLAG,
        ),
      );
    } else {
      // Advisory locking excludes cooperating writers through this rename.
      // Noncooperating OS writers do not honor flock; these filesystems offer
      // no rename-CAS, so their final-window replacement cannot be guaranteed.
      nativeCall(native, "renameat", request.path, () =>
        native.renameat(parentFd, temporaryName, parentFd, base),
      );
    }
    renamed = true;
    fsyncDirectoryBestEffort(parentFd);
    return { revision: assertTemporary(temporaryFd, temporaryPath).revision };
  } catch (error) {
    const wrapped = wrapNodeError(error, "atomic write", request.path);
    if (wrapped.code === "already_exists") {
      throw new NativeDirFdError(
        "revision_conflict",
        `Destination appeared before rename: ${request.path}`,
      );
    }
    throw wrapped;
  } finally {
    if (temporaryFd !== undefined) {
      if (!renamed) {
        try {
          nativeCall(native, "unlinkat", temporaryPath, () =>
            native.unlinkat(parentFd, temporaryName, 0),
          );
        } catch {
          // Preserve the original error; a stale private temp can be cleaned later.
        }
      }
      closeQuietly(temporaryFd);
    }
    if (replacementLockFd !== undefined) {
      releaseReplacementLock(replacementLockFd, request.path);
    }
    closeQuietly(parentFd);
  }
}
