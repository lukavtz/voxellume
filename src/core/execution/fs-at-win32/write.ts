import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  NativeDirFdError,
  type NativeRoot,
  type RootStat,
  type WriteRootFileRequest,
} from "../fs-at.ts";
import {
  backend,
  checkStatus,
  closeParent,
  closeQuietly,
  nativeCall,
} from "./probe.ts";
import { informationBytes, statHandle } from "./read.ts";
import { queryInformation, setDisposition, utf16Units } from "./root.ts";
import {
  openParent,
  openRelative,
  openRequiredRelative,
  validatePath,
} from "./traversal.ts";
import {
  DELETE,
  FILE_CREATE,
  FILE_OPEN,
  FILE_READ_ATTRIBUTES,
  FILE_READ_DATA,
  FILE_RENAME_IGNORE_READONLY_ATTRIBUTE,
  FILE_RENAME_POSIX_SEMANTICS,
  FILE_RENAME_REPLACE_IF_EXISTS,
  FILE_WRITE_DATA,
  FileBasicInformation,
  FileRenameInformationEx,
  GENERIC_READ,
  IO_CHUNK_SIZE,
  LOCKFILE_EXCLUSIVE_LOCK,
  SYNCHRONIZE,
  root,
  type Handle,
  type IoStatus,
  type Win32Native,
} from "./types.ts";

function targetStat(
  owner: Win32Native,
  parent: Handle,
  base: string,
): RootStat | null {
  const handle = openRelative(owner, parent, base, {
    access: FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
    disposition: FILE_OPEN,
    directory: false,
    allowMissing: true,
  });
  if (handle === null) return null;
  try {
    const stat = statHandle(owner, handle, base);
    if (stat.kind !== "file") {
      throw new NativeDirFdError(
        "not_regular_file",
        `Not a regular file: ${base}`,
      );
    }
    if (stat.nlink !== 1) {
      throw new NativeDirFdError(
        "hard_linked_file",
        `Refusing to replace a hard-linked file: ${base}`,
      );
    }
    return stat;
  } finally {
    closeQuietly(handle);
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

interface ReplacementLock {
  readonly handle: Handle;
  readonly overlapped: Buffer;
}

function acquireReplacementLock(
  owner: Win32Native,
  parent: Handle,
  base: string,
  path: string,
): ReplacementLock | null {
  const handle = openRelative(owner, parent, base, {
    access: GENERIC_READ | SYNCHRONIZE,
    disposition: FILE_OPEN,
    directory: false,
    allowMissing: true,
  });
  if (handle === null) return null;
  // OVERLAPPED is 20 bytes on 32-bit Windows and 32 bytes on 64-bit Windows.
  // Zero initialization sets the byte-range offset to zero and hEvent to null.
  const overlapped = Buffer.alloc(32);
  try {
    const locked = nativeCall("LockFileEx", path, () =>
      owner.LockFileEx(handle, LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, overlapped),
    );
    if (!locked) {
      const error = owner.GetLastError();
      throw new NativeDirFdError(
        "native_io_error",
        `Native LockFileEx failed for ${path}`,
        `Win32 error ${error}`,
        error,
      );
    }
    return { handle, overlapped };
  } catch (error) {
    closeQuietly(handle);
    throw error;
  }
}

function releaseReplacementLock(
  owner: Win32Native,
  lock: ReplacementLock,
  path: string,
): void {
  try {
    const unlocked = nativeCall("UnlockFileEx", path, () =>
      owner.UnlockFileEx(lock.handle, 0, 1, 0, lock.overlapped),
    );
    if (!unlocked) {
      const error = owner.GetLastError();
      throw new NativeDirFdError(
        "native_io_error",
        `Native UnlockFileEx failed for ${path}`,
        `Win32 error ${error}`,
        error,
      );
    }
  } catch {
    // Closing the handle releases the range even if explicit unlock fails.
  } finally {
    closeQuietly(lock.handle);
  }
}

function assertTemporary(
  owner: Win32Native,
  handle: Handle,
  path: string,
): RootStat {
  const stat = statHandle(owner, handle, path);
  if (stat.kind !== "file" || stat.nlink !== 1) {
    throw new NativeDirFdError(
      "hard_linked_file",
      `Temporary file is not a private regular file: ${path}`,
    );
  }
  return stat;
}

function writeAll(
  owner: Win32Native,
  handle: Handle,
  contents: Buffer,
  path: string,
): void {
  let offset = 0;
  while (offset < contents.length) {
    const length = Math.min(IO_CHUNK_SIZE, contents.length - offset);
    const ioStatus: IoStatus = { Status: 0, Information: 0 };
    const byteOffset = new BigInt64Array([BigInt(offset)]);
    const status = nativeCall("NtWriteFile", path, () =>
      owner.NtWriteFile(
        handle,
        null,
        null,
        null,
        ioStatus,
        contents.subarray(offset, offset + length),
        length,
        byteOffset,
        null,
      ),
    );
    checkStatus("NtWriteFile", path, status);
    const written = informationBytes(ioStatus, length, path);
    if (written === 0) {
      throw new NativeDirFdError(
        "write_failed",
        "A temporary-file write made no progress",
      );
    }
    offset += written;
  }
}

const FILE_ATTRIBUTE_READONLY = 0x01;
const FILE_WRITE_ATTRIBUTES = 0x0100;

function setFileMode(
  owner: Win32Native,
  handle: Handle,
  path: string,
  mode: number,
): void {
  const information = queryInformation(
    owner,
    handle,
    FileBasicInformation,
    40,
    path,
  );
  const current = information.readUInt32LE(32);
  const attributes =
    (mode & 0o200) === 0
      ? current | FILE_ATTRIBUTE_READONLY
      : current & ~FILE_ATTRIBUTE_READONLY;
  information.writeUInt32LE(attributes, 32);
  const ioStatus: IoStatus = { Status: 0, Information: 0 };
  const status = nativeCall(
    "NtSetInformationFile(FileBasicInformation)",
    path,
    () =>
      owner.NtSetInformationFile(
        handle,
        ioStatus,
        information,
        40,
        FileBasicInformation,
      ),
  );
  checkStatus("NtSetInformationFile(FileBasicInformation)", path, status);
}

function flushFile(owner: Win32Native, handle: Handle, path: string): void {
  const ioStatus: IoStatus = { Status: 0, Information: 0 };
  const status = nativeCall("NtFlushBuffersFileEx", path, () =>
    owner.NtFlushBuffersFileEx(handle, 0, null, 0, ioStatus),
  );
  checkStatus("NtFlushBuffersFileEx", path, status);
}

function renameTemporary(
  owner: Win32Native,
  source: Handle,
  targetParent: Handle,
  targetName: string,
  replace: boolean,
  path: string,
): void {
  const units = utf16Units(targetName);
  const nameBytes = units.length * 2;
  const information = Buffer.alloc(32 + nameBytes);
  information.writeUInt32LE(
    FILE_RENAME_POSIX_SEMANTICS |
      (replace
        ? FILE_RENAME_REPLACE_IF_EXISTS | FILE_RENAME_IGNORE_READONLY_ATTRIBUTE
        : 0),
    0,
  );
  information.writeBigUInt64LE(targetParent, 8);
  information.writeUInt32LE(nameBytes, 16);
  // x64 padding precedes RootDirectory; FileName immediately follows FileNameLength.
  information.write(targetName, 20, nameBytes, "utf16le");
  const ioStatus: IoStatus = { Status: 0, Information: 0 };
  console.error("renameTemporary:before", path);
  const status = nativeCall(
    "NtSetInformationFile(FileRenameInformationEx)",
    path,
    () =>
      owner.NtSetInformationFile(
        source,
        ioStatus,
        information,
        information.length,
        FileRenameInformationEx,
      ),
  );
  console.error("renameTemporary:after", path, status);
  checkStatus("NtSetInformationFile(FileRenameInformationEx)", path, status);
}

export async function writeWin32RootFileAtomic(
  rootValue: NativeRoot,
  request: WriteRootFileRequest,
): Promise<{ revision: string }> {
  const openedRoot = root(rootValue);
  const owner = backend();
  const parts = validatePath(request.path);
  const base = parts.at(-1)!;
  const parent = openParent(openedRoot, parts, true);
  const temporaryName = `.voxellume-${process.pid}-${randomUUID()}.tmp`;
  const targetPath = join(openedRoot.realPath, ...parts);
  const temporaryPath = join(
    openedRoot.realPath,
    ...parts.slice(0, -1),
    temporaryName,
  );
  let temporaryHandle: Handle | undefined;
  let replacementLock: ReplacementLock | undefined;
  let renamed = false;

  try {
    const original = targetStat(owner, parent, base);
    assertRevision(original, request.expectedRevision, request.path);
    temporaryHandle = openRequiredRelative(owner, parent, temporaryName, {
      access:
        DELETE |
        FILE_WRITE_DATA |
        FILE_READ_ATTRIBUTES |
        FILE_WRITE_ATTRIBUTES |
        SYNCHRONIZE,
      disposition: FILE_CREATE,
      directory: false,
    });
    assertTemporary(owner, temporaryHandle, temporaryPath);
    if (request.mode !== undefined) {
      setFileMode(owner, temporaryHandle, temporaryPath, request.mode);
    }
    writeAll(owner, temporaryHandle, request.contents, temporaryPath);
    flushFile(owner, temporaryHandle, temporaryPath);
    const beforeHook = assertTemporary(owner, temporaryHandle, temporaryPath);

    if (request.beforeRename !== undefined) {
      await request.beforeRename({ targetPath, temporaryPath });
    }

    const afterHook = assertTemporary(owner, temporaryHandle, temporaryPath);
    if (afterHook.revision !== beforeHook.revision) {
      throw new NativeDirFdError(
        "revision_conflict",
        `Temporary file changed before rename: ${request.path}`,
      );
    }
    if (original !== null) {
      replacementLock =
        acquireReplacementLock(owner, parent, base, request.path) ?? undefined;
      if (replacementLock === undefined) {
        assertRevision(null, request.expectedRevision, request.path);
      }
    }
    const current = targetStat(owner, parent, base);
    assertRevision(current, request.expectedRevision, request.path);
    // LockFileEx excludes cooperating writers through this replacement. OS
    // writers that ignore byte-range locks cannot receive a CAS guarantee from
    // this filesystem; there is no unlocked fallback.
    renameTemporary(
      owner,
      temporaryHandle,
      parent,
      base,
      current !== null,
      request.path,
    );
    renamed = true;
    // Windows has no documented directory-handle flush. The file itself was flushed.
    return {
      revision: assertTemporary(owner, temporaryHandle, temporaryPath).revision,
    };
  } catch (error) {
    if (error instanceof NativeDirFdError && error.code === "already_exists") {
      throw new NativeDirFdError(
        "revision_conflict",
        `Destination appeared before rename: ${request.path}`,
        error.detail,
      );
    }
    throw error;
  } finally {
    if (temporaryHandle !== undefined) {
      if (!renamed) {
        try {
          setDisposition(owner, temporaryHandle, temporaryPath);
        } catch {
          // Preserve the original error; a stale private temp can be cleaned later.
        }
      }
      closeQuietly(temporaryHandle);
    }
    if (replacementLock !== undefined) {
      releaseReplacementLock(owner, replacementLock, request.path);
    }
    closeParent(parent);
  }
}
