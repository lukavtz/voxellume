import { realpathSync } from "node:fs";

import { NativeDirFdError, type NativeRoot } from "../fs-at.ts";
import {
  backend,
  checkStatus,
  closeParent,
  closeQuietly,
  nativeCall,
  statusDetail,
} from "./probe.ts";
import {
  setDisposition,
  splitRootPath,
  validateOpenedHandle,
  withObjectAttributes,
  wrapNodeError,
} from "./root.ts";
import {
  FILE_APPEND_DATA,
  FILE_CREATE,
  FILE_FLAG_BACKUP_SEMANTICS,
  FILE_NON_DIRECTORY_FILE,
  FILE_OPEN,
  FILE_OPEN_REPARSE_POINT,
  FILE_READ_ATTRIBUTES,
  FILE_READ_DATA,
  FILE_SHARE_READ_WRITE_DELETE,
  FILE_SYNCHRONOUS_IO_NONALERT,
  FILE_TRAVERSE,
  FILE_WRITE_DATA,
  INVALID_HANDLE_VALUES,
  OPEN_EXISTING,
  STATUS_OBJECT_NAME_NOT_FOUND,
  SYNCHRONIZE,
  Win32Root,
  root,
  type Handle,
  type IoStatus,
  type Win32Native,
} from "./types.ts";

export function validatePath(path: string): string[] {
  if (path.length === 0 || path.includes("\0") || !path.isWellFormed()) {
    throw new NativeDirFdError(
      "invalid_path",
      "Path is empty, contains NUL, or is malformed",
    );
  }
  if (/^[A-Za-z]:/.test(path) || /^[\\/]/.test(path)) {
    throw new NativeDirFdError(
      "absolute_path",
      "Absolute paths are not allowed",
    );
  }
  if (Buffer.byteLength(path) > 4096) {
    throw new NativeDirFdError("invalid_path", "Path exceeds 4096 bytes");
  }
  const parts = path.split("/");
  for (const part of parts) {
    if (part === "..") {
      throw new NativeDirFdError(
        "path_traversal",
        "Parent traversal is not allowed",
      );
    }
    if (
      part.length === 0 ||
      part === "." ||
      part.length > 255 ||
      part.includes("\\")
    ) {
      throw new NativeDirFdError(
        "invalid_path",
        "Path contains an invalid component",
      );
    }
  }
  return parts;
}

export interface OpenRelativeOptions {
  readonly access: number;
  readonly disposition: number;
  readonly directory: boolean | null;
  readonly missingCode?: string;
  readonly allowMissing?: boolean;
}

export function openRelative(
  owner: Win32Native,
  parent: Handle,
  name: string,
  options: OpenRelativeOptions,
): Handle | null {
  const output: [Handle | null] = [null];
  const ioStatus: IoStatus = { Status: 0, Information: 0 };
  const createOptions =
    FILE_OPEN_REPARSE_POINT |
    FILE_SYNCHRONOUS_IO_NONALERT |
    (options.directory === false ? FILE_NON_DIRECTORY_FILE : 0);
  const status = withObjectAttributes(owner, parent, name, (attributes) =>
    nativeCall("NtCreateFile", name, () =>
      owner.NtCreateFile(
        output,
        options.access,
        attributes,
        ioStatus,
        null,
        0,
        FILE_SHARE_READ_WRITE_DELETE,
        options.disposition,
        createOptions,
        null,
        0,
      ),
    ),
  );
  if (
    options.allowMissing === true &&
    status >>> 0 === STATUS_OBJECT_NAME_NOT_FOUND
  ) {
    return null;
  }
  checkStatus(
    "NtCreateFile",
    name,
    status,
    options.missingCode ?? "not_found",
    options.allowMissing ?? false,
  );
  const handle = output[0];
  if (handle === null || INVALID_HANDLE_VALUES.has(handle)) {
    throw new NativeDirFdError(
      "native_io_error",
      `NtCreateFile returned no handle for ${name}`,
      statusDetail(status),
    );
  }
  try {
    validateOpenedHandle(owner, handle, name, options.directory);
    return handle;
  } catch (error) {
    if (options.disposition === FILE_CREATE) {
      try {
        setDisposition(owner, handle, name);
      } catch {
        // Preserve the validation failure; the private name allows later cleanup.
      }
    }
    closeQuietly(handle);
    throw error;
  }
}

export function openRequiredRelative(
  owner: Win32Native,
  parent: Handle,
  name: string,
  options: OpenRelativeOptions,
): Handle {
  const handle = openRelative(owner, parent, name, options);
  if (handle === null) {
    throw new NativeDirFdError(
      options.missingCode ?? "not_found",
      `Required file does not exist: ${name}`,
    );
  }
  return handle;
}

export function openParent(
  rootValue: NativeRoot,
  parts: readonly string[],
  mutation: boolean,
): Handle {
  const openedRoot = root(rootValue);
  const owner = backend();
  const access =
    FILE_TRAVERSE |
    FILE_READ_ATTRIBUTES |
    SYNCHRONIZE |
    (mutation ? FILE_READ_DATA | FILE_WRITE_DATA | FILE_APPEND_DATA : 0);
  // An empty NT-relative name reopens RootDirectory. NtCreateFile rejects the
  // Win32-only "." component with STATUS_OBJECT_NAME_INVALID.
  let current = openRequiredRelative(owner, openedRoot.handle, "", {
    access,
    disposition: FILE_OPEN,
    directory: true,
    missingCode: "missing_parent",
  });
  try {
    for (let index = 0; index < parts.length - 1; index += 1) {
      const next = openRequiredRelative(owner, current, parts[index]!, {
        access,
        disposition: FILE_OPEN,
        directory: true,
        missingCode: "missing_parent",
      });
      closeParent(current);
      current = next;
    }
    return current;
  } catch (error) {
    closeParent(current);
    throw error;
  }
}

export function openWin32Root(rootPath: string): NativeRoot {
  const owner = backend();
  let realPath: string;
  try {
    realPath = realpathSync(rootPath);
  } catch (error) {
    throw wrapNodeError(error, "realpath", rootPath);
  }
  const { prefix, parts } = splitRootPath(realPath);
  const access = FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE;
  const anchor = nativeCall("CreateFileW", prefix, () =>
    owner.CreateFileW(
      prefix,
      access,
      FILE_SHARE_READ_WRITE_DELETE,
      null,
      OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS,
      null,
    ),
  );
  if (anchor === null || INVALID_HANDLE_VALUES.has(anchor)) {
    const error = owner.GetLastError();
    throw new NativeDirFdError(
      "invalid_root",
      `Cannot open Windows filesystem root: ${prefix}`,
      `Win32 error ${error}`,
      error,
    );
  }
  let handle: Handle = anchor;
  try {
    validateOpenedHandle(owner, handle, prefix, true);
    for (const part of parts) {
      const next = openRequiredRelative(owner, handle, part, {
        access,
        disposition: FILE_OPEN,
        directory: true,
        missingCode: "invalid_root",
      });
      closeQuietly(handle);
      handle = next;
    }
    return new Win32Root(realPath, handle);
  } catch (error) {
    closeQuietly(handle);
    throw error;
  }
}

export function closeWin32Root(rootValue: NativeRoot): void {
  const openedRoot = root(rootValue);
  const owner = backend();
  openedRoot.closed = true;
  if (
    !nativeCall("CloseHandle", openedRoot.realPath, () =>
      owner.CloseHandle(openedRoot.handle),
    )
  ) {
    const error = owner.GetLastError();
    throw new NativeDirFdError(
      "native_io_error",
      `CloseHandle failed for ${openedRoot.realPath}`,
      `Win32 error ${error}`,
      error,
    );
  }
}
