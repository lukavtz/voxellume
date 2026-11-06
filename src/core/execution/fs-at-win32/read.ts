import { join } from "node:path";

import {
  NativeDirFdError,
  type NativeRoot,
  type RootFile,
  type RootStat,
} from "../fs-at.ts";
import {
  backend,
  checkStatus,
  closeParent,
  closeQuietly,
  nativeCall,
} from "./probe.ts";
import { queryInformation } from "./root.ts";
import { openParent, openRelative, validatePath } from "./traversal.ts";
import {
  FILE_ATTRIBUTE_DEVICE,
  FILE_OPEN,
  FILE_READ_ATTRIBUTES,
  FILE_READ_DATA,
  FileBasicInformation,
  FileIdInformation,
  FileStandardInformation,
  IO_CHUNK_SIZE,
  STATUS_END_OF_FILE,
  SYNCHRONIZE,
  root,
  type Handle,
  type IoStatus,
  type Win32Native,
} from "./types.ts";

export function statHandle(
  owner: Win32Native,
  handle: Handle,
  path: string,
): RootStat {
  const id = queryInformation(owner, handle, FileIdInformation, 24, path);
  const basic = queryInformation(owner, handle, FileBasicInformation, 40, path);
  const standard = queryInformation(
    owner,
    handle,
    FileStandardInformation,
    24,
    path,
  );
  const directory = standard.readUInt8(21) !== 0;
  const attributes = basic.readUInt32LE(32);
  const sizeValue = standard.readBigInt64LE(8);
  if (sizeValue < 0n || sizeValue > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new NativeDirFdError(
      "native_io_error",
      `File size is not representable: ${path}`,
    );
  }
  const volume = id.readBigUInt64LE(0).toString(16);
  const fileId = id.subarray(8, 24).toString("hex");
  const size = sizeValue.toString(16);
  const modified = basic.readBigInt64LE(16).toString(16);
  const changed = basic.readBigInt64LE(24).toString(16);
  return {
    kind: directory
      ? "directory"
      : (attributes & FILE_ATTRIBUTE_DEVICE) === 0
        ? "file"
        : "other",
    revision: `${volume}:${fileId}:${size}:${modified}:${changed}`,
    nlink: standard.readUInt32LE(16),
    size: Number(sizeValue),
  };
}

function openLeaf(
  rootValue: NativeRoot,
  path: string,
  allowMissing = false,
  directory: boolean | null = false,
) {
  const parts = validatePath(path);
  const parent = openParent(rootValue, parts, false);
  const owner = backend();
  try {
    const handle = openRelative(owner, parent, parts.at(-1)!, {
      access: FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
      disposition: FILE_OPEN,
      directory,
      allowMissing,
    });
    return { parent, handle, parts };
  } catch (error) {
    closeParent(parent);
    throw error;
  }
}

export function resolveWin32RootPath(
  rootValue: NativeRoot,
  path: string,
  options: { allowMissingLeaf?: boolean } = {},
): string {
  const openedRoot = root(rootValue);
  try {
    statWin32RootFile(openedRoot, path);
  } catch (error) {
    if (
      !options.allowMissingLeaf ||
      !(error instanceof NativeDirFdError) ||
      error.code !== "not_found"
    ) {
      throw error;
    }
  }
  return join(openedRoot.realPath, ...validatePath(path));
}

export function statWin32RootFile(
  rootValue: NativeRoot,
  path: string,
): RootStat {
  const owner = backend();
  const leaf = openLeaf(rootValue, path, false, null);
  const handle = leaf.handle;
  if (handle === null) {
    closeParent(leaf.parent);
    throw new NativeDirFdError("not_found", `File does not exist: ${path}`);
  }
  try {
    return statHandle(owner, handle, path);
  } finally {
    closeQuietly(handle);
    closeParent(leaf.parent);
  }
}

export function informationBytes(
  ioStatus: IoStatus,
  maximum: number,
  path: string,
): number {
  const value = BigInt(ioStatus.Information);
  if (value < 0n || value > BigInt(maximum)) {
    throw new NativeDirFdError(
      "native_io_error",
      `Invalid native I/O byte count for ${path}`,
    );
  }
  return Number(value);
}

export function readWin32RootFile(
  rootValue: NativeRoot,
  path: string,
): RootFile {
  const owner = backend();
  const leaf = openLeaf(rootValue, path);
  const handle = leaf.handle;
  if (handle === null) {
    closeParent(leaf.parent);
    throw new NativeDirFdError("not_found", `File does not exist: ${path}`);
  }
  try {
    const before = statHandle(owner, handle, path);
    if (before.kind !== "file") {
      throw new NativeDirFdError(
        "not_regular_file",
        `Not a regular file: ${path}`,
      );
    }
    const chunks: Buffer[] = [];
    let offset = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(IO_CHUNK_SIZE);
      const ioStatus: IoStatus = { Status: 0, Information: 0 };
      const byteOffset = new BigInt64Array([BigInt(offset)]);
      const status = nativeCall("NtReadFile", path, () =>
        owner.NtReadFile(
          handle,
          null,
          null,
          null,
          ioStatus,
          buffer,
          buffer.length,
          byteOffset,
          null,
        ),
      );
      if (status >>> 0 !== STATUS_END_OF_FILE)
        checkStatus("NtReadFile", path, status);
      const count = informationBytes(ioStatus, buffer.length, path);
      if (count > 0) {
        chunks.push(buffer.subarray(0, count));
        offset += count;
      }
      if (status >>> 0 === STATUS_END_OF_FILE || count === 0) break;
    }
    const stat = statHandle(owner, handle, path);
    if (stat.revision !== before.revision) {
      throw new NativeDirFdError(
        "revision_conflict",
        `File changed while reading: ${path}`,
      );
    }
    return {
      contents: Buffer.concat(chunks, offset),
      revision: stat.revision,
      stat,
    };
  } finally {
    closeQuietly(handle);
    closeParent(leaf.parent);
  }
}
